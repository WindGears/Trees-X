/* global URL, MutationObserver, performance */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { chromium, expect } from '@playwright/test'
import { bridge, inputPoint } from './demo/browser-check.mjs'
import { readDemoConfig } from './demo/config.mjs'
import { localAuditOrigin } from './reventon-performance/audit-origin.mjs'
import { boundedAuditAttempt, withAuditDeadline } from './reventon-performance/audit-deadline.mjs'
import { candidateIdentity } from './reventon-clean-stress/model.mjs'
import { keyShadowUrl } from './reventon-key-shadow/model.mjs'

// This procedure never saves a product. A request guard independently blocks all
// persistent writes; a final authenticated GET must match the initial document.
const args = new Map()
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index],
    value = process.argv[index + 1]
  assert.ok(
    ['--output', '--device', '--showroom'].includes(key) && value,
    'Expected --output, --device or --showroom value',
  )
  assert.ok(!args.has(key), 'Duplicate option')
  args.set(key, value)
}
assert.ok(['0', '1'].includes(args.get('--device') ?? '0'), '--device requires 0 or 1')
assert.ok(['0', '1'].includes(args.get('--showroom') ?? '0'), '--showroom requires 0 or 1')
const config = readDemoConfig(),
  base = localAuditOrigin(process.env.CHECK_URL ?? config.baseUrl),
  output = resolve(args.get('--output') ?? 'artifacts/car-key-shadow/flow'),
  deviceTest = args.get('--device') === '1',
  showroomTest = args.get('--showroom') === '1',
  detailUrl = new URL('/api/v1/admin/products/reventon', base).href,
  digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex'),
  timeout = 240000
assert.ok(output.startsWith(resolve('artifacts') + sep), 'Output must remain in artifacts/')
const report = {
  schemaVersion: 1,
  passed: false,
  startedAt: new Date().toISOString(),
  base,
  headless: true,
  viewport: { width: 1440, height: 1000 },
  deviceTest,
  showroomTest,
  checks: [],
  snapshots: {},
  errors: [],
  expectedAuthenticationErrors: [],
  httpErrors: [],
  gpuErrors: [],
  failedRequests: [],
  blockedWrites: [],
  origins: [],
  expectedDeviceLossMessages: [],
  limitations: [
    'Headless background test; no browser window is raised and no user focus is taken.',
    'Admin preview and camera return only; no persistent save or product mutation is permitted.',
    'This is a short flow check, not a reload/soak or screen-presentation performance test.',
    'Native device recovery is optional and is not claimed unless --device 1 completes.',
    'Admin canvas follows the existing preview layout; it is not the 1440×1000 quality comparison.',
  ],
}
let browser,
  context,
  page,
  authenticated = false,
  deviceWindow = false
await mkdir(output, { recursive: true })
const query = (fn, value) =>
  withAuditDeadline('Car shadow flow query', () => page.evaluate(fn, value), 30000)

async function attach() {
  await bridge(page, true)
  await query(() => {
    const seen = new Set()
    const visit = (vnode) => {
      if (!vnode || typeof vnode !== 'object' || seen.has(vnode)) return
      seen.add(vnode)
      const component = vnode.component,
        exposed = component?.exposed?.realLighting,
        candidate = exposed?.value ?? exposed
      if (candidate?.snapshot && candidate?.setSignals) return candidate
      const found = visit(component?.subTree)
      if (found) return found
      for (const child of Array.isArray(vnode.children) ? vnode.children : []) {
        const value = visit(child)
        if (value) return value
      }
      return visit(vnode.suspense?.activeBranch)
    }
    window.__carFlowLighting = visit(document.querySelector('#app')?._vnode)
    if (!window.__carFlowLighting) throw new Error('Actual car lighting coordinator unavailable')
    const device = window.__demo.scene.renderer.instance.backend.device
    window.__carFlowDeviceErrors ??= []
    device.addEventListener('uncapturederror', (event) => {
      window.__carFlowDeviceErrors.push({ message: event.error?.message ?? 'Unknown GPU error' })
    })
  })
}

async function snapshot() {
  return query(() => {
    const { scene, store, motion } = window.__demo,
      renderer = scene.renderer.instance,
      camera = scene.camera.activeCamera.value,
      root = scene.scene.value.children.find((node) => node.userData.workbenchProduct)
    const architecture = [],
      showroomRoots = []
    scene.scene.value.traverse((node) => {
      if (node.userData.carShowroom === 'cold-studio') showroomRoots.push(node.uuid)
      if (node.isMesh && node.userData.carShowroom === true)
        architecture.push({ id: node.userData.showroomId, uuid: node.uuid })
    })
    return {
      atMs: performance.now(),
      status: store.status,
      slug: store.slug,
      revision: store.revision,
      product: root?.userData.workbenchProduct,
      sha256: root?.userData.bundleSha256,
      rootUuid: root?.uuid,
      studio: root?.userData.carStudioQuality,
      showroom: root?.userData.carShowroom ?? null,
      showroomRoots,
      architecture,
      environment: scene.scene.value.environment?.uuid ?? null,
      backend: renderer.backend.isWebGPUBackend ? 'webgpu' : 'other',
      canvases: document.querySelectorAll('canvas').length,
      sameCanvas: renderer.domElement === window.__demo.canvas,
      sameRenderer: renderer === window.__demo.renderer,
      output: [renderer.domElement.width, renderer.domElement.height],
      camera: {
        position: camera.position.toArray(),
        quaternion: camera.quaternion.toArray(),
        direction: camera.getWorldDirection(camera.position.clone()).toArray(),
      },
      motion: Object.fromEntries(
        Object.entries(motion.states.value).map(([id, value]) => [
          id,
          {
            progress: value.progress,
            target: value.target,
            playing: value.playing,
          },
        ]),
      ),
      lighting: window.__carFlowLighting.snapshot(),
      gpuErrors: [...window.__carFlowDeviceErrors],
    }
  })
}

function verify(value) {
  assert.equal(value.status, 'ready')
  assert.equal(value.slug, 'reventon')
  assert.equal(value.product, 'reventon')
  assert.equal(value.sha256, candidateIdentity.sha256)
  assert.equal(value.studio, 'studio')
  assert.equal(value.backend, 'webgpu')
  assert.equal(value.canvases, 1)
  assert.ok(value.sameCanvas && value.sameRenderer)
  assert.ok(value.output.every((dimension) => Number.isInteger(dimension) && dimension > 0))
  assert.equal(value.lighting.slug, 'reventon')
  assert.equal(value.lighting.revision, value.revision, 'Coordinator must match current selection')
  assert.equal(value.lighting.error, null)
  assert.equal(value.lighting.phase, 'ready')
  assert.equal(value.lighting.indirectLighting.actual, 'ddgi')
  assert.equal(value.lighting.indirectLighting.error, null)
  const shadow = value.lighting.keyShadow
  assert.equal(shadow?.requested, true)
  assert.equal(shadow.phase, 'ready', 'A silent self-shadow fallback is not accepted')
  assert.equal(shadow.error, null)
  assert.ok(shadow.generation > 0 && shadow.frames > 0 && shadow.blasBuilds > 0)
  assert.ok(value.lighting.signals.reflectionRays.actual === 2)
  if (showroomTest) {
    assert.equal(value.showroom?.requested, true)
    assert.equal(value.showroom.phase, 'ready', 'Actual cold studio must be ready')
    assert.equal(value.showroom.error, null)
    assert.equal(value.showroom.probe?.captures, 6)
    assert.equal(value.showroom.probe?.resolution, 1024)
    assert.equal(value.showroomRoots.length, 1, 'One actual showroom per scene host')
    const ids = value.architecture.map((entry) => entry.id)
    assert.equal(new Set(ids).size, ids.length, 'No duplicate architectural geometry')
    for (const id of [
      'floor',
      'ceiling',
      'back wall',
      'front wall',
      'left wall',
      'right wall',
      'key softbox',
      'strip softbox',
    ])
      assert.ok(ids.includes(id), 'Actual showroom geometry required: ' + id)
  }
  assert.deepEqual(value.gpuErrors, [])
}

async function ready() {
  await expect(page.locator('.workbench')).toHaveAttribute('data-slug', 'reventon', { timeout })
  await expect
    .poll(
      async () => {
        const value = await query(() => ({
          status: document.querySelector('.workbench')?.dataset.status,
          error: document.querySelector('.wb-stage-status')?.textContent,
        }))
        if (['error', 'content'].includes(value.status))
          throw new Error(value.error ?? value.status)
        return value.status
      },
      { timeout, intervals: [250, 500] },
    )
    .toBe('ready')
  await expect(page.locator('canvas')).toHaveCount(1)
  await attach()
  await expect
    .poll(
      async () => {
        const value = await snapshot(),
          lighting = value.lighting
        const failure =
          lighting.error ||
          lighting.indirectLighting?.error ||
          lighting.keyShadow?.error ||
          (showroomTest && value.showroom?.error)
        if (failure) throw new Error(failure)
        return (
          lighting.phase === 'ready' &&
          lighting.indirectLighting?.actual === 'ddgi' &&
          lighting.keyShadow?.phase === 'ready' &&
          (!showroomTest || value.showroom?.phase === 'ready')
        )
      },
      { timeout, intervals: [250, 500] },
    )
    .toBe(true)
  const value = await snapshot()
  verify(value)
  return value
}

async function tab(name) {
  await page
    .getByRole('navigation', { name: '商品编辑分区' })
    .getByRole('button', { name, exact: true })
    .click()
}

async function recoverDevice() {
  await query(() => window.__demo.store.motion('seek', 'open-doors', 0.37))
  await expect
    .poll(async () => (await snapshot()).motion['open-doors']?.progress, { timeout: 15000 })
    .toBeCloseTo(0.37, 7)
  const before = await snapshot()
  verify(before)
  report.snapshots.beforeDeviceLoss = before
  deviceWindow = true
  await query(() => {
    const renderer = window.__demo.scene.renderer.instance,
      device = renderer.backend.device
    if (!device?.destroy) throw new Error('Native GPUDevice.destroy unavailable')
    const state = (window.__carFlowDeviceLoss = {
      renderer,
      canvas: document.querySelector('canvas'),
      reason: null,
      maxCanvas: 1,
    })
    state.observer = new MutationObserver(() => {
      state.maxCanvas = Math.max(state.maxCanvas, document.querySelectorAll('canvas').length)
    })
    state.observer.observe(document.querySelector('#app'), { subtree: true, childList: true })
    void device.lost.then((value) => {
      state.reason = value.reason
    })
    device.destroy()
  })
  await page.waitForFunction(() => window.__carFlowDeviceLoss.reason !== null, null, {
    timeout: 30000,
  })
  await page.waitForFunction(
    () => document.querySelector('canvas') !== window.__carFlowDeviceLoss.canvas,
    null,
    { timeout: 30000 },
  )
  const after = await ready()
  const native = await query(() => {
    const state = window.__carFlowDeviceLoss
    state.observer.disconnect()
    return {
      reason: state.reason,
      maxCanvas: state.maxCanvas,
      rendererReplaced: state.renderer !== window.__demo.scene.renderer.instance,
    }
  })
  deviceWindow = false
  assert.equal(native.reason, 'destroyed')
  assert.equal(native.rendererReplaced, true)
  assert.equal(native.maxCanvas, 1)
  assert.notEqual(after.rootUuid, before.rootUuid)
  assert.deepEqual(after.motion, before.motion)
  assert.equal(after.motion['open-doors'].playing, false)
  for (const key of ['position', 'quaternion'])
    after.camera[key].forEach((value, index) =>
      assert.ok(Math.abs(value - before.camera[key][index]) < 1e-5, 'Recovery preserves camera'),
    )
  report.snapshots.deviceRecovery = { native, after }
  report.checks.push(
    'Actual GPUDevice destruction rebuilds one WebGPU host; car, paused motion, camera and ready key-shadow are restored',
  )
}

try {
  browser = await chromium.launch({
    channel: process.env.REVENTON_BROWSER_CHANNEL ?? 'msedge',
    headless: true,
  })
  context = await browser.newContext({ viewport: report.viewport, deviceScaleFactor: 1 })
  page = await context.newPage()
  page.setDefaultTimeout(30000)
  page.on('pageerror', (error) => report.errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    const path = message.location().url ? new URL(message.location().url).pathname : null
    if (
      !authenticated &&
      path === '/api/v1/admin/session' &&
      message.text() ===
        'Failed to load resource: the server responded with a status of 401 (Unauthorized)'
    )
      report.expectedAuthenticationErrors.push({ type: 'console', path, message: message.text() })
    else if (
      deviceWindow &&
      /GPU.*device.*lost|device.*lost|WebGPU.*destroyed/i.test(message.text())
    )
      report.expectedDeviceLossMessages.push(message.text())
    else report.errors.push(message.text())
  })
  page.on('response', (response) => {
    if (response.status() < 400) return
    const path = new URL(response.url()).pathname
    if (
      !authenticated &&
      path === '/api/v1/admin/session' &&
      response.request().method() === 'GET' &&
      response.status() === 401
    )
      report.expectedAuthenticationErrors.push({ type: 'response', path, status: 401 })
    else report.httpErrors.push({ path, status: response.status() })
  })
  page.on('requestfailed', (request) =>
    report.failedRequests.push({
      url: request.url(),
      reason: request.failure()?.errorText,
    }),
  )
  page.on('request', (request) => {
    if (/^https?:/.test(request.url())) report.origins.push(new URL(request.url()).origin)
  })
  await page.route('**/api/v1/admin/**', async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname,
      allowed =
        request.method() === 'GET' ||
        (request.method() === 'POST' &&
          [
            '/api/v1/admin/session/login',
            '/api/v1/admin/session/logout',
            '/api/v1/admin/products/preview',
          ].includes(path))
    if (allowed) await route.continue()
    else {
      report.blockedWrites.push({ method: request.method(), path })
      await route.abort('blockedbyclient')
    }
  })
  const url = new URL(keyShadowUrl(base, 'shadow'))
  url.pathname = '/admin'
  url.searchParams.delete('product')
  if (showroomTest) url.searchParams.set('carShowroom', 'cold-studio')
  await page.goto(url.href, { waitUntil: 'domcontentloaded' })
  await expect
    .poll(
      async () =>
        (await page.getByLabel('管理员账号', { exact: true }).isVisible()) ||
        (await page.getByRole('button', { name: '退出登录', exact: true }).isVisible()),
      { timeout: 15000 },
    )
    .toBe(true)
  if (await page.getByLabel('管理员账号', { exact: true }).isVisible()) {
    await page
      .getByLabel('管理员账号', { exact: true })
      .fill(config.env.TREES_ADMIN_USERNAME ?? 'admin')
    await page.getByLabel('密码', { exact: true }).fill(config.env.TREES_ADMIN_PASSWORD ?? '123456')
    await page.getByRole('button', { name: '登录管理端', exact: true }).click()
  }
  await expect(page.getByRole('button', { name: '退出登录', exact: true })).toBeVisible()
  authenticated = true
  const originalResponse = await page.request.get(detailUrl)
  assert.equal(originalResponse.status(), 200)
  const original = await originalResponse.json()
  report.persistedBeforeSha256 = digest(original)
  await page.getByRole('button', { name: '编辑' + original.item.name, exact: true }).click()
  await tab('镜头')
  const previewResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/v1/admin/products/preview' &&
      response.request().method() === 'POST',
  )
  await page.getByRole('button', { name: '为默认取景采集镜头', exact: true }).click()
  assert.equal((await previewResponse).status(), 200)
  report.snapshots.initial = await ready()
  report.checks.push(
    'Real authenticated admin preview loads audited runtime-v2, DDGI, two-ray SSR and active key-softbox self-shadow on one actual WebGPU host',
  )
  if (deviceTest) await recoverDevice()
  const before = await snapshot(),
    point = await inputPoint(page)
  await page.mouse.move(point.x, point.y)
  await page.mouse.down({ button: 'right' })
  await page.mouse.move(point.x + 45, point.y + 12, { steps: 8 })
  await page.mouse.up({ button: 'right' })
  await expect
    .poll(
      async () => {
        const current = await snapshot()
        return Math.max(
          ...current.camera.position.map((value, index) =>
            Math.abs(value - before.camera.position[index]),
          ),
        )
      },
      { timeout: 15000 },
    )
    .toBeGreaterThan(1e-4)
  await page.waitForTimeout(500)
  const moved = await snapshot()
  verify(moved)
  assert.equal(moved.lighting.keyShadow.generation, before.lighting.keyShadow.generation)
  assert.equal(moved.lighting.keyShadow.blasBuilds, before.lighting.keyShadow.blasBuilds)
  assert.ok(moved.lighting.keyShadow.frames > before.lighting.keyShadow.frames)
  if (showroomTest) {
    assert.equal(
      moved.environment,
      before.environment,
      'Camera pan must reuse the static room probe',
    )
    assert.equal(moved.showroom.probe.captures, before.showroom.probe.captures)
    assert.deepEqual(moved.showroomRoots, before.showroomRoots)
  }
  report.snapshots.panned = moved
  await page.screenshot({ path: resolve(output, 'admin-shadow-panned.png') })
  await page.getByRole('button', { name: '使用此取景并返回', exact: true }).click()
  await expect(page.locator('canvas')).toHaveCount(0)
  await expect(
    page.getByText('取景已回填到表单，尚未保存到数据库。', { exact: true }),
  ).toBeVisible()
  await tab('高级配置')
  const captured = JSON.parse(
    await page.getByLabel('完整展示配置 JSON', { exact: true }).inputValue(),
  )
  for (const [index, value] of captured.camera.position.entries())
    assert.ok(
      Math.abs(value - moved.camera.position[index]) < 1e-4,
      'Returned camera position matches actual camera',
    )
  const direction = captured.camera.target.map(
      (value, index) => value - captured.camera.position[index],
    ),
    length = Math.hypot(...direction)
  direction.forEach((value, index) =>
    assert.ok(
      Math.abs(value / length - moved.camera.direction[index]) < 1e-4,
      'Returned target matches actual view direction',
    ),
  )
  const perspective = captured.views.find((view) => view.id === 'perspective')
  assert.deepEqual(perspective.position, captured.camera.position)
  assert.deepEqual(perspective.target, captured.camera.target)
  assert.deepEqual(captured.actions, original.presentation.actions)
  report.snapshots.returnedCamera = { camera: captured.camera, perspective }
  if (showroomTest) {
    await tab('镜头')
    const returnedPreview = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/v1/admin/products/preview' &&
        response.request().method() === 'POST',
    )
    await page.getByRole('button', { name: '为默认取景采集镜头', exact: true }).click()
    assert.equal((await returnedPreview).status(), 200)
    const restored = await ready()
    restored.camera.position.forEach((value, index) =>
      assert.ok(
        Math.abs(value - captured.camera.position[index]) < 1e-4,
        'Returned draft camera must be used by the actual new preview',
      ),
    )
    report.snapshots.returnedPreview = restored
    await page.screenshot({ path: resolve(output, 'admin-showroom-returned.png') })
    await page.getByRole('button', { name: '返回编辑', exact: true }).click()
    await expect(page.locator('canvas')).toHaveCount(0)
    report.checks.push(
      'Cold showroom stays ready in actual admin preview, native device recovery when requested, and a fresh preview using the returned unsaved camera; no overlapping scene/Canvas or persistent write',
    )
  }
  const persistedResponse = await page.request.get(detailUrl)
  assert.equal(persistedResponse.status(), 200)
  const persisted = await persistedResponse.json()
  assert.deepEqual(persisted, original, 'Preview/capture must leave stored product unchanged')
  report.persistedAfterSha256 = digest(persisted)
  report.checks.push(
    'Right-button pan changes actual camera without replacing renderer/BVH; camera return synchronizes default/perspective, unmounts Canvas and leaves product/config/revision byte-for-byte JSON unchanged',
  )
  report.origins = [...new Set(report.origins)]
  assert.deepEqual(report.origins, [new URL(base).origin])
  assert.deepEqual(report.blockedWrites, [])
  assert.deepEqual(report.failedRequests, [])
  assert.deepEqual(report.httpErrors, [])
  assert.equal(
    report.expectedAuthenticationErrors.filter((entry) => entry.type === 'response').length,
    1,
  )
  assert.ok(
    report.expectedAuthenticationErrors.filter((entry) => entry.type === 'console').length <= 1,
  )
  assert.deepEqual(report.errors, [])
  report.passed = true
} catch (error) {
  report.failure = { message: error.message, stack: error.stack }
  if (page)
    await boundedAuditAttempt(
      'Failure screenshot',
      () => page.screenshot({ path: resolve(output, 'failure.png') }),
      5000,
    )
} finally {
  if (page)
    await boundedAuditAttempt(
      'Disconnect test observer',
      () => query(() => window.__carFlowDeviceLoss?.observer?.disconnect()),
      3000,
    )
  const contextCleanup = await boundedAuditAttempt(
      'Close owned flow context',
      () => context?.close(),
      10000,
    ),
    browserCleanup = await boundedAuditAttempt(
      'Close owned flow browser',
      () => browser?.close(),
      10000,
    )
  report.cleanup = { context: contextCleanup.status, browser: browserCleanup.status }
  if (contextCleanup.status !== 'completed' || browserCleanup.status !== 'completed')
    report.passed = false
  report.completedAt = new Date().toISOString()
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
}
console.log(
  JSON.stringify(
    {
      passed: report.passed,
      output,
      checks: report.checks.length,
      deviceTest,
      showroomTest,
      failure: report.failure?.message,
    },
    null,
    2,
  ),
)
if (!report.passed) process.exitCode = 1

/* global URL */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { chromium, expect } from '@playwright/test'
import { bridge, inputPoint } from './demo/browser-check.mjs'

const base = process.env.CHECK_URL || 'http://127.0.0.1:5181',
  origin = new URL(base).origin,
  output = process.env.REVENTON_ADMIN_OUTPUT || 'artifacts/car-runtime-v2/admin-preview',
  timeout = Number(process.env.REVENTON_ADMIN_TIMEOUT || 300000),
  safeOutput = resolve(output).startsWith(resolve('artifacts') + sep),
  viewport = { width: 1440, height: 1000 },
  slug = 'reventon',
  detailPath = '/api/v1/admin/products/' + slug,
  allowedPosts = new Set([
    '/api/v1/admin/session/login',
    '/api/v1/admin/session/logout',
    '/api/v1/admin/products/preview',
  ]),
  report = {
    passed: false,
    fixture: false,
    persistentWritesAllowed: false,
    visualQualityValidated: false,
    frameBudgetValidated: false,
    method:
      'Real authenticated product and unchanged database. Browser routes allow only admin GET plus login/logout and non-persistent preview POST. Existing scene exposure reads actual WebGPU renderer, GLB root, DDGI state and camera checkpoint. Two sequential previews, one Canvas per active preview, no alternate rendering clock. Screenshots are evidence only, not visual or frame-rate acceptance.',
    startedAt: new Date().toISOString(),
    origin,
    viewport,
    asset: 'runtime-v2',
    checks: [],
    previews: [],
    requests: [],
    adminRequests: [],
    blockedRequests: [],
    failedRequests: [],
    errors: [],
    expectedSessionErrors: [],
  }
let browser, context, page, original, candidate, username, password
let stage = 'preflight'
const progress = (next) => {
  stage = next
  console.log('[reventon-admin-preview] ' + next)
}
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const redact = (value) =>
  JSON.stringify(
    value,
    (_key, item) => {
      if (typeof item !== 'string') return item
      for (const secret of [password]) if (secret) item = item.replaceAll(secret, '[redacted]')
      return item
    },
    2,
  ) + '\n'
const tab = (name) =>
  page
    .getByRole('navigation', { name: '商品编辑分区' })
    .getByRole('button', { name, exact: true })
    .click()
const closeEnough = (actual, expected, label) => {
  assert.equal(actual.length, expected.length, label)
  assert.ok(
    actual.every(
      (value, index) => Number.isFinite(value) && Math.abs(value - expected[index]) <= 1e-6,
    ),
    `${label}: actual and expected camera coordinates differ`,
  )
}

async function persisted() {
  // APIRequestContext is deliberately used only for this read; it shares the real login cookies.
  const response = await page.request.get(new URL(detailPath, origin).href)
  assert.equal(response.status(), 200, 'Authenticated persisted product GET')
  return response.json()
}
async function attach() {
  await bridge(page, true)
  await page.evaluate(() => {
    const seen = new Set()
    const find = (vnode) => {
      if (!vnode || typeof vnode !== 'object' || seen.has(vnode)) return
      seen.add(vnode)
      const current = vnode.component
      // Tres owns a separate VNode tree. The stage retains its real scene
      // exposure in sceneHost; its public exposure forwards only lighting.
      for (const source of [current?.exposed, current?.refs?.sceneHost]) {
        const exposed = source?.value ?? source,
          lighting = exposed?.realLighting?.value ?? exposed?.realLighting,
          checkpoint = exposed?.checkpoint?.value ?? exposed?.checkpoint
        if (lighting?.snapshot && typeof checkpoint === 'function')
          return { lighting, checkpoint: () => checkpoint.call(exposed) }
      }
      const nested = find(current?.subTree)
      if (nested) return nested
      for (const child of Array.isArray(vnode.children) ? vnode.children : []) {
        const found = find(child)
        if (found) return found
      }
      return find(vnode.suspense?.activeBranch)
    }
    window.__carAdminPreview = find(document.querySelector('#app')?._vnode)
    if (!window.__carAdminPreview) throw new Error('Real scene lighting/camera exposure absent')
  })
}
async function snapshot() {
  return page.evaluate(() => {
    const test = window.__demo,
      scene = test.scene.scene.value,
      renderer = test.scene.renderer.instance,
      roots = scene.children.filter((node) => node.userData.workbenchProduct),
      root = roots[0],
      camera = test.scene.camera.activeCamera.value,
      pose = window.__carAdminPreview.checkpoint()
    if (!root || !pose) throw new Error('Real GLB root or current camera checkpoint unavailable')
    let triangles = 0,
      meshes = 0
    root.traverse((node) => {
      if (!node.isMesh) return
      meshes++
      triangles +=
        ((node.geometry.index?.count ?? node.geometry.attributes.position?.count ?? 0) / 3) *
        (node.isInstancedMesh ? node.count : 1)
    })
    return {
      source: {
        products: roots.map((node) => node.userData.workbenchProduct),
        adapter: root.userData.adapter,
        kind: root.userData.sourceKind,
        bundle: root.userData.assetBundle,
        bundleVersion: root.userData.bundleVersion,
        bundleSha256: root.userData.bundleSha256,
        rootUuid: root.uuid,
        meshes,
        triangles,
        sourceTriangles: root.userData.triangles,
      },
      camera: {
        ...pose,
        actualPosition: camera.position.toArray(),
        quaternion: camera.quaternion.toArray(),
        storeRevision: test.store.revision,
      },
      host: {
        canvases: document.querySelectorAll('canvas').length,
        sameCanvas: document.querySelector('canvas') === test.canvas,
        sameRenderer: renderer === test.renderer,
        webgpu: Boolean(renderer.isWebGPURenderer && renderer.backend?.isWebGPUBackend),
      },
      output: {
        width: renderer.domElement.width,
        height: renderer.domElement.height,
        pixelRatio: renderer.getPixelRatio(),
      },
      lighting: window.__carAdminPreview.lighting.snapshot(),
    }
  })
}
function verify(value) {
  assert.deepEqual(value.source.products, [slug])
  assert.equal(value.source.kind, 'glb')
  assert.equal(value.source.adapter, 'reventon-v1')
  assert.equal(value.source.bundleVersion, 2)
  assert.equal(value.source.bundleSha256, candidate.sha256)
  assert.ok(value.source.meshes > 0)
  assert.ok(value.source.triangles > 0)
  assert.equal(value.source.sourceTriangles, value.source.triangles)
  assert.deepEqual(value.host, { canvases: 1, sameCanvas: true, sameRenderer: true, webgpu: true })
  assert.equal(value.camera.slug, slug)
  assert.equal(value.camera.revision, value.camera.storeRevision)
  closeEnough(value.camera.position, value.camera.actualPosition, 'Actual camera snapshot')
  assert.equal(value.lighting.phase, 'ready')
  assert.equal(value.lighting.error, null)
  assert.ok(
    value.lighting.frames > 0 &&
      Number.isFinite(value.lighting.firstRasterMs) &&
      value.lighting.firstRasterMs >= 0,
  )
  assert.equal(value.lighting.productProfile, 'reventon-v1')
  assert.equal(value.lighting.indirectLighting?.requested, 'ddgi')
  assert.equal(value.lighting.indirectLighting?.actual, 'ddgi', 'SSGI fallback is not a pass')
  assert.equal(value.lighting.indirectLighting?.preparing, false)
  assert.equal(value.lighting.indirectLighting?.error, null)
}
async function preview(index) {
  progress(`preview-${index}-load`)
  await tab('镜头')
  await page.getByRole('button', { name: '为默认取景采集镜头', exact: true }).click()
  await page.waitForFunction(
    () =>
      ['ready', 'error', 'content'].includes(document.querySelector('.workbench')?.dataset.status),
    null,
    { timeout },
  )
  assert.equal(await page.locator('.workbench').getAttribute('data-status'), 'ready')
  await expect(page.locator('.workbench')).toHaveAttribute('data-slug', slug)
  await expect(page.locator('.wb-stage')).toHaveAttribute('data-render-backend', 'webgpu')
  await expect(page.locator('canvas')).toHaveCount(1)
  await attach()
  await expect
    .poll(
      async () => {
        const value = await page.evaluate(() => window.__carAdminPreview.lighting.snapshot())
        if (value.error || value.indirectLighting?.error)
          throw new Error(value.error || value.indirectLighting.error)
        return value.indirectLighting?.actual === 'ddgi' && !value.indirectLighting.preparing
      },
      { timeout, intervals: [250, 500, 1000] },
    )
    .toBe(true)
  const value = await snapshot()
  verify(value)
  return value
}

try {
  assert.equal(
    process.env.REVENTON_ADMIN_GPU,
    '1',
    'Set REVENTON_ADMIN_GPU=1 only after reserving the shared GPU test slot',
  )
  assert.ok(['http:', 'https:'].includes(new URL(base).protocol), 'Local HTTP(S) demo only')
  assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname), 'Local demo only')
  assert.ok(Number.isFinite(timeout) && timeout >= 1000, 'Invalid REVENTON_ADMIN_TIMEOUT')
  assert.ok(safeOutput, 'Output must stay in ignored artifacts/')
  await mkdir(output, { recursive: true })
  const env = await readFile('server/.env.local', 'utf8'),
    credentials = Object.fromEntries(
      env.split(/\r?\n/).flatMap((line) => {
        const match = line.match(/^\s*(TREES_ADMIN_[A-Z_]+)\s*=(.*)$/)
        return match ? [[match[1], match[2].trim().replace(/^(['"])(.*)\1$/, '$2')]] : []
      }),
    )
  username = process.env.REVENTON_ADMIN_USERNAME || credentials.TREES_ADMIN_USERNAME
  password = process.env.REVENTON_ADMIN_PASSWORD || credentials.TREES_ADMIN_PASSWORD
  assert.ok(
    username && password,
    'Local TREES_ADMIN_USERNAME/PASSWORD required; credentials are not logged',
  )
  candidate = JSON.parse(await readFile('src/lib/workbench/reventonRuntimeBundle.json', 'utf8'))
  assert.equal(candidate.version, 2)
  assert.deepEqual(
    candidate,
    JSON.parse(await readFile('public/models/reventon-runtime-v2/bundle-reference.json', 'utf8')),
  )
  report.candidate = candidate
  browser = await chromium.launch({
    channel: 'msedge',
    headless: process.env.REVENTON_ADMIN_HEADLESS !== '0',
  })
  context = await browser.newContext({ viewport, deviceScaleFactor: 1, serviceWorkers: 'block' })
  await context.route('**/api/v1/admin/**', async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname,
      allowed =
        request.method() === 'GET' || (request.method() === 'POST' && allowedPosts.has(path)),
      evidence = { method: request.method(), path, allowed }
    report.adminRequests.push(evidence)
    if (allowed) await route.continue()
    else {
      report.blockedRequests.push(evidence)
      report.errors.push('Blocked persistent admin write: ' + request.method() + ' ' + path)
      await route.abort('blockedbyclient')
    }
  })
  page = await context.newPage()
  page.on('pageerror', (error) => report.errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    if (
      new URL(message.location().url || origin).pathname === '/api/v1/admin/session' &&
      /Failed to load resource.*401/.test(message.text())
    )
      report.expectedSessionErrors.push('Initial unauthenticated session GET returned 401')
    else report.errors.push(message.text())
  })
  page.on('request', (request) => report.requests.push(request.url()))
  page.on('requestfailed', (request) =>
    report.failedRequests.push({ url: request.url(), reason: request.failure()?.errorText }),
  )
  const url = new URL(
    '/admin?renderPipeline=realtime&indirectLighting=ddgi&assetLoading=streaming&reventonAsset=runtime-v2',
    origin,
  )
  report.url = url.href
  progress('login')
  await page.goto(url.href, { waitUntil: 'domcontentloaded' })
  await expect(page.getByLabel('管理员账号', { exact: true })).toBeVisible()
  await page.getByLabel('管理员账号', { exact: true }).fill(username)
  await page.getByLabel('密码', { exact: true }).fill(password)
  await page.getByRole('button', { name: '登录管理端', exact: true }).click()
  await expect(page.getByRole('button', { name: '退出登录', exact: true })).toBeVisible()
  original = await persisted()
  assert.equal(original.item.slug, slug)
  report.persistedBaselineSha256 = digest(original)
  await page.getByRole('button', { name: '编辑' + original.item.name, exact: true }).click()
  const first = await preview(1),
    point = await inputPoint(page)
  progress('right-button-pan-and-capture')
  await page.mouse.move(point.x, point.y)
  await page.mouse.down({ button: 'right' })
  await page.mouse.move(point.x + 45, point.y + 12, { steps: 8 })
  await page.mouse.up({ button: 'right' })
  await expect
    .poll(
      () =>
        page.evaluate((position) => {
          const actual = window.__demo.scene.camera.activeCamera.value.position.toArray()
          return actual.some((value, index) => Math.abs(value - position[index]) > 1e-5)
        }, first.camera.position),
      { timeout: 15000 },
    )
    .toBe(true)
  const moved = await snapshot()
  verify(moved)
  assert.equal(moved.source.rootUuid, first.source.rootUuid)
  assert.notDeepEqual(moved.camera.target, first.camera.target, 'Right-button pan moves target')
  closeEnough(
    moved.camera.position.map((value, index) => value - moved.camera.target[index]),
    first.camera.position.map((value, index) => value - first.camera.target[index]),
    'Right-button pan preserves the viewing direction',
  )
  await page.screenshot({ path: output + '/preview-pan.png', fullPage: false })
  await page.getByRole('button', { name: '使用此取景并返回', exact: true }).click()
  await expect(page.locator('canvas')).toHaveCount(0)
  await expect(
    page.getByText('取景已回填到表单，尚未保存到数据库。', { exact: true }),
  ).toBeVisible()
  await tab('高级配置')
  const captured = JSON.parse(
      await page.getByLabel('完整展示配置 JSON', { exact: true }).inputValue(),
    ),
    perspective = captured.views.find((view) => view.id === 'perspective')
  closeEnough(captured.camera.position, moved.camera.position, 'Captured camera position')
  closeEnough(captured.camera.target, moved.camera.target, 'Captured camera target')
  assert.deepEqual(perspective.position, captured.camera.position)
  assert.deepEqual(perspective.target, captured.camera.target)
  assert.deepEqual(captured.actions, original.presentation.actions)
  assert.equal(captured.camera.minDistance, original.presentation.camera.minDistance)
  assert.equal(captured.camera.maxDistance, original.presentation.camera.maxDistance)
  assert.deepEqual(await persisted(), original, 'Camera return must not write the database')
  report.previews.push({
    index: 1,
    first,
    moved,
    capturedCamera: captured.camera,
    actionsUnchanged: true,
    persistedUnchanged: true,
    canvasAfterReturn: 0,
  })
  report.checks.push(
    'Actual runtime-v2 native-GPU/DDGI preview, right-button pan, actual position/target return and perspective synchronization without persistence',
  )
  const second = await preview(2)
  closeEnough(second.camera.position, captured.camera.position, 'Repeated preview camera position')
  closeEnough(second.camera.target, captured.camera.target, 'Repeated preview camera target')
  assert.notEqual(
    second.source.rootUuid,
    first.source.rootUuid,
    'Previous preview was really unmounted',
  )
  await page.screenshot({ path: output + '/preview-repeat.png', fullPage: false })
  await page.getByRole('button', { name: '返回编辑', exact: true }).click()
  await expect(page.locator('canvas')).toHaveCount(0)
  assert.deepEqual(await persisted(), original, 'Repeated preview must not write the database')
  report.previews.push({ index: 2, state: second, persistedUnchanged: true, canvasAfterReturn: 0 })
  report.checks.push(
    'Repeated unsaved preview starts from captured draft and fully unmounts its sole Canvas without changing persisted configuration',
  )
  assert.ok(
    report.requests.some((request) =>
      /\/models\/reventon-runtime-v2\/.*\.glb$/.test(new URL(request).pathname),
    ),
    'Actual candidate GLB request required',
  )
  assert.ok(
    !report.requests.some((request) => /texture-32c687a38bb17750f1ae\.png/.test(request)),
    'Original 8K AO must not be requested',
  )
  assert.deepEqual(
    [
      ...new Set(
        report.requests.filter((url) => /^https?:/.test(url)).map((url) => new URL(url).origin),
      ),
    ],
    [origin],
  )
  assert.deepEqual(report.blockedRequests, [])
  assert.deepEqual(report.errors, [])
  assert.deepEqual(report.failedRequests, [])
  report.persistedFinalSha256 = digest(await persisted())
  assert.equal(report.persistedFinalSha256, report.persistedBaselineSha256)
  report.passed = true
} catch (error) {
  report.failure = { stage, message: error.message, stack: error.stack }
  if (safeOutput && page && !page.isClosed()) {
    report.failureSnapshot = await snapshot().catch((cause) => ({ error: cause.message }))
    await page
      .screenshot({ path: output + '/failure.png', fullPage: false, timeout: 10000 })
      .catch(() => {})
  }
  process.exitCode = 1
} finally {
  for (const resource of [page, context, browser]) await resource?.close().catch(() => {})
  report.completedAt = new Date().toISOString()
  if (safeOutput) {
    await mkdir(output, { recursive: true })
    await writeFile(output + '/report.json', redact(report))
  }
}
console.log(
  JSON.stringify({
    passed: report.passed,
    stage,
    output,
    checks: report.checks.length,
    visualQualityValidated: false,
    frameBudgetValidated: false,
  }),
)

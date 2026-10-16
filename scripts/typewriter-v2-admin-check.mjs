/* global URL */
import { chromium, expect } from '@playwright/test'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { bridge, inputPoint } from './demo/browser-check.mjs'

const base = process.env.CHECK_URL || 'http://127.0.0.1:5181'
const backend = process.env.TYPEWRITER_V2_ADMIN_BACKEND || 'webgl'
const asset = process.env.TYPEWRITER_ADMIN_ASSET || 'v2'
if (!['v2', 'paint-study'].includes(asset)) throw new Error('Invalid TYPEWRITER_ADMIN_ASSET')
const assetDirectory = asset === 'v2' ? 'typewriter-v2' : 'typewriter-paint'
const output =
  process.env.TYPEWRITER_V2_ADMIN_OUTPUT || `artifacts/${assetDirectory}/admin-${backend}`
const timeout = Number(process.env.TYPEWRITER_V2_ADMIN_TIMEOUT || 240000)
if (!['webgl', 'realtime'].includes(backend)) throw new Error('Invalid TYPEWRITER_V2_ADMIN_BACKEND')
if (!Number.isFinite(timeout) || timeout < 1000) throw new Error('Invalid preview timeout')
const origin = new URL(base).origin
const candidate = JSON.parse(
  await readFile(
    asset === 'v2'
      ? 'src/lib/workbench/typewriterV2Bundle.json'
      : 'src/lib/workbench/typewriterPaintBundle.json',
    'utf8',
  ),
)
const modelPath = new URL('model.glb', new URL(candidate.manifest, base)).pathname
const report = {
  passed: false,
  fixture: false,
  persistentWritesAllowed: false,
  backend,
  asset,
  bundleReference: candidate,
  startedAt: new Date().toISOString(),
  checks: [],
  captures: [],
  requests: [],
  blockedWrites: [],
  errors: [],
  consoleErrors: [],
  authErrors: [],
  expectedAuthProbeResponses: [],
  expectedAuthProbe401: [],
  failedRequests: [],
  limits: ['No save or database write', 'No visual-quality or frame-budget claim'],
}
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
let browser, page
let authProbeOpen = true
let requestSequence = 0
const requestEvidence = new WeakMap()
const initialSessionUrl = new URL('/api/v1/admin/session', base).href
await mkdir(output, { recursive: true })

async function section(name) {
  await page
    .getByRole('navigation', { name: '商品编辑分区' })
    .getByRole('button', { name, exact: true })
    .click()
}

async function previewReady() {
  await expect(page.locator('.workbench')).toHaveAttribute('data-slug', 'typewriter-study')
  await expect
    .poll(
      async () => {
        const status = await page.locator('.workbench').getAttribute('data-status')
        if (status === 'error' || status === 'content')
          throw new Error(
            `Preview ${status}: ${await page.locator('.wb-stage-status').innerText()}`,
          )
        return status
      },
      { timeout, intervals: [250, 500, 1000] },
    )
    .toBe('ready')
  await expect(page.locator('canvas')).toHaveCount(1)
  await expect(page.locator('.wb-stage')).toHaveAttribute(
    'data-render-backend',
    backend === 'realtime' ? 'webgpu' : 'webgl',
  )
  await expect(page.getByRole('button', { name: '使用此取景并返回', exact: true })).toBeEnabled()
  await bridge(page, true)
  // Read the existing capture provider from the real Vue tree. This disposable
  // test-window bridge does not add an application debug API or camera control.
  await page.evaluate(() => {
    let capture
    const seen = new Set()
    const visit = (vnode) => {
      if (!vnode || typeof vnode !== 'object' || seen.has(vnode)) return
      seen.add(vnode)
      const component = vnode.component
      if (component) {
        for (const key of Reflect.ownKeys(component.provides ?? {})) {
          const value = component.provides[key]
          if (
            value?.registered?.value &&
            typeof value.capture === 'function' &&
            typeof value.register === 'function' &&
            typeof value.clear === 'function'
          )
            capture = value
        }
        visit(component.subTree)
      }
      if (Array.isArray(vnode.children)) vnode.children.forEach(visit)
      visit(vnode.suspense?.activeBranch)
    }
    visit(document.querySelector('#app')?._vnode)
    if (!capture) throw new Error('Real camera capture provider unavailable')
    window.__v2AdminCapture = capture
  })
}

async function actual() {
  const state = await page.evaluate(() => {
    const { scene, store } = window.__demo
    const roots = scene.scene.value.children.filter((node) => node.userData.workbenchProduct)
    const root = roots[0]
    if (!root) throw new Error('Actual preview product root unavailable')
    let parts = 0
    root.traverse((node) => {
      if (Number.isInteger(node.userData.partId)) parts++
    })
    const snapshot = window.__v2AdminCapture.capture()
    if (!snapshot) throw new Error('Actual camera snapshot unavailable or stale')
    const camera = scene.camera.activeCamera.value
    return {
      roots: roots.map((node) => node.userData.workbenchProduct),
      rootUuid: root.uuid,
      bundle: root.userData.assetBundle,
      bundleVersion: root.userData.bundleVersion,
      bundleSha256: root.userData.bundleSha256,
      source: root.userData.sourceKind,
      adapter: root.userData.adapter,
      semanticParts: parts,
      snapshot,
      actualPosition: camera.position.toArray(),
      revision: store.revision,
      sameCanvas: document.querySelector('canvas') === window.__demo.canvas,
      sameRenderer: scene.renderer.instance === window.__demo.renderer,
      canvasCount: document.querySelectorAll('canvas').length,
    }
  })
  expect(state.roots).toEqual(['typewriter-study'])
  expect(state.source).toBe('glb')
  expect(state.adapter).toBe('typewriter-v1')
  expect(state.bundle).toBe(`${candidate.id}@${candidate.version}`)
  expect(state.bundleVersion).toBe(candidate.version)
  expect(state.bundleSha256).toBe(candidate.sha256)
  expect(state.semanticParts).toBe(572)
  expect(state.canvasCount).toBe(1)
  expect(state.sameCanvas && state.sameRenderer).toBe(true)
  expect(state.snapshot.slug).toBe('typewriter-study')
  expect(state.snapshot.revision).toBe(state.revision)
  expect(state.snapshot.position).toEqual(state.actualPosition)
  return state
}

try {
  browser = await chromium.launch({ channel: 'msedge', headless: true })
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.on('pageerror', (error) => report.errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error')
      report.consoleErrors.push({
        message: message.text(),
        location: message.location(),
        beforeLogin: authProbeOpen,
      })
  })
  page.on('request', (request) => {
    if (/^https?:/.test(request.url())) {
      requestEvidence.set(request, { id: ++requestSequence, beforeLogin: authProbeOpen })
      report.requests.push({ method: request.method(), url: request.url() })
    }
  })
  page.on('response', (response) => {
    const request = response.request()
    const url = new URL(response.url())
    if (
      url.origin !== origin ||
      !url.pathname.startsWith('/api/v1/admin/') ||
      ![401, 403].includes(response.status())
    )
      return
    const evidence = requestEvidence.get(request)
    const item = {
      requestId: evidence?.id,
      method: request.method(),
      url: response.url(),
      status: response.status(),
      requestBeforeLogin: evidence?.beforeLogin === true,
      responseBeforeLogin: authProbeOpen,
    }
    // A fresh browser's initial session probe is intentionally unauthorized.
    // It is accepted only before clicking login, for this exact GET URL and
    // actual 401 response; no login failure or later session error is exempt.
    if (
      item.method === 'GET' &&
      item.url === initialSessionUrl &&
      item.status === 401 &&
      item.requestBeforeLogin &&
      item.responseBeforeLogin
    )
      report.expectedAuthProbeResponses.push(item)
    else report.authErrors.push(item)
  })
  page.on('requestfailed', (request) =>
    report.failedRequests.push({ url: request.url(), error: request.failure()?.errorText }),
  )
  await page.route('**/api/v1/admin/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const allowed =
      request.method() === 'GET' ||
      (request.method() === 'POST' &&
        [
          '/api/v1/admin/session/login',
          '/api/v1/admin/session/logout',
          '/api/v1/admin/products/preview',
        ].includes(path))
    if (!allowed) {
      report.blockedWrites.push({ method: request.method(), path })
      await route.abort('blockedbyclient')
    } else await route.continue()
  })
  const env = await readFile('server/.env.local', 'utf8').catch((error) => {
    if (error.code === 'ENOENT') return ''
    throw error
  })
  const credentials = Object.fromEntries(
    env
      .split(/\r?\n/)
      .filter((line) => /^TREES_ADMIN_/.test(line))
      .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
  )
  const url = new URL('/admin', base)
  url.searchParams.set('typewriterAsset', asset)
  url.searchParams.set('renderPipeline', backend)
  await page.goto(url.href)
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
      .fill(process.env.TREES_ADMIN_USERNAME || credentials.TREES_ADMIN_USERNAME || 'admin')
    await page
      .getByLabel('密码', { exact: true })
      .fill(process.env.TREES_ADMIN_PASSWORD || credentials.TREES_ADMIN_PASSWORD || '123456')
    authProbeOpen = false
    await page.getByRole('button', { name: '登录管理端', exact: true }).click()
  }
  authProbeOpen = false
  await expect(page.getByRole('button', { name: '退出登录', exact: true })).toBeVisible()
  const detail = new URL('/api/v1/admin/products/typewriter-study', base).href
  const originalResponse = await page.request.get(detail)
  expect(originalResponse.ok()).toBe(true)
  const original = await originalResponse.json()
  expect(original.presentation.source.bundle.version).toBe(1)
  report.persistedBeforeSha256 = digest(original)
  await page.getByRole('button', { name: `编辑${original.item.name}`, exact: true }).click()

  for (let round = 1; round <= 2; round++) {
    await section('高级配置')
    const beforeDraft = JSON.parse(
      await page.getByLabel('完整展示配置 JSON', { exact: true }).inputValue(),
    )
    await section('镜头')
    await page.getByRole('button', { name: '为默认取景采集镜头', exact: true }).click()
    await previewReady()
    const before = await actual()
    const point = await inputPoint(page)
    await page.mouse.move(point.x, point.y)
    await page.mouse.down({ button: 'right' })
    await page.mouse.move(point.x + 45, point.y + 12, { steps: 8 })
    await page.mouse.up({ button: 'right' })
    const moved = await actual()
    expect(moved.rootUuid).toBe(before.rootUuid)
    expect(moved.snapshot.position).not.toEqual(before.snapshot.position)
    expect(moved.snapshot.target).not.toEqual(before.snapshot.target)
    const deltaPosition = moved.snapshot.position.map(
      (value, index) => value - before.snapshot.position[index],
    )
    const deltaTarget = moved.snapshot.target.map(
      (value, index) => value - before.snapshot.target[index],
    )
    deltaPosition.forEach((value, index) => expect(value).toBeCloseTo(deltaTarget[index], 5))
    await page.screenshot({ path: `${output}/preview-pan-${round}.png`, fullPage: true })
    await page.getByRole('button', { name: '使用此取景并返回', exact: true }).click()
    await expect(page.locator('canvas')).toHaveCount(0)
    await expect(
      page.getByText('取景已回填到表单，尚未保存到数据库。', { exact: true }),
    ).toBeVisible()
    const unregistered = await page.evaluate(() => ({
      registered: window.__v2AdminCapture.registered.value,
      staleSnapshot: window.__v2AdminCapture.capture() ?? null,
    }))
    expect(unregistered).toEqual({ registered: false, staleSnapshot: null })
    await section('高级配置')
    const captured = JSON.parse(
      await page.getByLabel('完整展示配置 JSON', { exact: true }).inputValue(),
    )
    const expectedDraft = JSON.parse(JSON.stringify(beforeDraft))
    expectedDraft.camera.position = moved.snapshot.position
    expectedDraft.camera.target = moved.snapshot.target
    const perspective = expectedDraft.views.find((view) => view.id === 'perspective')
    expect(perspective).toBeDefined()
    perspective.position = moved.snapshot.position
    perspective.target = moved.snapshot.target
    expect(captured).toEqual(expectedDraft)
    expect(captured.source).toEqual(original.presentation.source)
    expect(captured.actions).toEqual(original.presentation.actions)
    const persisted = await page.request.get(detail)
    expect(persisted.ok()).toBe(true)
    expect(await persisted.json()).toEqual(original)
    report.captures.push({
      round,
      before,
      moved,
      capturedCamera: captured.camera,
      unregistered,
      persistedUnchanged: true,
    })
    report.checks.push(
      `Round ${round}: actual ${asset} preview, right-pan, position/target return, perspective synchronization, no persistent changes, cleared capture provider and zero Canvas after exit`,
    )
    await page.evaluate(() => {
      delete window.__demo
      delete window.__v2AdminCapture
    })
  }
  expect([...new Set(report.requests.map((request) => new URL(request.url).origin))]).toEqual([
    origin,
  ])
  expect(
    report.requests.some((request) => new URL(request.url).pathname === candidate.manifest),
  ).toBe(true)
  expect(report.requests.some((request) => new URL(request.url).pathname === modelPath)).toBe(true)
  expect(report.blockedWrites).toEqual([])
  const unmatchedProbes = [...report.expectedAuthProbeResponses]
  for (const item of report.consoleErrors) {
    const index = unmatchedProbes.findIndex(
      (response) =>
        item.beforeLogin &&
        item.location.url === initialSessionUrl &&
        /^Failed to load resource: the server responded with a status of 401\b/.test(
          item.message,
        ) &&
        response.url === item.location.url,
    )
    if (index >= 0)
      report.expectedAuthProbe401.push({
        console: item,
        response: unmatchedProbes.splice(index, 1)[0],
      })
    else report.errors.push(item)
  }
  expect(
    unmatchedProbes,
    'Every exempt initial 401 must match one actual console location',
  ).toEqual([])
  expect(report.expectedAuthProbe401).toHaveLength(report.expectedAuthProbeResponses.length)
  expect(
    report.authErrors,
    'Login or subsequent unauthorized responses cannot be exempted',
  ).toEqual([])
  expect(report.errors).toEqual([])
  expect(report.failedRequests).toEqual([])
  report.persistedAfterSha256 = report.persistedBeforeSha256
  report.passed = true
} catch (error) {
  report.failure = error.stack || String(error)
  if (page) await page.screenshot({ path: `${output}/failure.png`, fullPage: true }).catch(() => {})
} finally {
  if (browser) await browser.close()
  report.completedAt = new Date().toISOString()
  await writeFile(`${output}/report.json`, `${JSON.stringify(report, null, 2)}\n`)
}
console.log(
  JSON.stringify(
    {
      passed: report.passed,
      backend,
      asset,
      output,
      checks: report.checks.length,
      failure: report.failure,
    },
    null,
    2,
  ),
)
if (!report.passed) process.exitCode = 1

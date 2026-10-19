/* global URL, TextEncoder, fetch */
import { chromium, expect } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { bridge, inputPoint } from './demo/browser-check.mjs'

// GPU acceptance is deliberately serialized by the caller, never an automatic npm check.
if (process.env.REVENTON_ADMIN_GPU !== '1')
  throw new Error('Set REVENTON_ADMIN_GPU=1 after reserving the GPU test slot.')
const base = process.env.CHECK_URL || 'http://127.0.0.1:5181',
  origin = new URL(base).origin,
  output = process.env.REVENTON_ADMIN_OUTPUT || 'artifacts/car-webgpu/admin-preview',
  timeout = Number(process.env.REVENTON_ADMIN_TIMEOUT || 240000),
  viewport = { width: 1440, height: 1000 }
if (!Number.isFinite(timeout) || timeout < 1000) throw new Error('Invalid REVENTON_ADMIN_TIMEOUT')
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname))
  throw new Error('Admin acceptance must target a local Trees X instance.')
const report = {
  passed: false,
  fixture: false,
  persistentWritesAllowed: false,
  presentedFrameBudgetValidated: false,
  startedAt: new Date().toISOString(),
  origin,
  viewport,
  pipeline: 'realtime',
  assetLoading: 'streaming',
  checks: [],
  captures: [],
  snapshots: {},
  requests: [],
  blockedRequests: [],
  errors: [],
  expectedErrors: [],
  failedRequests: [],
  limitations: [
    'Runs one real authenticated preview against existing data; no persistent API write is allowed.',
    'Camera checkpoint reads pause observation, matching actual capture semantics.',
    'Screenshots follow completed real frames and GPU queue settlement; no presented-frame timing is claimed.',
    'This isolated admin check does not replace thirty product reloads or the twenty-minute joint demonstration.',
  ],
}
let browser,
  context,
  page,
  stage = 'initialization',
  username = '',
  password = '',
  loginPending = true
const progress = (value) => {
  stage = value
  console.log('[car admin]', value)
}
const safeError = (error) => {
  let text = error instanceof Error ? error.stack || error.message : String(error)
  for (const secret of [password, username])
    if (secret) text = text.split(secret).join('[redacted]')
  return text
}
await mkdir(output, { recursive: true })

async function readDetail() {
  const response = await page.evaluate(async () => {
    const result = await fetch('/api/v1/admin/products/reventon', { credentials: 'same-origin' })
    return { status: result.status, body: await result.json() }
  })
  expect(response.status).toBe(200)
  return response.body
}
async function tab(name) {
  await page
    .getByRole('navigation', { name: '商品编辑分区' })
    .getByRole('button', { name, exact: true })
    .click()
}
async function snapshot() {
  return page.evaluate(async () => {
    const test = window.__carAdmin,
      context = window.__demo.scene,
      renderer = context.renderer.instance,
      camera = context.camera.activeCamera.value,
      roots = context.scene.value.children.filter((node) => node.userData.workbenchProduct),
      root = roots[0],
      checkpoint = test.runtime.checkpoint(),
      lighting = test.runtime.realLighting.snapshot(),
      poses = []
    if (!root || !checkpoint) throw new Error('Actual admin scene or camera checkpoint unavailable')
    let triangles = 0
    root.traverse((node) => {
      poses.push([
        node.name,
        node.visible,
        ...node.position.toArray(),
        ...node.quaternion.toArray(),
        ...node.scale.toArray(),
      ])
      if (node.isMesh)
        triangles +=
          ((node.geometry.index?.count ?? node.geometry.attributes.position?.count ?? 0) / 3) *
          (node.isInstancedMesh ? node.count : 1)
    })
    const digest = [
      ...new Uint8Array(
        await window.crypto.subtle.digest(
          'SHA-256',
          new TextEncoder().encode(JSON.stringify(poses)),
        ),
      ),
    ]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
    const adapter = renderer.backend?.device?.adapterInfo
    return {
      products: roots.map((node) => node.userData.workbenchProduct),
      source: root.userData.sourceKind,
      adapter: root.userData.adapter,
      bundle: root.userData.assetBundle,
      bundleSha256: root.userData.bundleSha256,
      triangles,
      sourceTriangles: root.userData.triangles,
      sourceObjects: root.userData.sourceObjects,
      rendererBackend:
        renderer.isWebGPURenderer && renderer.backend?.isWebGPUBackend ? 'webgpu' : 'other',
      sameCanvas: document.querySelector('canvas') === test.canvas,
      sameRenderer: renderer === test.renderer,
      camera: camera.position.toArray(),
      checkpoint,
      lighting,
      poseDigest: digest,
      motion: Object.fromEntries(
        Object.entries(window.__demo.motion.states.value).map(([id, value]) => [
          id,
          { progress: value.progress, target: value.target, playing: value.playing },
        ]),
      ),
      drawingBuffer: { width: renderer.domElement.width, height: renderer.domElement.height },
      gpuAdapter: adapter
        ? {
            vendor: adapter.vendor,
            architecture: adapter.architecture,
            device: adapter.device,
            description: adapter.description,
          }
        : null,
    }
  })
}
async function settleFrames(count = 4) {
  const frames = await page.evaluate(() => window.__carAdmin.runtime.realLighting.snapshot().frames)
  await page.waitForFunction(
    (target) => window.__carAdmin.runtime.realLighting.snapshot().frames >= target,
    frames + count,
    { timeout },
  )
  await page.evaluate(async () => {
    const device = window.__demo.scene.renderer.instance.backend.device
    if (!device?.queue) throw new Error('Expected real WebGPU device queue')
    await device.queue.onSubmittedWorkDone()
  })
}
async function capture(name) {
  await page.screenshot({ path: `${output}/${name}.png`, fullPage: true })
  report.captures.push(`${name}.png`)
}

try {
  const env = await readFile('server/.env.local', 'utf8').catch((error) => {
    if (error.code === 'ENOENT') return ''
    throw error
  })
  const credentials = Object.fromEntries(
    env
      .split(/\r?\n/)
      .filter((line) => /^TREES_ADMIN_/.test(line))
      .map((line) => {
        const separator = line.indexOf('=')
        return [line.slice(0, separator), line.slice(separator + 1).replace(/^(['"])(.*)\1$/, '$2')]
      }),
  )
  username =
    process.env.REVENTON_ADMIN_USERNAME ||
    process.env.REALTIME_ADMIN_USERNAME ||
    credentials.TREES_ADMIN_USERNAME ||
    'admin'
  password =
    process.env.REVENTON_ADMIN_PASSWORD ||
    process.env.REALTIME_ADMIN_PASSWORD ||
    credentials.TREES_ADMIN_PASSWORD ||
    '123456'
  browser = await chromium.launch({
    channel: 'msedge',
    headless: process.env.REVENTON_ADMIN_HEADED !== '1',
  })
  context = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion: 'reduce' })
  const allowedPosts = new Set([
    '/api/v1/admin/session/login',
    '/api/v1/admin/session/logout',
    '/api/v1/admin/products/preview',
  ])
  await context.route('**/*', async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      method = request.method()
    if (!['http:', 'https:'].includes(url.protocol)) return route.continue()
    const allowed =
      url.origin === origin &&
      (!url.pathname.startsWith('/api/') ||
        method === 'GET' ||
        (method === 'POST' && allowedPosts.has(url.pathname)))
    if (!allowed) {
      report.blockedRequests.push({ method, origin: url.origin, path: url.pathname })
      return route.abort('blockedbyclient')
    }
    return route.continue()
  })
  page = await context.newPage()
  page.setDefaultTimeout(timeout)
  page.on('pageerror', (error) => report.errors.push(safeError(error)))
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    const url = message.location().url
    if (
      loginPending &&
      /Failed to load resource.*401/.test(message.text()) &&
      url &&
      new URL(url).origin === origin &&
      new URL(url).pathname === '/api/v1/admin/session'
    )
      report.expectedErrors.push('Initial unauthenticated GET /api/v1/admin/session returned 401')
    else report.errors.push(safeError(message.text()))
  })
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (['http:', 'https:'].includes(url.protocol))
      report.requests.push({ method: request.method(), origin: url.origin, path: url.pathname })
  })
  page.on('requestfailed', (request) =>
    report.failedRequests.push({ url: request.url(), reason: request.failure()?.errorText }),
  )
  progress('Log in through the real admin UI with all persistent writes blocked')
  await page.goto(new URL('/admin?renderPipeline=realtime&assetLoading=streaming', base).href)
  await expect
    .poll(
      async () =>
        (await page.getByLabel('管理员账号', { exact: true }).isVisible()) ||
        (await page.getByRole('button', { name: '退出登录', exact: true }).isVisible()),
      { timeout: 15000 },
    )
    .toBe(true)
  if (await page.getByLabel('管理员账号', { exact: true }).isVisible()) {
    await page.getByLabel('管理员账号', { exact: true }).fill(username)
    await page.getByLabel('密码', { exact: true }).fill(password)
    await page.getByRole('button', { name: '登录管理端', exact: true }).click()
  }
  await expect(page.getByRole('button', { name: '退出登录', exact: true })).toBeVisible()
  loginPending = false
  const original = await readDetail()
  expect(original.item.slug).toBe('reventon')
  expect(original.presentation.source.kind).toBe('glb')
  expect(original.presentation.source.adapter).toBe('reventon-v1')
  expect(original.presentation.source.bundle).toMatchObject({
    id: 'reventon-workbench',
    version: 1,
    manifest: '/models/reventon/workbench-manifest.json',
    sha256: '28031a60c0e0ce12c6f9e6ba5fdb5ba5b9bf0f17ba0cd8890bba3a46d96f739d',
  })
  report.original = {
    slug: original.item.slug,
    revision: original.item.revision,
    bundle: original.presentation.source.bundle,
  }
  await page.getByRole('button', { name: `编辑${original.item.name}`, exact: true }).click()
  await tab('镜头')
  await page.getByText('默认取景坐标', { exact: true }).click()
  const editedX = original.presentation.camera.position[0] + 0.15
  await page.getByLabel('默认相机位置 X', { exact: true }).fill(String(editedX))
  await expect(page.getByText('有未保存修改', { exact: true })).toBeVisible()
  progress('Open unsaved car preview and verify its real WebGPU first frame and source identity')
  await page.getByRole('button', { name: '为默认取景采集镜头', exact: true }).click()
  await expect(page.locator('.workbench')).toHaveAttribute('data-slug', 'reventon')
  await page.waitForFunction(
    () =>
      ['ready', 'error', 'content'].includes(document.querySelector('.workbench')?.dataset.status),
    null,
    { timeout },
  )
  if ((await page.locator('.workbench').getAttribute('data-status')) !== 'ready')
    throw new Error(await page.locator('.wb-stage-status').innerText())
  await expect(page.locator('canvas')).toHaveCount(1)
  await expect(page.locator('.wb-stage')).toHaveAttribute('data-render-backend', 'webgpu')
  await bridge(page, true)
  await page.evaluate(() => {
    const seen = new Set(),
      diagnostics = []
    window.__carAdminBridgeDiagnostics = diagnostics
    function find(vnode) {
      if (!vnode || typeof vnode !== 'object' || seen.has(vnode)) return
      seen.add(vnode)
      const component = vnode.component
      if (component) {
        // Tres mounts WorkbenchScene using its custom renderer, outside the DOM
        // VNode subtree. The stage's retained template ref is the actual scene
        // exposure; WorkbenchStage's own exposure only forwards lighting.
        for (const [origin, source] of [
          ['exposed', component.exposed],
          ['refs.sceneHost', component.refs?.sceneHost],
        ]) {
          const exposed = source?.value ?? source,
            realLighting = exposed?.realLighting?.value ?? exposed?.realLighting,
            checkpoint = exposed?.checkpoint?.value ?? exposed?.checkpoint
          if (diagnostics.length < 100)
            diagnostics.push({
              component: component.type?.__name ?? component.type?.name ?? null,
              origin,
              exposedKeys:
                exposed && typeof exposed === 'object' ? Object.keys(exposed).slice(0, 24) : [],
              lightingType: typeof realLighting,
              snapshotType: typeof realLighting?.snapshot,
              checkpointType: typeof checkpoint,
            })
          if (typeof checkpoint === 'function' && realLighting?.snapshot)
            return { realLighting, checkpoint: () => checkpoint.call(exposed) }
        }
        const found = find(component.subTree)
        if (found) return found
      }
      if (Array.isArray(vnode.children))
        for (const child of vnode.children) {
          const found = find(child)
          if (found) return found
        }
      return find(vnode.suspense?.activeBranch)
    }
    const runtime = find(document.querySelector('#app')?._vnode)
    if (!runtime)
      throw new Error(
        'Real production WorkbenchScene checkpoint bridge unavailable; inspect refs.sceneHost diagnostics',
      )
    window.__carAdmin = {
      runtime,
      canvas: document.querySelector('canvas'),
      renderer: window.__demo.scene.renderer.instance,
    }
  })
  await settleFrames()
  const before = await snapshot()
  expect(before.products).toEqual(['reventon'])
  expect(before.source).toBe('glb')
  expect(before.adapter).toBe('reventon-v1')
  expect(before.bundle).toBe(
    `${original.presentation.source.bundle.id}@${original.presentation.source.bundle.version}`,
  )
  expect(before.bundleSha256).toBe(original.presentation.source.bundle.sha256)
  expect(before.sourceTriangles).toBe(before.triangles)
  expect(before.triangles).toBeGreaterThan(1000000)
  expect(before.rendererBackend).toBe('webgpu')
  expect(before.sameCanvas && before.sameRenderer).toBe(true)
  expect(before.lighting.productProfile).toBe('reventon-v1')
  expect(before.lighting.firstRasterMs).not.toBeNull()
  expect(before.lighting.error).toBeNull()
  expect(before.checkpoint.position[0]).toBeCloseTo(editedX, 6)
  expect(before.checkpoint.slug).toBe('reventon')
  expect(before.checkpoint.revision).toBe(before.lighting.revision)
  report.snapshots.beforePan = before
  report.checks.push(
    'Unsaved camera edit opens the real car on its registered WebGPU profile after an actual completed first raster, with one Canvas and renderer.',
  )
  await capture('preview-before-pan')

  progress('Right-button pan and compare actual camera position and observation target')
  const point = await inputPoint(page)
  await page.mouse.move(point.x, point.y)
  await page.mouse.down({ button: 'right' })
  await page.mouse.move(point.x + 64, point.y + 20, { steps: 8 })
  await page.mouse.up({ button: 'right' })
  await settleFrames()
  const moved = await snapshot()
  expect(moved.sameCanvas && moved.sameRenderer).toBe(true)
  expect(moved.checkpoint.position).not.toEqual(before.checkpoint.position)
  expect(moved.checkpoint.target).not.toEqual(before.checkpoint.target)
  expect(moved.poseDigest).toBe(before.poseDigest)
  expect(moved.motion).toEqual(before.motion)
  expect(moved.checkpoint.position).toEqual(moved.camera)
  report.snapshots.afterPan = moved
  await capture('preview-after-pan')
  await page.getByRole('button', { name: '使用此取景并返回', exact: true }).click()
  await expect(page.locator('canvas')).toHaveCount(0)
  await expect(
    page.getByText('取景已回填到表单，尚未保存到数据库。', { exact: true }),
  ).toBeVisible()
  await tab('高级配置')
  const captured = JSON.parse(
    await page.getByLabel('完整展示配置 JSON', { exact: true }).inputValue(),
  )
  for (const channel of ['position', 'target']) {
    captured.camera[channel].forEach((value, index) =>
      expect(value).toBeCloseTo(moved.checkpoint[channel][index], 6),
    )
    expect(captured.views.find((view) => view.id === 'perspective')[channel]).toEqual(
      captured.camera[channel],
    )
  }
  expect(captured.camera.minDistance).toBe(original.presentation.camera.minDistance)
  expect(captured.camera.maxDistance).toBe(original.presentation.camera.maxDistance)
  expect(captured.actions).toEqual(original.presentation.actions)
  expect({
    ...captured,
    camera: original.presentation.camera,
    views: original.presentation.views,
  }).toEqual(original.presentation)
  report.snapshots.returned = {
    camera: captured.camera,
    perspective: captured.views.find((view) => view.id === 'perspective'),
    actionsUnchanged: true,
    remainingPresentationUnchanged: true,
    canvasCount: await page.locator('canvas').count(),
  }
  await capture('returned-unsaved-camera')
  report.checks.push(
    'Native right-button pan changes position and target without changing car pose or actions; capture returns both vectors to default/perspective and unmounts the preview host.',
  )

  progress('Verify the full persisted admin detail remains identical parsed JSON')
  expect(await readDetail()).toEqual(original)
  report.persistedUnchanged = true
  expect(report.blockedRequests).toEqual([])
  expect(report.errors).toEqual([])
  expect(report.failedRequests).toEqual([])
  expect([...new Set(report.requests.map((request) => request.origin))]).toEqual([origin])
  expect(
    report.requests
      .filter((request) => request.method !== 'GET')
      .every((request) => request.method === 'POST' && allowedPosts.has(request.path)),
  ).toBe(true)
  expect(
    report.requests.some(
      (request) => request.path === '/api/v1/admin/products/preview' && request.method === 'POST',
    ),
  ).toBe(true)
  report.checks.push(
    'All HTTP requests stay same-origin; only GET and session/preview POST are permitted; the complete persisted product detail remains unchanged.',
  )
  report.passed = true
} catch (error) {
  report.failure = safeError(error)
  report.failedStage = stage
  if (page && !page.isClosed()) {
    await page.screenshot({ path: `${output}/failure.png`, fullPage: true }).catch(() => {})
    report.dom = await page
      .locator('body')
      .innerText()
      .catch(() => '')
    report.bridgeDiagnostics = await page
      .evaluate(() => window.__carAdminBridgeDiagnostics ?? [])
      .catch(() => [])
  }
} finally {
  await context?.close().catch((error) => report.errors.push(safeError(error)))
  await browser?.close().catch((error) => report.errors.push(safeError(error)))
  report.completedAt = new Date().toISOString()
  if (report.errors.length) report.passed = false
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2) + '\n')
  console.log(
    JSON.stringify({
      passed: report.passed,
      checks: report.checks.length,
      report: `${output}/report.json`,
      stage,
    }),
  )
  if (!report.passed) process.exitCode = 1
}

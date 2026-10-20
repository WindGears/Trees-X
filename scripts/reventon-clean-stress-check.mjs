/* global URL, fetch, setInterval, clearInterval, AbortSignal */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { performance as monotonic } from 'node:perf_hooks'
import {
  boundedAuditAttempt as boundedAttempt,
  withAuditDeadline,
} from './reventon-performance/audit-deadline.mjs'
import { chromium, expect } from '@playwright/test'
import { bridge, inputPoint } from './demo/browser-check.mjs'
import {
  collectModelTextureDescriptors,
  summarizeModelTextureMemory,
} from './reventon-performance/texture-memory.mjs'
import {
  candidateIdentity,
  options,
  resourceAssessment,
  resourceAccountingMeaning,
  resourceTolerance,
} from './reventon-clean-stress/model.mjs'

const config = options(),
  viewport = { width: 1440, height: 1000 },
  url = new URL(
    '/?product=reventon&renderPipeline=realtime&indirectLighting=ddgi&assetLoading=streaming&reventonAsset=runtime-v2',
    config.base,
  ),
  report = {
    schemaVersion: 1,
    passed: false,
    formalAcceptance: false,
    presentedFrameBudgetValidated: false,
    visualQualityValidated: false,
    fixture: false,
    startedAt: new Date().toISOString(),
    config,
    url: url.href,
    viewport,
    candidate: candidateIdentity,
    method:
      'Real local API and audited runtime-v2. Sequential retries replace the model while retaining one native WebGPU host. Complete-frame counters, physical node poses and fixed warm resource bounds are observations; they are not GPU elapsed time, display presentation, physical VRAM or visual acceptance. No production monitoring or extra render loop is installed.',
    resourcePolicy: {
      warmupReloads: 3,
      tolerance: resourceTolerance,
      accounting: resourceAccountingMeaning,
      baseline:
        'Third completed reload after twelve subsequent actual coordinator frames; never rebased upward.',
    },
    reloads: [],
    operations: [],
    soakCheckpoints: [],
    pending: [],
    errors: [],
    failedRequests: [],
    httpErrors: [],
    requestOrigins: [],
    checks: [],
  }
let browser,
  context,
  page,
  heartbeat,
  metadata,
  stage = 'preflight',
  operationStart = null
const origins = new Set(),
  progress = () =>
    console.log(
      JSON.stringify({
        event: 'car-stress-progress',
        stage,
        reloads: report.reloads.length,
        operations: report.operations.length,
        soakSeconds:
          operationStart === null ? 0 : Math.round((monotonic.now() - operationStart) / 1000),
      }),
    ),
  persist = () =>
    writeFile(`${config.output}/partial-report.json`, JSON.stringify(report, null, 2) + '\n'),
  include = (name) => config.scope === 'all' || config.scope === name,
  healthy = () => {
    assert.deepEqual(report.errors, [])
    assert.deepEqual(report.failedRequests, [])
    assert.deepEqual(report.httpErrors, [])
  }
await mkdir(config.output, { recursive: true })

async function directDom() {
  return evaluate(() => {
    const root = document.querySelector('.workbench'),
      stage = document.querySelector('.wb-stage')
    return {
      url: window.location.href,
      status: root?.dataset.status ?? null,
      slug: root?.dataset.slug ?? null,
      sceneStatus: stage?.dataset.sceneStatus ?? null,
      backend: stage?.dataset.renderBackend ?? null,
      lightingPhase: stage?.dataset.lightingPhase ?? null,
      message: document.querySelector('.wb-stage-status')?.textContent?.trim() ?? null,
      canvases: document.querySelectorAll('canvas').length,
      visibility: {
        state: document.visibilityState,
        hidden: document.hidden,
        focused: document.hasFocus(),
      },
    }
  })
}

function evaluate(pageFunction, arg) {
  return withAuditDeadline(
    'Browser evaluation',
    () => page.evaluate(pageFunction, arg),
    Math.min(config.timeout, 30000),
  )
}
function sendCdp(session, method, params) {
  return withAuditDeadline(
    'CDP ' + method,
    () => session.send(method, params),
    Math.min(config.timeout, 30000),
  )
}

async function attach() {
  await withAuditDeadline('Scene bridge', () => bridge(page), 30000)
  await evaluate(() => {
    const seen = new Set()
    const find = (vnode) => {
      if (!vnode || typeof vnode !== 'object' || seen.has(vnode)) return
      seen.add(vnode)
      const current = vnode.component,
        exposed = current?.exposed?.realLighting,
        value = exposed?.value ?? exposed
      if (value?.snapshot && value?.setSignals) return value
      const child = find(current?.subTree)
      if (child) return child
      for (const child of Array.isArray(vnode.children) ? vnode.children : []) {
        const value = find(child)
        if (value) return value
      }
      return find(vnode.suspense?.activeBranch)
    }
    window.__carStressLighting = find(document.querySelector('#app')?._vnode)
    if (!window.__carStressLighting) throw new Error('Actual coordinator unavailable')
  })
}

async function state() {
  return evaluate(() => {
    const test = window.__demo,
      scene = test.scene,
      renderer = scene.renderer.instance,
      roots = scene.scene.value.children.filter((node) => node.userData.workbenchProduct),
      root = roots[0],
      camera = scene.camera.activeCamera.value,
      motionNodes = {},
      maps = new Set()
    let meshes = 0,
      triangles = 0
    root?.updateMatrixWorld(true)
    root?.traverse((node) => {
      if (typeof node.userData.reventon_motion_id === 'string')
        motionNodes[node.userData.reventon_motion_id] = {
          position: node.position.toArray(),
          quaternion: node.quaternion.toArray(),
          world: node.matrixWorld.toArray(),
        }
      if (node.isMesh) {
        meshes++
        triangles +=
          ((node.geometry.index?.count ?? node.geometry.attributes.position.count) / 3) *
          (node.isInstancedMesh ? node.count : 1)
        for (const material of Array.isArray(node.material) ? node.material : [node.material])
          for (const value of Object.values(material)) if (value?.isTexture) maps.add(value)
      }
    })
    return {
      products: roots.map((root) => root.userData.workbenchProduct),
      rootUuid: root?.uuid,
      adapter: root?.userData.adapter,
      bundleVersion: root?.userData.bundleVersion,
      bundleSha256: root?.userData.bundleSha256,
      meshes,
      triangles,
      motionNodes,
      motion: { ...test.motion.states.value },
      selectedPart: test.store.selectedPart,
      camera: [...camera.position.toArray(), ...camera.quaternion.toArray()],
      memory: { ...renderer.info.memory },
      lighting: window.__carStressLighting.snapshot(),
      webgpu: renderer.isWebGPURenderer === true && Boolean(renderer.backend?.device),
      adapterInfo: renderer.backend?.device?.adapterInfo?.toJSON?.() ?? null,
      output: {
        width: renderer.domElement.width,
        height: renderer.domElement.height,
        dpr: window.devicePixelRatio,
      },
      canvases: document.querySelectorAll('canvas').length,
      sameCanvas: renderer.domElement === test.canvas,
      sameRenderer: renderer === test.renderer,
      textures: [...maps].map((value) => ({
        name: value.name,
        width: value.image?.width ?? value.source?.data?.width,
        height: value.image?.height ?? value.source?.data?.height,
        mipCount: value.mipmaps?.length ?? 0,
        compressed: value.isCompressedTexture === true,
        gpuFormat: renderer.backend?.get(value)?.texture?.format ?? null,
      })),
      visibility: {
        state: document.visibilityState,
        hidden: document.hidden,
        focused: document.hasFocus(),
      },
    }
  })
}

async function modelTextureMemory() {
  return summarizeModelTextureMemory(await evaluate(collectModelTextureDescriptors))
}

function verify(value) {
  healthy()
  assert.deepEqual(value.products, ['reventon'])
  assert.equal(value.adapter, 'reventon-v1')
  assert.equal(value.bundleVersion, candidateIdentity.version)
  assert.equal(value.bundleSha256, candidateIdentity.sha256)
  assert.equal(value.webgpu, true)
  assert.equal(value.canvases, 1)
  assert.equal(value.sameCanvas, true)
  assert.equal(value.sameRenderer, true)
  assert.equal(value.meshes, 135)
  assert.equal(value.triangles, 1500363)
  assert.equal(Object.keys(value.motionNodes).length, 7)
  assert.deepEqual({ width: value.output.width, height: value.output.height }, viewport)
  assert.ok(Math.abs(value.output.dpr - 1) < 1e-6)
  assert.equal(value.lighting.error, null)
  assert.equal(value.lighting.indirectLighting.error, null)
  assert.equal(value.lighting.indirectLighting.actual, 'ddgi')
  assert.ok(value.textures.length > 0)
  for (const texture of value.textures) {
    assert.ok(texture.width <= 4096 && texture.height <= 4096)
    assert.equal(texture.compressed, true)
    assert.equal(texture.mipCount, 13)
    assert.match(texture.gpuFormat, /^bc7-rgba-unorm(?:-srgb)?$/)
  }
}

async function waitFrames(count = 12) {
  const initial = (await state()).lighting.frames
  await expect
    .poll(async () => (await state()).lighting.frames, {
      timeout: config.timeout,
      intervals: [100, 250, 500],
    })
    .toBeGreaterThanOrEqual(initial + count)
}

async function ready(previousUuid = null) {
  await page.waitForFunction(
    () =>
      ['ready', 'error', 'content'].includes(document.querySelector('.workbench')?.dataset.status),
    null,
    { timeout: config.timeout, polling: 250 },
  )
  const dom = await directDom()
  report.lastReadyDom = { stage, at: new Date().toISOString(), ...dom }
  await persist()
  assert.equal(dom.status, 'ready', `Actual product ${dom.status}: ${dom.message ?? ''}`)
  // Retry normally keeps the host, but native device recovery may replace it.
  // Reacquire the real bridge before inspecting root identity; old test-window
  // references must not turn an already-ready or failed UI into a five-minute wait.
  await attach()
  const current = await state()
  if (previousUuid) assert.notEqual(current.rootUuid, previousUuid, 'Retry must replace the model')
  assert.equal(current.sameCanvas, true, 'Retry must retain the original Canvas')
  assert.equal(current.sameRenderer, true, 'Retry must retain the original renderer')
  const enhancementStarted = monotonic.now()
  while (true) {
    const lighting = (await state()).lighting
    report.lastEnhancement = { stage, at: new Date().toISOString(), lighting }
    assert.equal(lighting.error, null, `Actual lighting failed: ${lighting.error}`)
    const indirect = lighting.indirectLighting
    if (!indirect.preparing && indirect.error)
      throw new Error(
        `Requested DDGI failed; actual=${indirect.actual}, preparing=${indirect.preparing}: ${indirect.error}`,
      )
    if (indirect.actual === 'ddgi') break
    assert.ok(
      monotonic.now() - enhancementStarted < config.timeout,
      `Requested DDGI readiness timed out: ${JSON.stringify(indirect)}`,
    )
    await page.waitForTimeout(250)
  }
  await waitFrames()
  const value = await state()
  value.modelTextureMemory = await modelTextureMemory()
  verify(value)
  if (previousUuid) assert.notEqual(value.rootUuid, previousUuid)
  return value
}

async function openActions() {
  const button = page.getByRole('button', { name: '结构与动作', exact: true })
  if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click()
  await expect(page.locator('.wb-car-motion')).toBeVisible()
}
const control = (id) => page.locator(`.wb-car-motion [data-motion-id="${id}"]`)
async function motion(id) {
  return evaluate((id) => ({ ...window.__demo.motion.states.value[id] }), id)
}
async function settled(id, target) {
  await expect
    .poll(async () => (await motion(id)).progress, { timeout: config.timeout })
    .toBeCloseTo(target, 8)
  await expect.poll(async () => (await motion(id)).playing).toBe(false)
}
async function clickMotion(action, target) {
  await openActions()
  await control(action.id)
    .getByRole('button', {
      name: target ? action.motion.openLabel : action.motion.closeLabel,
      exact: true,
    })
    .click()
  await settled(action.id, target)
}
async function operation(name, perform) {
  stage = 'soak:' + name
  const entry = {
    index: report.operations.length + 1,
    name,
    startMs: monotonic.now() - operationStart,
    startedAt: new Date().toISOString(),
  }
  report.operations.push(entry)
  await perform()
  entry.endMs = monotonic.now() - operationStart
  entry.completedAt = new Date().toISOString()
  healthy()
}

async function runSoak(initial) {
  const doors = metadata.presentation.actions.find((action) => action.id === 'open-doors'),
    parts = metadata.presentation.actions.find((action) => action.id === 'explore-parts')
  // A full actual operation cycle warms actions and view/guide material states before the fixed soak baseline.
  let count = 0
  async function cycle() {
    await operation('mouse-and-keyboard', async () => {
      const point = await withAuditDeadline('Read stage input point', () => inputPoint(page), 30000)
      await page.mouse.move(point.x, point.y)
      await page.mouse.down()
      await page.mouse.move(point.x + (count % 2 ? 90 : -90), point.y + 25, { steps: 10 })
      await page.mouse.up()
      await page.mouse.wheel(0, count % 2 ? 80 : -80)
      await page.getByRole('group', { name: '商品展示区', exact: true }).focus()
      await page.keyboard.press(count % 2 ? 'ArrowLeft' : 'ArrowRight')
    })
    await operation('doors-open-and-close', async () => {
      await clickMotion(doors, 1)
      await clickMotion(doors, 0)
    })
    await operation('separation-pause-reverse', async () => {
      await openActions()
      await control(parts.id)
        .getByRole('button', { name: parts.motion.openLabel, exact: true })
        .click()
      await expect.poll(async () => (await motion(parts.id)).playing).toBe(true)
      await expect
        .poll(async () => {
          const status = await motion(parts.id)
          return status.playing && status.progress > 0 && status.progress < 1
        })
        .toBe(true)
      await control(parts.id).locator('.wb-car-pause').click()
      await expect.poll(async () => (await motion(parts.id)).playing).toBe(false)
      const paused = await state()
      assert.ok(paused.motion[parts.id].progress > 0 && paused.motion[parts.id].progress < 1)
      await waitFrames(2)
      assert.deepEqual((await state()).motionNodes, paused.motionNodes)
      await clickMotion(parts, 0)
      await clickMotion(parts, 1)
    })
    await operation('part-focus-and-view', async () => {
      await page.getByRole('button', { name: '细节', exact: true }).click()
      const part = metadata.presentation.hotspots[0]
      await page.locator('.wb-part-list button').first().click()
      await expect(page.locator('.wb-part-copy h3')).toHaveText(part.name)
      await expect.poll(async () => (await state()).selectedPart).toBe(part.id)
      await page.getByLabel('观察视角', { exact: true }).selectOption('car-cabin')
      await page.getByRole('button', { name: '返回全景', exact: true }).click()
      await expect.poll(async () => (await state()).selectedPart).toBe('')
    })
    await operation('guide-and-takeover', async () => {
      const button = page.getByRole('button', { name: '导览', exact: true })
      if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click()
      await page.getByRole('button', { name: '开始导览', exact: true }).click()
      await expect(page.locator('.wb-guide-count')).toHaveText(
        `1 / ${metadata.presentation.guide.length}`,
      )
      if (metadata.presentation.guide.length > 1)
        await page.getByRole('button', { name: '下一步', exact: true }).click()
      await page.getByRole('group', { name: '商品展示区', exact: true }).focus()
      await page.keyboard.press('ArrowRight')
      await expect(page.getByRole('button', { name: '开始导览', exact: true })).toBeVisible()
    })
    await operation('panel-state-and-product-restore', async () => {
      await openActions()
      await page
        .locator('.wb-car-motion')
        .getByRole('button', { name: '复原动作', exact: true })
        .click()
      const before = await state()
      await page.getByRole('button', { name: '收起面板', exact: true }).click()
      await expect(page.locator('#wb-inspector')).toHaveCount(0)
      await openActions()
      assert.deepEqual((await state()).motionNodes, before.motionNodes)
      await page.getByRole('button', { name: '还原商品', exact: true }).click()
      await settled(doors.id, 0)
      await settled(parts.id, 0)
      assert.deepEqual((await state()).motionNodes, initial.motionNodes)
    })
    count++
  }
  operationStart = monotonic.now()
  await cycle()
  await waitFrames()
  const baseline = (await state()).memory,
    start = monotonic.now(),
    wallStart = Date.now()
  report.soak = {
    baseline,
    cycles: 0,
    targetMs: config.seconds * 1000,
    startedAt: new Date(wallStart).toISOString(),
    warmupOperationCount: report.operations.length,
    passed: false,
  }
  const assessments = []
  do {
    await cycle()
    const snapshot = await state()
    snapshot.modelTextureMemory = await modelTextureMemory()
    verify(snapshot)
    assert.equal(snapshot.rootUuid, initial.rootUuid)
    const entry = {
      index: assessments.length + 1,
      elapsedMs: monotonic.now() - start,
      wallElapsedMs: Date.now() - wallStart,
      ...snapshot,
    }
    report.soakCheckpoints.push(entry)
    assessments.push(entry)
    const assessment = resourceAssessment(assessments, baseline)
    entry.resourceAssessment = assessment
    assert.equal(
      assessment.earlyFailure,
      false,
      'Persistent Three resource ledger growth; stop before retaining more resources',
    )
    report.soak.cycles++
    report.soak.elapsedMs = entry.elapsedMs
    report.soak.wallElapsedMs = entry.wallElapsedMs
    await persist()
    progress()
  } while (
    monotonic.now() - start < config.seconds * 1000 ||
    Date.now() - wallStart < config.seconds * 1000
  )
  assert.equal(
    assessments.at(-1).resourceAssessment.withinBaseline,
    true,
    'Final Three resource ledger counters exceed the fixed warmed baseline',
  )
  report.soak.passed = true
  report.soak.completedAt = new Date().toISOString()
  report.checks.push(
    'Actual continuous car input/action/guide/focus/panel cycles completed for the requested wall-clock duration, with one host and fixed warm allocation bounds. This is not FPS or visual certification.',
  )
}

async function realVisibility() {
  stage = 'actual-visibility'
  const session = await withAuditDeadline(
      'Create test CDP session',
      () => context.newCDPSession(page),
      30000,
    ),
    evidence = { passed: false, syntheticVisibilityUsed: false, attempts: [] }
  report.visibility = evidence
  let windowId,
    originalBounds,
    blank,
    hidden = false
  async function waitHidden(method) {
    const attempt = { method, observed: false }
    evidence.attempts.push(attempt)
    try {
      await expect
        .poll(() => evaluate(() => document.hidden && document.visibilityState === 'hidden'), {
          timeout: 5000,
        })
        .toBe(true)
      attempt.observed = true
      evidence.method = method
      return true
    } catch {
      return false
    }
  }
  async function startVisibleAction() {
    // Vue observes the latest command per flush. Separate evaluations and observed
    // completion prevent a seek being silently overwritten by a same-tick play.
    await evaluate(() => window.__demo.store.motion('seek', 'open-doors', 0.2))
    await settled('open-doors', 0.2)
    await evaluate(() => window.__demo.store.motion('play', 'open-doors', 1))
    await expect.poll(async () => (await motion('open-doors')).playing).toBe(true)
    evidence.beforeHide = await state()
    assert.equal(evidence.beforeHide.visibility.hidden, false)
    assert.equal(evidence.beforeHide.motion['open-doors'].playing, true)
  }
  try {
    await openActions()
    await startVisibleAction()
    try {
      ;({ windowId } = await sendCdp(session, 'Browser.getWindowForTarget'))
      originalBounds = (await sendCdp(session, 'Browser.getWindowBounds', { windowId })).bounds
      await sendCdp(session, 'Browser.setWindowBounds', {
        windowId,
        bounds: { windowState: 'minimized' },
      })
      hidden = await waitHidden('native-test-window-minimized')
    } catch (error) {
      if (error?.name === 'AuditDeadlineError') throw error
      evidence.windowError = String(error)
    }
    if (!hidden) {
      if (windowId !== undefined)
        await sendCdp(session, 'Browser.setWindowBounds', {
          windowId,
          bounds: { windowState: 'normal' },
        }).catch((error) => {
          if (error?.name === 'AuditDeadlineError') throw error
        })
      await page.bringToFront()
      await startVisibleAction()
      blank = await context.newPage()
      await blank.goto('about:blank')
      await blank.bringToFront()
      hidden = await waitHidden('actual-foreground-empty-tab')
    }
    if (hidden) {
      await expect.poll(async () => (await state()).lighting.active).toBe(false)
      await expect.poll(async () => (await motion('open-doors')).playing).toBe(false)
      const paused = await state()
      assert.ok(
        paused.motion['open-doors'].progress >= 0.2 && paused.motion['open-doors'].progress < 1,
        'The action must actually pause before completion; an already-finished action is not hidden-state evidence',
      )
      await page.waitForTimeout(750)
      const later = await state()
      assert.equal(later.lighting.frames, paused.lighting.frames)
      assert.deepEqual(later.motionNodes, paused.motionNodes)
      evidence.hidden = paused
    } else
      report.pending.push(
        'Actual hidden visibility was unavailable after native minimization and foreground tab; no property override, synthetic event or Page.setWebLifecycleState was substituted.',
      )
  } finally {
    // Native window restoration and CDP detach can hang after a renderer fault.
    // Record partial restoration and let the outer bounded browser close run.
    evidence.cleanup = await boundedAttempt('Visibility restoration', async () => {
      try {
        await blank?.close()
        if (windowId !== undefined)
          await sendCdp(session, 'Browser.setWindowBounds', {
            windowId,
            bounds: { windowState: 'normal' },
          })
        await page.bringToFront()
      } finally {
        await session.detach()
      }
    })
    assert.equal(evidence.cleanup.status, 'completed', 'Visibility restoration unconfirmed')
  }
  if (hidden) {
    await expect.poll(() => evaluate(() => document.visibilityState)).toBe('visible')
    await waitFrames(4)
    const resumed = await state()
    verify(resumed)
    assert.equal(resumed.motion['open-doors'].playing, false)
    assert.deepEqual(resumed.motionNodes, evidence.hidden.motionNodes)
    evidence.resumed = resumed
    evidence.passed = true
    report.checks.push(
      'Actual document.hidden stopped complete frames and actions; restoring the test window retained the paused physical pose on the same host.',
    )
  }
  if (
    originalBounds?.windowState &&
    originalBounds.windowState !== 'normal' &&
    windowId !== undefined
  ) {
    evidence.originalBoundsRestoration = await boundedAttempt(
      'Original window restoration',
      async () => {
        const restore = await withAuditDeadline(
          'Create test restoration session',
          () => context.newCDPSession(page),
          30000,
        )
        try {
          await sendCdp(restore, 'Browser.setWindowBounds', {
            windowId,
            bounds: { windowState: originalBounds.windowState },
          })
        } finally {
          await restore.detach()
        }
      },
    )
    assert.equal(
      evidence.originalBoundsRestoration.status,
      'completed',
      'Original test-window bounds restoration unconfirmed',
    )
  }
}

try {
  heartbeat = setInterval(progress, 15000)
  const local = JSON.parse(await readFile('src/lib/workbench/reventonRuntimeBundle.json', 'utf8'))
  assert.deepEqual(local, candidateIdentity)
  const json = async (path) => {
    const response = await fetch(new URL(path, config.base), { signal: AbortSignal.timeout(60000) })
    assert.equal(response.status, 200)
    return response.json()
  }
  metadata = await json('/api/v1/products/reventon')
  assert.equal(metadata.presentation.source.adapter, 'reventon-v1')
  assert.equal(metadata.presentation.version, 3)
  const response = await fetch(new URL(candidateIdentity.manifest, config.base), {
      signal: AbortSignal.timeout(60000),
    }),
    bytes = Buffer.from(await response.arrayBuffer())
  assert.equal(response.status, 200)
  assert.equal(createHash('sha256').update(bytes).digest('hex'), candidateIdentity.sha256)
  const manifest = JSON.parse(bytes.toString('utf8'))
  assert.equal(manifest.id, candidateIdentity.id)
  assert.equal(manifest.version, candidateIdentity.version)
  report.bundle = {
    ...candidateIdentity,
    files: manifest.files.length,
    bytes: manifest.files.reduce((sum, file) => sum + file.bytes, 0),
  }
  browser = await chromium.launch({ channel: 'msedge', headless: config.headless })
  report.browserVersion = browser.version()
  context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    reducedMotion: 'no-preference',
    serviceWorkers: 'block',
  })
  page = await context.newPage()
  page.setDefaultTimeout(30000)
  page.on('pageerror', (error) => report.errors.push({ type: 'pageerror', message: error.message }))
  page.on('console', (message) => {
    if (message.type() === 'error') report.errors.push({ type: 'console', message: message.text() })
  })
  page.on('requestfailed', (request) =>
    report.failedRequests.push({ url: request.url(), reason: request.failure()?.errorText }),
  )
  page.on('response', (response) => {
    if (response.status() >= 400)
      report.httpErrors.push({ url: response.url(), status: response.status() })
  })
  page.on('request', (request) => {
    if (/^https?:/.test(request.url())) origins.add(new URL(request.url()).origin)
  })
  await context.route('**/api/**', async (route) => {
    assert.equal(route.request().method(), 'GET', 'Stress test must never write business data')
    await route.continue()
  })
  stage = 'initial-load'
  await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 90000 })
  report.navigationDom = await directDom()
  await persist()
  await page.waitForFunction(
    () =>
      ['ready', 'error', 'content'].includes(document.querySelector('.workbench')?.dataset.status),
    null,
    { timeout: config.timeout, polling: 250 },
  )
  const firstDom = await directDom()
  report.initialDom = firstDom
  await persist()
  assert.equal(
    firstDom.status,
    'ready',
    `Actual product ${firstDom.status}: ${firstDom.message ?? ''}`,
  )
  await withAuditDeadline('Initial scene bridge', () => bridge(page, true), 30000)
  let current = await ready()
  report.initial = current
  await persist()
  if (include('reload')) {
    let baseline
    for (let index = 1; index <= config.reloads; index++) {
      stage = `reload-${index}`
      const previousUuid = current.rootUuid,
        started = monotonic.now()
      report.pendingReload = { index, previousUuid, startedAt: new Date().toISOString() }
      await persist()
      await evaluate(() => window.__demo.store.retry())
      report.pendingReload.apiResolvedAt = new Date().toISOString()
      report.pendingReload.dom = await directDom()
      await persist()
      current = await ready(previousUuid)
      const entry = { index, elapsedMs: monotonic.now() - started, ...current }
      report.reloads.push(entry)
      report.pendingReload = null
      if (index === 3) {
        baseline = { ...entry.memory }
        report.resourceBaseline = baseline
      }
      if (index > 3) {
        entry.resourceAssessment = resourceAssessment(report.reloads, baseline)
        assert.equal(
          entry.resourceAssessment.earlyFailure,
          false,
          'Persistent resource growth; stop before retaining more memory',
        )
      }
      await persist()
      progress()
    }
    if (report.reloads.length > 3) {
      report.reloadResourceSummary = resourceAssessment(report.reloads, baseline)
      assert.equal(
        report.reloadResourceSummary.withinBaseline,
        true,
        'Final Three resource ledger counters exceed fixed third-reload baseline',
      )
    } else
      report.pending.push(
        'Smoke reload count did not leave a post-warmup sample; resource plateau unverified.',
      )
    report.checks.push(
      'Requested sequential real retry reloads changed root UUID while preserving audited GLB identity, motions, one native renderer and one Canvas.',
    )
  }
  if (include('soak')) await runSoak(current)
  if (include('visibility')) await realVisibility()
  healthy()
  assert.deepEqual([...origins], [new URL(config.base).origin])
  report.passed = true
  report.formalAcceptance =
    !config.smoke &&
    config.scope === 'all' &&
    report.reloads.length >= 30 &&
    report.soak?.passed === true &&
    report.soak.elapsedMs >= 1200000 &&
    report.visibility?.passed === true &&
    report.pending.length === 0
} catch (error) {
  report.failure = { stage, message: error.message, stack: error.stack }
  if (page && !page.isClosed()) {
    // Concurrent DOM/state/screenshot collection has one total five-second
    // deadline, rather than three sequential budgets on an unresponsive page.
    const evidence = await boundedAttempt('Failure evidence', () =>
      Promise.allSettled([
        directDom(),
        state(),
        page.screenshot({ path: `${config.output}/failure.png`, timeout: 5000 }),
      ]),
    )
    report.failureEvidence = { status: evidence.status, error: evidence.error ?? null }
    if (evidence.status === 'completed') {
      const [dom, snapshot, screenshot] = evidence.value
      report.failureDom = dom.status === 'fulfilled' ? dom.value : { error: String(dom.reason) }
      report.failureSnapshot =
        snapshot.status === 'fulfilled' ? snapshot.value : { error: String(snapshot.reason) }
      report.failureSnapshot.dom = report.failureDom
      report.failureEvidence.screenshot =
        screenshot.status === 'fulfilled'
          ? { status: 'completed', path: 'failure.png' }
          : { status: 'failed', error: String(screenshot.reason) }
    }
    await persist()
  }
  process.exitCode = 1
} finally {
  if (heartbeat) clearInterval(heartbeat)
  report.completedAt = new Date().toISOString()
  report.requestOrigins = [...origins]
  report.cleanup = { status: 'pending', confirmed: false, requiresReview: true }
  await writeFile(`${config.output}/report.json`, JSON.stringify(report, null, 2) + '\n')
  const cleanup = await boundedAttempt('Test-owned browser close', () =>
    browser ? browser.close() : context?.close(),
  )
  report.cleanup = {
    status: cleanup.status,
    error: cleanup.error ?? null,
    confirmed: cleanup.status === 'completed',
    requiresReview: cleanup.status !== 'completed',
    completedAt: new Date().toISOString(),
    ownership: 'Only this script-created browser; no user profile or process kill.',
  }
  if (!report.cleanup.confirmed) {
    report.passed = false
    report.formalAcceptance = false
    process.exitCode = 1
  }
  await writeFile(`${config.output}/report.json`, JSON.stringify(report, null, 2) + '\n')
  console.log(
    JSON.stringify({
      passed: report.passed,
      formalAcceptance: report.formalAcceptance,
      pending: report.pending,
      failure: report.failure ?? null,
      cleanup: report.cleanup,
      output: config.output,
    }),
  )
  // A pending close must not retain the audit process indefinitely. Exiting this
  // script is not evidence that its browser exited; the suite must respect the
  // explicit unconfirmed-cleanup result before starting another GPU task.
  if (!report.cleanup.confirmed) process.exit(1)
}

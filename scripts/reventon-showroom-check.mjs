/* global performance, URL */
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { chromium, expect } from '@playwright/test'
import { inputPoint } from './demo/browser-check.mjs'
import { boundedAuditAttempt, withAuditDeadline } from './reventon-performance/audit-deadline.mjs'
import {
  installCompletedFrameTiming,
  installGpuSampler,
} from './reventon-performance/browser-timing.mjs'
import { distribution, gpuSummary, intervals } from './reventon-performance/metrics.mjs'
import { candidateIdentity } from './reventon-clean-stress/model.mjs'
import { compareCanvasImages } from './reventon-key-shadow/pixels.mjs'
import { verifyShadowMotion } from './reventon-key-shadow/model.mjs'
import {
  showroomOptions,
  showroomUrl,
  verifyShowroomState,
  verifyStaticCapture,
  showroomHtmlReport,
} from './reventon-showroom/model.mjs'
import {
  attachShowroomBridge,
  showroomState,
  cameraError,
  selectShowroomView,
  focusShowroomPart,
  seekShowroomMotion,
  flushShowroomGpu,
  timeout,
} from './reventon-showroom/browser.mjs'

const options = showroomOptions()
const report = {
  schemaVersion: 1,
  passed: false,
  visualQualityValidated: false,
  presentedFrameBudgetValidated: false,
  startedAt: new Date().toISOString(),
  options,
  viewport: { width: 1440, height: 1000 },
  runs: [],
  limitations: [
    'Headless background testing never raises a window or takes focus. Its submission throughput is not screen presentation FPS.',
    'JS completed-scene observations, GPU timestamp pass groups and actual displayed frames are distinct. Display presentation is not measured here.',
    'Engineering success and changed pixels do not establish visual quality or the 30 FPS presented-frame target; user inspection remains required.',
    'The comparison deliberately changes room, illumination and environment together. It does not isolate a reflection algorithm gain.',
    'Startup is observed once per requested variant. This is not a cold-cache distribution, reload or soak test.',
    'Screenshots hide DOM overlays only for the separate canvas image. Stochastic SSR and DDGI can vary between frames.',
    'Performance mode disables video by default; optional GPU queries and video add diagnostic overhead.',
    'Top/outside-range shots position the existing real camera after the real perspective tween ends; named views and continuous interaction use the actual controller. No configuration or database write occurs.',
  ],
}
await mkdir(options.output, { recursive: true })
let browser, context, page, activeRun
const evaluate = (fn, value) =>
  withAuditDeadline('Showroom browser query', () => page.evaluate(fn, value), 45000)
const state = () => evaluate(showroomState)
const seek = (id, progress) => seekShowroomMotion(page, id, progress)
const view = (id, custom) => selectShowroomView(page, id, custom)

async function waitForEnhanced() {
  const deadline = performance.now() + timeout
  while (performance.now() < deadline) {
    const current = await state()
    const failure =
      current.lighting.error ||
      current.lighting.indirectLighting.error ||
      current.lighting.keyShadow?.error ||
      current.showroom?.error
    if (failure) throw new Error(failure)
    if (
      activeRun.variant === 'showroom' &&
      current.showroom?.phase === 'ready' &&
      !activeRun.showroomObservedMs
    )
      activeRun.showroomObservedMs = current.atMs
    if (
      current.lighting.phase === 'ready' &&
      current.lighting.indirectLighting.actual === 'ddgi' &&
      current.lighting.keyShadow?.phase === 'ready' &&
      (activeRun.variant === 'baseline' || current.showroom?.phase === 'ready')
    )
      return
    await page.waitForTimeout(150)
  }
  throw new Error('Actual showroom / DDGI / key-shadow readiness timed out')
}

async function settled(camera, progress = {}) {
  let previous,
    stable = 0
  const first = (await state()).lighting.frames
  await expect
    .poll(
      async () => {
        const current = await state()
        activeRun.lastSettling = {
          expected: camera,
          actual: current.camera,
          firstFrame: first,
          frames: current.lighting.frames,
          motion: current.motion,
        }
        if (current.lighting.error || current.showroom?.error)
          throw new Error(current.lighting.error || current.showroom?.error)
        const complete =
          cameraError(current.camera, camera) < 1e-6 &&
          current.lighting.frames >= first + 2 &&
          Object.values(current.motion).every((value) => !value.playing) &&
          Object.entries(progress).every(
            ([id, target]) => Math.abs((current.motion[id]?.progress ?? -1) - target) < 1e-7,
          )
        const signature = JSON.stringify({ camera: current.camera, motion: current.motion })
        stable = complete && signature === previous ? stable + 1 : 0
        previous = signature
        return stable >= 3
      },
      { timeout, intervals: [100, 200, 300] },
    )
    .toBe(true)
  await flushShowroomGpu(page)
}

async function reset() {
  await seek('open-doors', 0)
  await seek('explore-parts', 0)
  return view('perspective')
}

async function capture(name, camera, progress = {}) {
  await settled(camera, progress)
  const snapshot = await state()
  verifyShowroomState(snapshot, activeRun.variant, candidateIdentity.sha256)
  if (activeRun.variant === 'showroom') verifyStaticCapture(activeRun.initial, snapshot)
  const file = name + '.png',
    canvasFile = name + '-canvas.png'
  await page.screenshot({ path: resolve(options.output, activeRun.variant, file) })
  await page.screenshot({
    path: resolve(options.output, activeRun.variant, canvasFile),
    style: 'body * { visibility:hidden !important } canvas { visibility:visible !important }',
  })
  activeRun.captures.push({ name, file, canvasFile, ...snapshot })
  console.log(JSON.stringify({ event: 'car-showroom-capture', variant: activeRun.variant, name }))
}

async function sequence(kind, seconds) {
  await settled(await reset(), { 'open-doors': 0, 'explore-parts': 0 })
  const start = await state(),
    samples = [start]
  await evaluate((kind) => {
    window.__carFrameTiming?.segment(kind)
    window.__carGpuTiming?.segment(kind)
  }, kind)
  const began = performance.now(),
    point = await inputPoint(page)
  let nextSample = 1000,
    inputs = 0
  if (kind === 'orbit') {
    await page.mouse.move(point.x, point.y)
    await page.mouse.down()
  }
  try {
    while (performance.now() - began < seconds * 1000) {
      const elapsed = performance.now() - began
      if (kind === 'orbit') {
        await page.mouse.move(
          point.x + Math.sin(elapsed / 1200) * 130,
          point.y + Math.cos(elapsed / 1500) * 32,
        )
        inputs++
      } else
        inputs += await evaluate(
          (id) => {
            const motion = window.__demo.motion.states.value[id]
            if (motion.playing) return 0
            window.__demo.store.motion('play', id, motion.progress > 0.5 ? 0 : 1)
            return 1
          },
          kind === 'doors' ? 'open-doors' : 'explore-parts',
        )
      if (elapsed >= nextSample) {
        samples.push(await state())
        nextSample += 1000
      }
      await page.waitForTimeout(kind === 'orbit' ? 16 : 50)
    }
  } finally {
    if (kind === 'orbit') await page.mouse.up()
    else
      await evaluate(
        (id) => window.__demo.store.motion('pause', id),
        kind === 'doors' ? 'open-doors' : 'explore-parts',
      )
  }
  const end = await state()
  samples.push(end)
  if (kind !== 'orbit') verifyShadowMotion(start, end)
  for (const snapshot of samples) {
    verifyShowroomState(snapshot, activeRun.variant, candidateIdentity.sha256)
    if (activeRun.variant === 'showroom') verifyStaticCapture(start, snapshot)
  }
  const elapsedMs = end.atMs - start.atMs,
    frames = end.lighting.frames - start.lighting.frames
  assert.ok(frames > 1 && elapsedMs >= seconds * 1000)
  return {
    kind,
    inputs,
    elapsedMs,
    frames,
    submittedSceneFps: (frames * 1000) / elapsedMs,
    samples,
  }
}

async function visual() {
  const zero = { 'open-doors': 0, 'explore-parts': 0 }
  await capture('whole', await reset(), zero)
  await capture(
    'room-junction',
    await view('room-junction', {
      position: [-3.6, 1.6, -5],
      target: [-6.2, 0.45, -8.2],
    }),
    zero,
  )
  await capture(
    'room-rig',
    await view('room-rig', {
      position: [0, 1.8, 6],
      target: [0, 4.8, -0.6],
    }),
    zero,
  )
  await capture(
    'floor-surface',
    await view('floor-surface', {
      position: [4, 1.1, 3.5],
      target: [3, -0.01, 0.8],
    }),
    zero,
  )
  for (const id of ['side', 'rear']) await capture(id, await view(id), zero)
  await capture(
    'top',
    await view('showroom-test-top', { position: [0, 9, -0.201], target: [0, 0.7, -0.2] }),
    zero,
  )
  for (const [name, id] of [
    ['paint-body', 'body'],
    ['door-right', 'door_1'],
    ['wheel-front', 'wheel_1_1'],
  ])
    await capture(name, await focusShowroomPart(page, id), zero)
  await seek('open-doors', 1)
  await capture('open-doors', await view('perspective'), { ...zero, 'open-doors': 1 })
  await capture('cabin', await view('car-cabin'), { ...zero, 'open-doors': 1 })
  await seek('explore-parts', 1)
  await capture('separated', await view('car-structure'), { 'open-doors': 1, 'explore-parts': 1 })
  await capture(
    'outside-room',
    await view('showroom-test-outside', { position: [0, 3, -14], target: [0, 0.7, -0.2] }),
    { 'open-doors': 1, 'explore-parts': 1 },
  )
  activeRun.visualMotion = []
  for (const kind of ['orbit', 'doors', 'separation'])
    activeRun.visualMotion.push(await sequence(kind, 4))
}

async function measure() {
  await evaluate(installCompletedFrameTiming)
  if (options.gpu) activeRun.gpuTiming = await evaluate(installGpuSampler)
  for (const kind of ['orbit', 'doors', 'separation']) {
    const segment = await sequence(kind, options.seconds)
    activeRun.segments.push(segment)
    console.log(
      JSON.stringify({
        event: 'car-showroom-runtime',
        variant: activeRun.variant,
        kind,
        elapsedMs: segment.elapsedMs,
        submittedSceneFps: segment.submittedSceneFps,
      }),
    )
  }
  activeRun.submissionTiming = await evaluate(() => window.__carFrameTiming.stop())
  for (const segment of activeRun.segments) {
    const times = activeRun.submissionTiming.completions
      .filter((entry) => entry.segment === segment.kind)
      .map((entry) => entry.atMs)
    segment.jsSubmissionIntervals = distribution(intervals(times))
  }
  if (options.gpu) {
    activeRun.gpuTiming = await evaluate(() => window.__carGpuTiming.stop())
    activeRun.gpuTiming.groups = gpuSummary(activeRun.gpuTiming.samples)
    assert.deepEqual(activeRun.gpuTiming.errors, [])
  }
}

try {
  browser = await chromium.launch({ channel: options.channel, headless: true })
  for (const variant of options.variants) {
    const directory = resolve(options.output, variant)
    await mkdir(directory, { recursive: true })
    activeRun = {
      variant,
      url: showroomUrl(options.base, variant, options.gpu),
      passed: false,
      captures: [],
      segments: [],
      errors: [],
      failedRequests: [],
      origins: [],
      httpErrors: [],
    }
    if (process.env.TREES_SHOWROOM_FLOOR) {
      assert.equal(process.env.TREES_SHOWROOM_FLOOR, 'cycles-planar')
      assert.equal(variant, 'showroom')
      const candidate = new URL(activeRun.url)
      candidate.searchParams.set('carFloor', 'cycles')
      candidate.searchParams.set('carFloorLight', 'local')
      candidate.searchParams.set('carFloorReflection', 'planar')
      if (process.env.TREES_STUDIO_FINISH === 'refined')
        candidate.searchParams.set('carStudioFinish', 'refined')
      if (process.env.TREES_STUDIO_PAINT === 'graphite')
        candidate.searchParams.set('carStudioPaint', 'graphite')
      if (process.env.TREES_CAR_MSAA === '1') candidate.searchParams.set('carAntialias', 'msaa')
      if (process.env.TREES_STUDIO_TRIM === 'satin')
        candidate.searchParams.set('carStudioTrim', 'satin')
      if (process.env.TREES_CABIN_LIGHT === 'local')
        candidate.searchParams.set('carCabinLight', 'local')
      activeRun.url = candidate.href
    }
    report.runs.push(activeRun)
    context = await browser.newContext({
      viewport: report.viewport,
      deviceScaleFactor: 1,
      ...(options.video ? { recordVideo: { dir: directory, size: report.viewport } } : {}),
    })
    page = await context.newPage()
    page.on('pageerror', (error) => activeRun.errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') activeRun.errors.push(message.text())
    })
    page.on('requestfailed', (request) =>
      activeRun.failedRequests.push({ url: request.url(), error: request.failure()?.errorText }),
    )
    page.on('response', (response) => {
      if (response.status() >= 400)
        activeRun.httpErrors.push({ url: response.url(), status: response.status() })
    })
    page.on('request', (request) => {
      if (/^https?:/.test(request.url())) activeRun.origins.push(new URL(request.url()).origin)
    })
    page.setDefaultTimeout(30000)
    await page.goto(activeRun.url, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(
      () => ['ready', 'error'].includes(document.querySelector('.workbench')?.dataset.status),
      null,
      { timeout },
    )
    assert.equal(await page.locator('.workbench').getAttribute('data-status'), 'ready')
    activeRun.interactiveObservedMs = await evaluate(() => performance.now())
    await attachShowroomBridge(page)
    await waitForEnhanced()
    activeRun.enhancedObservedMs = await evaluate(() => performance.now())
    activeRun.initial = await state()
    verifyShowroomState(activeRun.initial, variant, candidateIdentity.sha256)
    if (options.mode !== 'performance') await visual()
    if (options.mode !== 'visual') await measure()
    activeRun.final = await state()
    verifyShowroomState(activeRun.final, variant, candidateIdentity.sha256)
    activeRun.origins = [...new Set(activeRun.origins)]
    assert.deepEqual(
      activeRun.origins,
      [new URL(options.base).origin],
      'Runtime remains same-origin',
    )
    for (const key of ['errors', 'failedRequests', 'httpErrors'])
      assert.deepEqual(activeRun[key], [], key)
    activeRun.passed = true
    const video = page.video()
    await withAuditDeadline('Close completed showroom context', () => context.close(), 10000)
    if (video) activeRun.video = relative(options.output, await video.path()).replaceAll('\\', '/')
    context = page = null
    await writeFile(resolve(directory, 'report.json'), JSON.stringify(activeRun, null, 2) + '\n')
  }
  const baseline = report.runs.find((run) => run.variant === 'baseline'),
    showroom = report.runs.find((run) => run.variant === 'showroom')
  if (baseline && showroom) {
    report.canvasDifferences = []
    for (const shot of baseline.captures) {
      const matching = showroom.captures.find((capture) => capture.name === shot.name)
      assert.ok(matching)
      assert.deepEqual(shot.camera, matching.camera, 'Same actual comparison camera: ' + shot.name)
      report.canvasDifferences.push({
        name: shot.name,
        ...(await compareCanvasImages(
          resolve(options.output, 'baseline', shot.canvasFile),
          resolve(options.output, 'showroom', matching.canvasFile),
        )),
      })
    }
  }
  report.passed = true
} catch (error) {
  report.failure = { message: error.message, stack: error.stack }
  if (page) await page.screenshot({ path: resolve(options.output, 'failure.png') }).catch(() => {})
} finally {
  if (page)
    await page
      .evaluate(async () => {
        window.__carFrameTiming?.stop()
        await window.__carGpuTiming?.stop()
      })
      .catch(() => {})
  for (const [name, operation] of [
    ['contextCleanup', () => context?.close()],
    ['cleanup', () => browser?.close()],
  ]) {
    const result = await boundedAuditAttempt(
      'Close owned showroom browser resources',
      operation,
      5000,
    )
    report[name] = { status: result.status, confirmed: result.status === 'completed' }
    if (!report[name].confirmed) report.passed = false
  }
  report.completedAt = new Date().toISOString()
  await writeFile(resolve(options.output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  await writeFile(resolve(options.output, 'index.html'), showroomHtmlReport(report))
}
console.log(
  JSON.stringify({
    passed: report.passed,
    output: options.output,
    failure: report.failure?.message,
  }),
)
if (!report.passed) process.exitCode = 1

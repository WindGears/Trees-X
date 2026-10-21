/* global URL, performance, requestAnimationFrame */
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { chromium, expect } from '@playwright/test'
import { bridge, inputPoint } from './demo/browser-check.mjs'
import { boundedAuditAttempt } from './reventon-performance/audit-deadline.mjs'
import {
  installCompletedFrameTiming,
  installGpuSampler,
} from './reventon-performance/browser-timing.mjs'
import { distribution, gpuSummary, intervals } from './reventon-performance/metrics.mjs'
import { candidateIdentity } from './reventon-clean-stress/model.mjs'
import { assertExecutedSsr, installSsrObservation } from './reventon-studio/ssr-observation.mjs'
import {
  htmlReport,
  studioOptions,
  studioUrl,
  verifyStudioState,
} from './reventon-studio/model.mjs'

const options = studioOptions()
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
    'A completed procedure is not human visual acceptance or a verified 30 FPS display target.',
    'Completed scene counts and JS submission observations are not screen presentation FPS.',
    'GPU timestamp-query pass groups are reported separately; they are not whole displayed-frame times.',
    'Fresh browser contexts do not clear OS files, GPU driver shader caches or GPU state.',
    'Performance mode disables video by default. --gpu 1 and --video 1 add diagnostic overhead.',
    'Input injection can perturb workloads; this is a short startup / interaction check, not a reload or soak test.',
    'Tests run headless in the background and never raise a browser window or take user focus. Background submission measurements are not display presentation FPS.',
    'Visual mode observes native SSR update execution and output identities without GPU readback. This hook is not installed during performance mode.',
  ],
}
const timeout = 240000
let browser, page, context, activeRun
await mkdir(options.output, { recursive: true })

async function attach() {
  await bridge(page, true)
  await page.evaluate(() => {
    const seen = new Set()
    const find = (vnode) => {
      if (!vnode || typeof vnode !== 'object' || seen.has(vnode)) return
      seen.add(vnode)
      const component = vnode.component
      const exposed = component?.exposed?.realLighting
      const value = exposed?.value ?? exposed
      if (value?.snapshot && value?.setSignals) return value
      const child = find(component?.subTree)
      if (child) return child
      for (const entry of Array.isArray(vnode.children) ? vnode.children : []) {
        const found = find(entry)
        if (found) return found
      }
      return find(vnode.suspense?.activeBranch)
    }
    window.__carLighting = find(document.querySelector('#app')?._vnode)
    if (!window.__carLighting) throw new Error('Real lighting facade is required')
    window.__carStudioErrors = []
    window.__demo.scene.renderer.instance.backend.device.addEventListener(
      'uncapturederror',
      (event) => window.__carStudioErrors.push(event.error?.message ?? 'Unknown GPU error'),
    )
  })
  if (options.mode !== 'performance') await page.evaluate(installSsrObservation)
}

const state = () =>
  page.evaluate(() => {
    const scene = window.__demo.scene
    const renderer = scene.renderer.instance
    const root = scene.scene.value.children.find((node) => node.userData.workbenchProduct)
    const camera = scene.camera.activeCamera.value
    const direction = camera.getWorldDirection(camera.position.clone())
    const lights = []
    scene.scene.value.traverse((node) => {
      if (node.isLight)
        lights.push({
          name: node.name,
          type: node.type,
          color: node.color.toArray(),
          intensity: node.intensity,
          width: node.width,
          height: node.height,
          position: node.position.toArray(),
          quaternion: node.quaternion.toArray(),
        })
    })
    return {
      atMs: performance.now(),
      product: root?.userData.workbenchProduct,
      sha256: root?.userData.bundleSha256,
      carStudioQuality: root?.userData.carStudioQuality ?? null,
      backend: renderer.backend.isWebGPUBackend ? 'webgpu' : 'other',
      canvases: document.querySelectorAll('canvas').length,
      sameCanvas: renderer.domElement === window.__demo.canvas,
      sameRenderer: renderer === window.__demo.renderer,
      output: [renderer.domElement.width, renderer.domElement.height],
      camera: {
        position: camera.position.toArray(),
        direction: direction.toArray(),
        projection: camera.projectionMatrix.toArray(),
      },
      exposure: renderer.toneMappingExposure,
      lights,
      environmentIntensity: scene.scene.value.environmentIntensity,
      lighting: window.__carLighting.snapshot(),
      motion: { ...window.__demo.motion.states.value },
      visibility: document.visibilityState,
      focus: document.hasFocus(),
      memory: { ...renderer.info.memory },
      gpuErrors: [...window.__carStudioErrors],
      ssrExecution: window.__carSsrObservation?.read() ?? null,
    }
  })

function cameraError(actual, expected) {
  const direction = expected.target.map((value, index) => value - expected.position[index])
  const length = Math.hypot(...direction)
  return Math.max(
    ...actual.position.map((value, index) => Math.abs(value - expected.position[index])),
    ...actual.direction.map((value, index) => Math.abs(value - direction[index] / length)),
  )
}

async function settled(expectedCamera, progress = {}) {
  let previous,
    stable = 0
  const firstFrame = (await state()).lighting.frames
  await expect
    .poll(
      async () => {
        const current = await state()
        if (current.lighting.error || current.lighting.indirectLighting.error)
          throw new Error(current.lighting.error || current.lighting.indirectLighting.error)
        const complete =
          cameraError(current.camera, expectedCamera) < 1e-6 &&
          Object.values(current.motion).every((motion) => !motion.playing) &&
          Object.entries(progress).every(
            ([id, target]) => Math.abs((current.motion[id]?.progress ?? -1) - target) < 1e-7,
          ) &&
          current.lighting.frames >= firstFrame + 2
        const signature = JSON.stringify({ camera: current.camera, motion: current.motion })
        stable = complete && signature === previous ? stable + 1 : 0
        previous = signature
        return stable >= 3
      },
      { timeout, intervals: [100, 200, 300] },
    )
    .toBe(true)
  await page.evaluate(async () => {
    await window.__demo.scene.renderer.instance.backend.device.queue.onSubmittedWorkDone()
    await new Promise(requestAnimationFrame)
    await new Promise(requestAnimationFrame)
  })
}

async function view(id) {
  const expected = await page.evaluate((id) => {
    const store = window.__demo.store
    const view = store.presentation.views.find((item) => item.id === id)
    if (!view) throw new Error('Required named view: ' + id)
    store.view(id)
    return { position: [...view.position], target: [...view.target] }
  }, id)
  return expected
}

async function focus(id) {
  return page.evaluate((id) => {
    const { store, scene } = window.__demo
    const hotspot = store.presentation.hotspots.find((item) => item.id === id)
    const root = scene.scene.value.children.find((node) => node.userData.workbenchProduct)
    const node = root.getObjectByName(hotspot?.node)
    if (!hotspot || !node) throw new Error('Required actual hotspot: ' + id)
    const target = node
      .localToWorld(
        scene.camera.activeCamera.value.position.clone().fromArray(hotspot.anchor ?? [0, 0, 0]),
      )
      .toArray()
    store.focus(id)
    return { position: target.map((value, index) => value + hotspot.cameraOffset[index]), target }
  }, id)
}

async function seek(id, progress) {
  await page.evaluate(({ id, progress }) => window.__demo.store.motion('seek', id, progress), {
    id,
    progress,
  })
  await page.waitForFunction(
    ({ id, progress }) =>
      Math.abs(window.__demo.motion.states.value[id].progress - progress) < 1e-7,
    { id, progress },
  )
}

async function reset() {
  await seek('open-doors', 0)
  await seek('explore-parts', 0)
  return view('perspective')
}

async function capture(name, camera, progress) {
  await settled(camera, progress)
  const snapshot = await state()
  verifyStudioState(snapshot, activeRun.variant, candidateIdentity.sha256)
  assertExecutedSsr(snapshot.ssrExecution, activeRun.variant === 'studio' ? 2 : 1)
  const file = name + '.png'
  await page.screenshot({ path: resolve(options.output, activeRun.variant, file) })
  activeRun.captures.push({ name, file, ...snapshot })
  console.log(JSON.stringify({ event: 'car-studio-capture', variant: activeRun.variant, name }))
}

async function sequence(kind, seconds) {
  const camera = await reset()
  await settled(camera, { 'open-doors': 0, 'explore-parts': 0 })
  const start = await state()
  const samples = [start]
  await page.evaluate((kind) => {
    window.__carFrameTiming?.segment(kind)
    window.__carGpuTiming?.segment(kind)
  }, kind)
  const began = performance.now()
  let nextSample = 1000,
    inputs = 0
  const point = await inputPoint(page)
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
      } else {
        inputs += await page.evaluate(
          (id) => {
            const motion = window.__demo.motion.states.value[id]
            if (motion.playing) return 0
            window.__demo.store.motion('play', id, motion.progress > 0.5 ? 0 : 1)
            return 1
          },
          kind === 'doors' ? 'open-doors' : 'explore-parts',
        )
      }
      if (elapsed >= nextSample) {
        samples.push(await state())
        nextSample += 1000
      }
      await page.waitForTimeout(kind === 'orbit' ? 16 : 50)
    }
  } finally {
    if (kind === 'orbit') await page.mouse.up()
    else
      await page.evaluate(
        (id) => window.__demo.store.motion('pause', id),
        kind === 'doors' ? 'open-doors' : 'explore-parts',
      )
  }
  const end = await state()
  samples.push(end)
  for (const snapshot of samples) {
    verifyStudioState(snapshot, activeRun.variant, candidateIdentity.sha256)
    if (snapshot.ssrExecution)
      assertExecutedSsr(snapshot.ssrExecution, activeRun.variant === 'studio' ? 2 : 1)
  }
  const elapsedMs = end.atMs - start.atMs
  const frames = end.lighting.frames - start.lighting.frames
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
  for (const [name, id] of [
    ['paint-body', 'body'],
    ['door-right', 'door_1'],
    ['wheel-front', 'wheel_1_1'],
  ])
    await capture(name, await focus(id), zero)
  await seek('open-doors', 1)
  await capture('cabin', await view('car-cabin'), { ...zero, 'open-doors': 1 })
  await seek('explore-parts', 1)
  await capture('separated', await view('car-structure'), { 'open-doors': 1, 'explore-parts': 1 })
  // An actual short operation sequence, not still-image video interpolation.
  activeRun.visualMotion = []
  for (const kind of ['orbit', 'doors', 'separation'])
    activeRun.visualMotion.push(await sequence(kind, 4))
}

async function measure() {
  if (options.mode !== 'performance')
    activeRun.ssrObservation = await page.evaluate(() => {
      const result = window.__carSsrObservation?.stop()
      delete window.__carSsrObservation
      return result
    })
  await page.evaluate(installCompletedFrameTiming)
  if (options.gpu) activeRun.gpuTiming = await page.evaluate(installGpuSampler)
  for (const kind of ['orbit', 'doors', 'separation']) {
    const segment = await sequence(kind, options.seconds)
    activeRun.segments.push(segment)
    console.log(
      JSON.stringify({
        event: 'car-studio-runtime',
        variant: activeRun.variant,
        kind,
        elapsedMs: segment.elapsedMs,
        submittedSceneFps: segment.submittedSceneFps,
      }),
    )
  }
  activeRun.submissionTiming = await page.evaluate(() => window.__carFrameTiming.stop())
  for (const segment of activeRun.segments) {
    const times = activeRun.submissionTiming.completions
      .filter((entry) => entry.segment === segment.kind)
      .map((entry) => entry.atMs)
    segment.jsSubmissionIntervals = distribution(intervals(times))
  }
  if (options.gpu) {
    activeRun.gpuTiming = await page.evaluate(() => window.__carGpuTiming.stop())
    activeRun.gpuTiming.groups = gpuSummary(activeRun.gpuTiming.samples)
    assert.deepEqual(activeRun.gpuTiming.errors, [])
  }
}

try {
  browser = await chromium.launch({ channel: options.channel, headless: options.headless })
  for (const variant of options.variants) {
    const directory = resolve(options.output, variant)
    await mkdir(directory, { recursive: true })
    activeRun = {
      variant,
      url: studioUrl(options.base, variant, options.gpu),
      passed: false,
      captures: [],
      segments: [],
      errors: [],
      failedRequests: [],
      origins: [],
      httpErrors: [],
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
      activeRun.failedRequests.push({
        url: request.url(),
        error: request.failure()?.errorText,
      }),
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
    activeRun.interactiveObservedMs = await page.evaluate(() => performance.now())
    await attach()
    await expect
      .poll(
        async () => {
          const current = await state()
          if (current.lighting.error || current.lighting.indirectLighting.error)
            throw new Error(current.lighting.error || current.lighting.indirectLighting.error)
          return (
            current.lighting.phase === 'ready' &&
            current.lighting.indirectLighting.actual === 'ddgi'
          )
        },
        { timeout, intervals: [100, 250] },
      )
      .toBe(true)
    activeRun.enhancedObservedMs = await page.evaluate(() => performance.now())
    if (options.mode !== 'performance')
      await expect
        .poll(async () => Boolean((await state()).ssrExecution?.lastComplete), {
          timeout: 30000,
          intervals: [100, 250],
        })
        .toBe(true)
    activeRun.initial = await state()
    verifyStudioState(activeRun.initial, variant, candidateIdentity.sha256)
    await page.waitForTimeout(1000)
    if (options.mode !== 'performance') await visual()
    if (options.mode !== 'visual') await measure()
    activeRun.final = await state()
    activeRun.origins = [...new Set(activeRun.origins)]
    assert.deepEqual(
      activeRun.origins,
      [new URL(options.base).origin],
      'Runtime remains same-origin',
    )
    assert.deepEqual(activeRun.errors, [])
    assert.deepEqual(activeRun.failedRequests, [])
    assert.deepEqual(activeRun.httpErrors, [])
    verifyStudioState(activeRun.final, variant, candidateIdentity.sha256)
    if (options.mode === 'visual') {
      activeRun.ssrObservation = await page.evaluate(() => window.__carSsrObservation.stop())
      assert.equal(activeRun.ssrObservation.restored, true)
    }
    activeRun.passed = true
    const video = page.video()
    await context.close()
    if (video) activeRun.video = relative(options.output, await video.path()).replaceAll('\\', '/')
    context = null
    page = null
    await writeFile(resolve(directory, 'report.json'), JSON.stringify(activeRun, null, 2) + '\n')
  }
  const materials = report.runs.find((run) => run.variant === 'materials')
  const studio = report.runs.find((run) => run.variant === 'studio')
  if (materials && studio)
    for (const key of ['lights', 'exposure', 'environmentIntensity'])
      assert.deepEqual(studio.initial[key], materials.initial[key], 'Frozen studio inputs: ' + key)
  report.passed = true
} catch (error) {
  report.failure = { message: error.message, stack: error.stack }
  if (page) await page.screenshot({ path: resolve(options.output, 'failure.png') }).catch(() => {})
} finally {
  if (page) {
    await page
      .evaluate(async () => {
        window.__carFrameTiming?.stop()
        window.__carSsrObservation?.stop()
        await window.__carGpuTiming?.stop()
      })
      .catch(() => {})
  }
  await context?.close().catch(() => {})
  const cleanup = await boundedAuditAttempt(
    'Close owned studio browser',
    () => browser?.close(),
    5000,
  )
  report.cleanup = { status: cleanup.status, confirmed: cleanup.status === 'completed' }
  if (!report.cleanup.confirmed) report.passed = false
  report.completedAt = new Date().toISOString()
  await writeFile(resolve(options.output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  await writeFile(resolve(options.output, 'index.html'), htmlReport(report))
}
console.log(
  JSON.stringify({
    passed: report.passed,
    output: options.output,
    failure: report.failure?.message,
  }),
)
if (!report.passed) process.exitCode = 1

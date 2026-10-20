/* global URL, fetch, performance, setInterval, clearInterval, MutationObserver */
import { chromium, expect } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { setTimeout, clearTimeout } from 'node:timers'
import { bridge, inputPoint, phaseLabels } from './demo/browser-check.mjs'
import {
  installCompletedFrameTiming,
  installGpuSampler,
} from './reventon-performance/browser-timing.mjs'
import {
  distribution,
  gpuSummary,
  intervals,
  performanceOptions,
  performanceUrl,
  presentationEvidence,
} from './reventon-performance/metrics.mjs'
import {
  collectModelTextureDescriptors,
  summarizeModelTextureMemory,
} from './reventon-performance/texture-memory.mjs'
import { readTraceStream } from './reventon-performance/trace-stream.mjs'

const options = performanceOptions(),
  url = performanceUrl(options),
  viewport = { width: 1440, height: 1000 },
  report = {
    passed: false,
    passedMeaning:
      'The measurement procedure completed; this does not certify the 30FPS presentation target.',
    presentedBudgetValidated: false,
    formalDuration: options.seconds >= 30 && options.rounds >= 3,
    options,
    url,
    viewport,
    deviceScaleFactor: 1,
    startedAt: new Date().toISOString(),
    rounds: [],
    errors: [],
    failedRequests: [],
    requests: [],
    limitations: [
      'Completed frame intervals are JS command-submission completion callbacks, not GPU or display times.',
      'GPU timestamp-query, wrappers, input injection and CDP tracing perturb the measured workload.',
      'Three memory is accounted resource allocation, not physical resident VRAM.',
      'A fresh browser context does not reset driver shader cache, OS file cache or GPU state.',
    ],
  }
let browser,
  context,
  page,
  session,
  heartbeat,
  tracing = false,
  stage = 'metadata'
const progress = () =>
  console.log(
    JSON.stringify({
      event: 'reventon-performance-progress',
      stage,
      asset: options.asset,
      tuning: options.tuning,
      completedRounds: report.rounds.length,
    }),
  )
await mkdir(options.output, { recursive: true })

async function attachLighting() {
  await bridge(page, true)
  await page.evaluate(() => {
    const seen = new Set()
    const find = (vnode) => {
      if (!vnode || typeof vnode !== 'object' || seen.has(vnode)) return
      seen.add(vnode)
      const current = vnode.component
      if (current) {
        const exposed = current.exposed?.realLighting,
          value = exposed?.value ?? exposed
        if (value?.snapshot && value?.setSignals) return value
        const found = find(current.subTree)
        if (found) return found
      }
      if (Array.isArray(vnode.children))
        for (const child of vnode.children) {
          const found = find(child)
          if (found) return found
        }
      return find(vnode.suspense?.activeBranch)
    }
    window.__carLighting = find(document.querySelector('#app')?._vnode)
  })
}

async function state() {
  const snapshot = await page.evaluate(() => {
    const { scene: context, store } = window.__demo,
      renderer = context.renderer.instance,
      canvas = renderer.domElement,
      root = context.scene.value.children.find((node) => node.userData.workbenchProduct),
      rect = canvas.getBoundingClientRect(),
      info = renderer.backend.device?.adapterInfo
    return {
      product: root?.userData.workbenchProduct,
      adapter: root?.userData.adapter,
      bundle: root?.userData.assetBundle,
      bundleVersion: root?.userData.bundleVersion,
      bundleSha256: root?.userData.bundleSha256,
      memory: { ...renderer.info.memory },
      lighting: window.__carLighting?.snapshot(),
      motion: { ...window.__demo.motion.states.value },
      finish: store.finishId,
      pageState: {
        visibilityState: document.visibilityState,
        hasFocus: document.hasFocus(),
      },
      output: {
        cssWidth: rect.width,
        cssHeight: rect.height,
        dpr: window.devicePixelRatio,
        rendererPixelRatio: renderer.getPixelRatio(),
        width: canvas.width,
        height: canvas.height,
      },
      backend: renderer.backend.isWebGPUBackend ? 'webgpu' : 'other',
      device: info
        ? {
            vendor: info.vendor,
            architecture: info.architecture,
            device: info.device,
            description: info.description,
          }
        : null,
      canvases: document.querySelectorAll('canvas').length,
      sameCanvas: canvas === window.__demo.canvas,
      sameRenderer: renderer === window.__demo.renderer,
    }
  })
  snapshot.modelTextureMemory = summarizeModelTextureMemory(
    await page.evaluate(collectModelTextureDescriptors),
  )
  return snapshot
}

async function reset() {
  await page.evaluate(() => {
    const store = window.__demo.store
    store.motion('reset', 'open-doors')
    store.motion('reset', 'explore-parts')
    store.view('perspective')
  })
  await page.waitForTimeout(900)
}

async function runSequence(kind, durationMs) {
  const started = performance.now()
  let inputs = 0
  if (kind === 'orbit') {
    const point = await inputPoint(page)
    await page.mouse.move(point.x, point.y)
    await page.mouse.down()
    try {
      while (performance.now() - started < durationMs) {
        const time = (performance.now() - started) / 1000
        await page.mouse.move(
          point.x + 120 * Math.sin(time * 0.8),
          point.y + 35 * Math.cos(time * 0.6),
        )
        inputs++
        await page.waitForTimeout(16)
      }
    } finally {
      await page.mouse.up()
    }
  } else {
    const id = kind === 'doors' ? 'open-doors' : 'explore-parts'
    while (performance.now() - started < durationMs) {
      inputs += await page.evaluate((id) => {
        const motion = window.__demo.motion.states.value[id]
        if (motion?.playing) return 0
        window.__demo.store.motion('play', id, motion?.progress > 0.5 ? 0 : 1)
        return 1
      }, id)
      await page.waitForTimeout(50)
    }
    await page.evaluate((id) => window.__demo.store.motion('pause', id), id)
  }
  return { kind, inputs, elapsedMs: performance.now() - started }
}

async function finishTrace() {
  if (!tracing) return null
  tracing = false
  let timeout, onComplete
  try {
    const complete = new Promise((resolve, reject) => {
      onComplete = resolve
      session.once('Tracing.tracingComplete', onComplete)
      timeout = setTimeout(() => reject(new Error('Trace completion timed out after 30s')), 30000)
    })
    // Start both waits together so a rejected completion cannot become an
    // unhandled rejection while the CDP end acknowledgement is pending.
    const [{ stream }] = await Promise.all([complete, session.send('Tracing.end')])
    if (typeof stream !== 'string' || !stream) throw new Error('CDP trace stream handle missing')
    const { trace, metadata } = await readTraceStream(session, stream, {
      outputPath: `${options.output}/trace.json`,
    })
    report.traceMetadata = metadata
    if (!metadata.available) report.traceFailure = metadata.reason
    return trace
  } catch (cause) {
    // Tracing is supplemental. Independent GPU/JS observations already taken
    // remain usable even if the diagnostic stream or artifact cannot be read.
    report.traceFailure = String(cause)
    report.traceMetadata ??= { available: false, reason: report.traceFailure }
    return null
  } finally {
    if (timeout) clearTimeout(timeout)
    if (onComplete) session.off('Tracing.tracingComplete', onComplete)
  }
}

try {
  heartbeat = setInterval(progress, 30000)
  const response = await fetch(new URL('/api/v1/products/reventon', options.base))
  expect(response.ok, 'Actual car API').toBe(true)
  const product = await response.json(),
    source = product.presentation.source,
    originalBundle = `${source.bundle.id}@${source.bundle.version}`
  report.originalSource = source
  browser = await chromium.launch({ channel: options.channel, headless: options.headless })
  report.browserVersion = browser.version()
  context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    reducedMotion: 'no-preference',
  })
  page = await context.newPage()
  page.on('pageerror', (error) => report.errors.push({ type: 'pageerror', message: error.message }))
  page.on('console', (message) => {
    if (message.type() === 'error') report.errors.push({ type: 'console', message: message.text() })
  })
  page.on('request', (request) => report.requests.push(request.url()))
  page.on('requestfailed', (request) =>
    report.failedRequests.push({ url: request.url(), reason: request.failure()?.errorText }),
  )
  await page.addInitScript((phaseLabels) => {
    const entries = [],
      labels = new Map(Object.entries(phaseLabels).map(([key, value]) => [value, key]))
    let previous = ''
    const observe = () => {
      const root = document.querySelector('.workbench'),
        status = root?.dataset.status,
        label = document.querySelector('.wb-stage-status p')?.textContent?.trim() ?? '',
        key = `${status}:${label}`
      if (!root || key === previous) return
      previous = key
      entries.push({
        atMs: performance.now(),
        slug: root.dataset.slug,
        status,
        phase: labels.get(label) ?? null,
        label,
      })
    }
    const observer = new MutationObserver(observe)
    observer.observe(document, {
      subtree: true,
      attributes: true,
      childList: true,
      characterData: true,
    })
    window.__carLoading = {
      entries,
      stop: () => {
        observe()
        observer.disconnect()
        return entries
      },
    }
  }, phaseLabels)
  session = await context.newCDPSession(page)
  await session.send('Network.enable')
  await session.send('Network.clearBrowserCache')
  await session.send('Network.setCacheDisabled', { cacheDisabled: true })
  await session.send('Network.setBypassServiceWorker', { bypass: true })
  stage = 'load'
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 })
  // Start query drainage as soon as the real renderer exists, before expensive
  // asset bring-up can fill Three's fixed-size timestamp pool.
  await expect
    .poll(
      async () => {
        try {
          await attachLighting()
          return await page.evaluate(() =>
            Boolean(window.__demo.scene.renderer.instance.backend?.device),
          )
        } catch {
          return false
        }
      },
      { timeout: 120000, intervals: [100, 250, 500] },
    )
    .toBe(true)
  report.gpuTiming = await page.evaluate(installGpuSampler)
  report.gpuTiming.requested = options.gpuTiming
  if (!options.gpuTiming)
    expect(
      report.gpuTiming.supported,
      'Timestamp instrumentation must stay off in JS-only run',
    ).toBe(false)
  await page.waitForFunction(
    () =>
      ['ready', 'error', 'content'].includes(document.querySelector('.workbench')?.dataset.status),
    null,
    { timeout: 300000 },
  )
  expect(await page.locator('.workbench').getAttribute('data-status'), 'Real car first frame').toBe(
    'ready',
  )
  await attachLighting()
  const initial = await state()
  expect(initial.product).toBe('reventon')
  expect(initial.adapter).toBe('reventon-v1')
  expect(initial.backend).toBe('webgpu')
  expect(initial.output.width).toBe(1440)
  expect(initial.output.height).toBe(1000)
  // Headed Edge can expose 1.0000000447 on Windows scaling. Drawing dimensions
  // above remain exact; accept only numeric DPR rounding, not lower resolution.
  expect(initial.output.dpr).toBeCloseTo(1, 6)
  expect(initial.canvases).toBe(1)
  if (options.expectedBundle) expect(initial.bundle).toBe(options.expectedBundle)
  else if (options.asset === 'original') expect(initial.bundle).toBe(originalBundle)
  else {
    expect(initial.bundle, 'Candidate must not silently load the original bundle').not.toBe(
      originalBundle,
    )
    expect(initial.bundleVersion).toBeGreaterThanOrEqual(2)
  }
  report.loading = { phases: await page.evaluate(() => window.__carLoading.stop()), initial }
  stage = 'lighting-warmup'
  if (options.indirect === 'ddgi')
    await expect
      .poll(async () => (await state()).lighting?.indirectLighting?.actual, {
        timeout: 180000,
        intervals: [500],
      })
      .toBe('ddgi')
  report.loading.enhancedReadyObservedAtMs = await page.evaluate(() => performance.now())
  await page.waitForTimeout(options.warmupSeconds * 1000)
  report.warmed = await state()
  await session.send('Page.enable')
  const frameTree = await session.send('Page.getFrameTree')
  report.mainFrameId = frameTree.frameTree.frame.id
  if (options.trace) {
    try {
      await session.send('Tracing.start', {
        categories:
          'devtools.timeline,disabled-by-default-devtools.timeline.frame,benchmark,viz,cc,disabled-by-default-display.framedisplayed',
        transferMode: 'ReturnAsStream',
      })
      tracing = true
    } catch (cause) {
      report.traceFailure = String(cause)
    }
  } else {
    report.traceMetadata = {
      available: false,
      reason:
        'CDP tracing explicitly disabled for measurement-overhead isolation; no display certification.',
    }
  }
  await page.evaluate(installCompletedFrameTiming)
  for (let round = 1; round <= options.rounds; round++) {
    await reset()
    const roundData = { round, sequences: [], before: await state() }
    for (const kind of ['orbit', 'doors', 'separation']) {
      await page.bringToFront()
      await reset()
      const beforePageState = await page.evaluate(() => ({
        visibilityState: document.visibilityState,
        hasFocus: document.hasFocus(),
      }))
      const segment = `round-${round}-${kind}`
      stage = segment
      await page.evaluate((value) => {
        window.__carGpuTiming.segment(value)
        window.__carFrameTiming.segment(value)
      }, segment)
      roundData.sequences.push({
        segment,
        beforePageState,
        ...(await runSequence(kind, (options.seconds * 1000) / 3)),
        afterPageState: await page.evaluate(() => ({
          visibilityState: document.visibilityState,
          hasFocus: document.hasFocus(),
        })),
      })
      await page.evaluate(() => {
        window.__carGpuTiming.segment('between-sequences')
        window.__carFrameTiming.segment('between-sequences')
      })
    }
    roundData.after = await state()
    expect(roundData.after.canvases).toBe(1)
    expect(roundData.after.sameRenderer && roundData.after.sameCanvas).toBe(true)
    report.rounds.push(roundData)
    await writeFile(`${options.output}/partial-report.json`, JSON.stringify(report, null, 2))
    progress()
  }
  report.completedFrames = await page.evaluate(() => window.__carFrameTiming.stop())
  report.gpu = await page.evaluate(() => window.__carGpuTiming.stop())
  expect(report.completedFrames.restored).toBe(true)
  expect(report.gpu.restored).toBe(true)
  expect(report.gpu.errors).toEqual([])
  if (report.gpu.supported) expect(report.gpu.samples.length).toBeGreaterThan(0)
  report.gpu.passSummary = gpuSummary(report.gpu.samples)
  for (const round of report.rounds)
    for (const sequence of round.sequences) {
      const completions = report.completedFrames.completions.filter(
        (value) => value.segment === sequence.segment,
      )
      sequence.completedJsSubmissionIntervals = distribution(
        intervals(completions.map((value) => value.atMs)),
      )
      sequence.completedFrames = completions.length
      sequence.gpuPasses = gpuSummary(
        report.gpu.samples.filter((value) => value.segment === sequence.segment),
      )
      expect(sequence.completedFrames, `${sequence.segment} real completed frames`).toBeGreaterThan(
        1,
      )
    }
  const trace = await finishTrace()
  report.presentation = presentationEvidence(
    trace?.traceEvents ?? [],
    report.mainFrameId,
    options.seconds * options.rounds * 1000 * 0.95,
  )
  report.presentedBudgetValidated =
    report.formalDuration && report.presentation.presentedBudgetValidated
  expect(report.errors).toEqual([])
  expect(report.failedRequests).toEqual([])
  report.passed = true
  report.completedAt = new Date().toISOString()
  stage = 'complete'
  progress()
} catch (cause) {
  report.failure = String(cause)
  process.exitCode = 1
} finally {
  if (heartbeat) clearInterval(heartbeat)
  if (page && !page.isClosed()) {
    await page
      .evaluate(async () => {
        window.__carFrameTiming?.stop()
        await window.__carGpuTiming?.stop()
      })
      .catch(() => {})
  }
  if (tracing)
    await finishTrace().catch((cause) => {
      report.traceFailure = String(cause)
    })
  if (context) await context.close()
  if (browser) await browser.close()
  await writeFile(`${options.output}/report.json`, JSON.stringify(report, null, 2) + '\n')
}
console.log(
  JSON.stringify({
    passed: report.passed,
    presentedBudgetValidated: report.presentedBudgetValidated,
    output: options.output,
    failure: report.failure ?? null,
  }),
)

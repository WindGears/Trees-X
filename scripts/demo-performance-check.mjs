/* global URL, performance, MutationObserver, requestAnimationFrame, cancelAnimationFrame, setInterval, clearInterval */
import { chromium, expect } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { cpus, platform, release, totalmem } from 'node:os'
import {
  viewport,
  readProducts,
  productEvidence,
  positiveInteger,
  collectErrors,
  ready,
  compactSnapshot,
  sceneSnapshot,
  inputPoint,
  phaseLabels,
} from './demo/browser-check.mjs'

const base = process.env.CHECK_URL || 'http://127.0.0.1:5181'
const output = process.env.DEMO_PERFORMANCE_OUTPUT || 'artifacts/demo/performance'
const smoke = process.env.DEMO_SMOKE === '1'
const coldRuns = positiveInteger('DEMO_PERFORMANCE_COLD_RUNS', 5)
const interactionRounds = positiveInteger('DEMO_PERFORMANCE_ROUNDS', 3)
const interactionSeconds = positiveInteger('DEMO_PERFORMANCE_SECONDS', 30)
if (!smoke && (coldRuns < 5 || interactionRounds < 3 || interactionSeconds < 30))
  throw new Error(
    'Short checks require DEMO_SMOKE=1; formal measurement needs 5 cold loads and 3 × 30s per product',
  )
await mkdir(output, { recursive: true })
const report = {
  passed: false,
  formalMeasurement: false,
  fixture: false,
  smoke,
  origin: new URL(base).origin,
  viewport,
  browserChannel: 'msedge',
  headless: process.env.DEMO_HEADED !== '1',
  startedAt: new Date().toISOString(),
  host: {
    platform: platform(),
    osRelease: release(),
    cpu: cpus()[0]?.model ?? 'unavailable',
    logicalProcessors: cpus().length,
    physicalMemoryGiB: totalmem() / 1024 ** 3,
  },
  requirement: {
    coldRunsPerProduct: coldRuns,
    interactionRoundsPerProduct: interactionRounds,
    interactionSeconds,
  },
  coldDefinition:
    'Each cold sample uses a fresh browser context/page, Network.clearBrowserCache and Network.setCacheDisabled before navigation, with service-worker bypass. Includes real same-origin API, immutable manifest downloads, decoding, material preparation and first-frame readiness. Browser process, OS file cache, driver shader cache and GPU state are not reset or claimed cold.',
  loadingMethod:
    'A test-only MutationObserver timestamps the actual visitor DOM loading labels and ready data-status. Missing/coalesced DOM phases are reported as unobserved, not invented. readyElapsedMs is measured from navigation performance timeOrigin to the first matching DOM ready; actual Three root, nodes and manifest budget are independently checked after that signal.',
  frameMethod:
    'Within each measurement window only, wrap the existing renderer.render and timestamp successful returns for the actual workbench scene/camera; restore the original method afterwards. Completion intervals describe JS render-command submission returns, not GPU elapsed time or displayed frames. RAF callback intervals are separately reported as browser scheduling intervals, not GPU time. Playwright mouse drag drives actual OrbitControls; no page quality or source asset changes.',
  serialExecution: true,
  cold: [],
  interactions: [],
  errors: [],
  failedRequests: [],
  requestOrigins: new Set(),
}
let browser,
  context,
  currentSlug = null,
  stage = 'metadata',
  heartbeat
const progress = () =>
  console.log(
    JSON.stringify({
      event: 'demo-performance-progress',
      stage,
      slug: currentSlug,
      coldCompleted: report.cold.length,
      interactionCompleted: report.interactions.length,
      smoke,
    }),
  )

function distribution(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const percentile = (fraction) =>
    sorted.length
      ? sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))]
      : null
  return {
    samples: sorted.length,
    minMs: sorted[0] ?? null,
    medianMs: percentile(0.5),
    p95Ms: percentile(0.95),
    maxMs: sorted.at(-1) ?? null,
    meanMs: sorted.length ? sorted.reduce((sum, value) => sum + value, 0) / sorted.length : null,
  }
}
const intervals = (times) => times.slice(1).map((time, index) => time - times[index])

async function installPhaseObserver(page, slug) {
  await page.addInitScript(
    ({ slug, phaseLabels }) => {
      performance.setResourceTimingBufferSize(10000)
      const entries = [],
        labelToPhase = Object.fromEntries(
          Object.entries(phaseLabels).map(([key, label]) => [label, key]),
        )
      let previous = '',
        readyAt = null
      const capture = () => {
        const root = document.querySelector('.workbench')
        if (!root) return
        const label = document.querySelector('.wb-stage-status p')?.textContent?.trim() ?? '',
          status = root.dataset.status,
          product = root.dataset.slug,
          key = [product, status, label].join('|')
        if (key === previous) return
        previous = key
        const atMs = performance.now()
        entries.push({ slug: product, status, label, phase: labelToPhase[label] ?? null, atMs })
        if (product === slug && status === 'ready' && readyAt === null) readyAt = atMs
      }
      const observer = new MutationObserver(capture)
      observer.observe(document, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['data-status', 'data-slug'],
      })
      window.__demoLoading = {
        entries,
        stop() {
          capture()
          observer.disconnect()
          return { entries, readyAt, timeOrigin: performance.timeOrigin }
        },
      }
      capture()
    },
    { slug, phaseLabels },
  )
}

async function openActualProduct(metadata, cold) {
  // One context and one heavy product page at a time; closing releases the previous GLB before the next load.
  if (context) await context.close()
  context = await browser.newContext({ viewport, reducedMotion: 'no-preference' })
  const page = await context.newPage()
  collectErrors(page, report)
  page.setDefaultTimeout(30000)
  await installPhaseObserver(page, metadata.product.slug)
  if (cold) {
    const session = await context.newCDPSession(page)
    await session.send('Network.enable')
    await session.send('Network.clearBrowserCache')
    await session.send('Network.setCacheDisabled', { cacheDisabled: true })
    await session.send('Network.setBypassServiceWorker', { bypass: true })
    // Keep this CDP session attached: cache-disable remains active for this target until context close.
  }
  const startedAt = new Date().toISOString(),
    start = performance.now()
  await page.goto(base + '/?product=' + metadata.product.slug, {
    waitUntil: 'domcontentloaded',
    timeout: 90000,
  })
  const snapshot = await ready(page, metadata, { remember: true })
  const observed = await page.evaluate(() => {
    const values = window.__demoLoading.stop(),
      navigation = performance.getEntriesByType('navigation')[0]
    return {
      ...values,
      navigation: navigation
        ? {
            responseStartMs: navigation.responseStart,
            responseEndMs: navigation.responseEnd,
            domContentLoadedMs: navigation.domContentLoadedEventEnd,
            loadEventMs: navigation.loadEventEnd,
          }
        : null,
      resources: performance.getEntriesByType('resource').map((entry) => ({
        url: entry.name,
        transferSize: entry.transferSize,
        encodedBodySize: entry.encodedBodySize,
        decodedBodySize: entry.decodedBodySize,
        startMs: entry.startTime,
        durationMs: entry.duration,
      })),
    }
  })
  expect(observed.readyAt, 'Actual matching DOM ready timestamp').not.toBeNull()
  const phaseSequence = observed.entries.filter(
    (entry) => entry.slug === metadata.product.slug && entry.phase,
  )
  const phases = Object.fromEntries(
    Object.keys(phaseLabels).map((phase) => {
      const index = phaseSequence.findIndex((entry) => entry.phase === phase)
      return [
        phase,
        index < 0
          ? { observed: false, startMs: null, durationUntilNextVisiblePhaseMs: null }
          : {
              observed: true,
              startMs: phaseSequence[index].atMs,
              durationUntilNextVisiblePhaseMs:
                (phaseSequence[index + 1]?.atMs ?? observed.readyAt) - phaseSequence[index].atMs,
            },
      ]
    }),
  )
  return {
    page,
    evidence: {
      slug: metadata.product.slug,
      startedAt,
      finishedAt: new Date().toISOString(),
      readyElapsedMs: observed.readyAt,
      harnessElapsedMs: performance.now() - start,
      cacheDisabled: cold,
      cacheCleared: cold,
      freshContext: true,
      phases,
      domSequence: observed.entries,
      navigation: observed.navigation,
      network: {
        resources: observed.resources.length,
        transferredBytes: observed.resources.reduce((sum, entry) => sum + entry.transferSize, 0),
        modelRequested: observed.resources.some((entry) => entry.url === metadata.modelUrl),
        bundleRequestedFiles: metadata.manifest.files.filter((file) =>
          observed.resources.some(
            (entry) => entry.url === new URL(file.path, metadata.manifestUrl).href,
          ),
        ).length,
        // Manifest bytes remain authoritative; ResourceTiming transferSize also includes response headers.
        resourceTimingBuffered: observed.resources.length,
      },
      renderer: snapshot.renderer,
      scene: compactSnapshot(snapshot),
    },
  }
}

async function beginTiming(page) {
  await page.evaluate(() => {
    const context = window.__demo.scene,
      renderer = context.renderer.instance,
      original = renderer.render,
      completions = [],
      submissionDurations = [],
      raf = [],
      startMs = performance.now()
    const scene = context.scene.value,
      camera = context.camera.activeCamera.value
    renderer.render = function (...args) {
      const start = performance.now(),
        result = original.apply(this, args)
      if (args[0] === scene && args[1] === camera) {
        const end = performance.now()
        completions.push(end)
        submissionDurations.push(end - start)
      }
      return result
    }
    let rafId
    const frame = (time) => {
      raf.push(time)
      rafId = requestAnimationFrame(frame)
    }
    rafId = requestAnimationFrame(frame)
    window.__demoTiming = {
      stop() {
        const endMs = performance.now()
        renderer.render = original
        cancelAnimationFrame(rafId)
        const result = {
          startMs,
          endMs,
          completions,
          submissionDurations,
          raf,
          methodRestored: renderer.render === original,
          rendererMemory: {
            ...renderer.info.memory,
            programs: renderer.info.programs?.length ?? 0,
          },
          drawCallsLastFrame: renderer.info.render.calls,
          trianglesLastFrame: renderer.info.render.triangles,
        }
        delete window.__demoTiming
        return result
      },
    }
  })
}

try {
  const { products } = await readProducts(base)
  report.products = products.map(productEvidence)
  browser = await chromium.launch({ channel: 'msedge', headless: report.headless })
  report.browserVersion = browser.version()
  heartbeat = setInterval(progress, 60000)
  stage = 'cold-loads'
  for (const metadata of products) {
    currentSlug = metadata.product.slug
    for (let run = 1; run <= coldRuns; run++) {
      const { evidence } = await openActualProduct(metadata, true)
      expect(evidence.network.modelRequested, 'Real formal model resource timing').toBe(true)
      report.cold.push({ run, ...evidence })
      report.device ??= evidence.scene.device
      await writeFile(
        output + '/partial-report.json',
        JSON.stringify({ ...report, requestOrigins: [...report.requestOrigins] }, null, 2) + '\n',
      )
      console.log(
        JSON.stringify({
          event: 'demo-performance-cold',
          slug: currentSlug,
          run,
          readyElapsedMs: evidence.readyElapsedMs,
          phases: evidence.phases,
          renderer: evidence.renderer,
          smoke,
        }),
      )
      await context.close()
      context = null
    }
  }
  stage = 'mouse-interaction'
  for (const metadata of products) {
    currentSlug = metadata.product.slug
    const { page, evidence } = await openActualProduct(metadata, false)
    await expect(page.locator('canvas')).toHaveCount(1)
    for (let round = 1; round <= interactionRounds; round++) {
      await page.getByRole('group', { name: '商品展示区', exact: true }).focus()
      await page.keyboard.press('Home')
      await page.waitForTimeout(850)
      const point = await inputPoint(page),
        startedAt = new Date().toISOString(),
        inputTimes = []
      await beginTiming(page)
      const start = performance.now()
      await page.mouse.move(point.x, point.y)
      await page.mouse.down()
      let moves = 0,
        measured
      try {
        while (performance.now() - start < interactionSeconds * 1000) {
          const seconds = (performance.now() - start) / 1000,
            x = point.x + 80 * Math.sin(seconds * 0.7),
            y = point.y + 40 * Math.cos(seconds * 0.55)
          await page.mouse.move(x, y)
          inputTimes.push(performance.now() - start)
          moves++
          // A short cadence between actual pointer moves is interaction pacing, not a timer-only test.
          await page.waitForTimeout(16)
        }
      } finally {
        await page.mouse.up()
        measured = await page.evaluate(() => window.__demoTiming.stop())
      }
      const snapshot = await sceneSnapshot(page, metadata),
        entry = {
          slug: currentSlug,
          round,
          startedAt,
          completedAt: new Date().toISOString(),
          interactionDurationMs: performance.now() - start,
          browserMeasurementDurationMs: measured.endMs - measured.startMs,
          moves,
          inputTimesMs: inputTimes,
          maxGapBetweenMouseMovesMs: Math.max(0, ...intervals(inputTimes)),
          renderCompletionIntervals: distribution(intervals(measured.completions)),
          renderSubmissionCpuDurations: distribution(measured.submissionDurations),
          rafCallbackIntervals: distribution(intervals(measured.raf)),
          renderCompletionTimesMs: measured.completions.map((time) => time - measured.startMs),
          rafTimesMs: measured.raf.map((time) => time - measured.startMs),
          rendererMemory: measured.rendererMemory,
          drawCallsLastFrame: measured.drawCallsLastFrame,
          trianglesLastFrame: measured.trianglesLastFrame,
          originalRenderMethodRestored: measured.methodRestored,
          sameCanvas: snapshot.sameCanvas,
          sameRenderer: snapshot.sameRenderer,
          quality: snapshot.renderer,
          device: snapshot.device,
        }
      expect(entry.browserMeasurementDurationMs).toBeGreaterThanOrEqual(interactionSeconds * 1000)
      expect(entry.moves).toBeGreaterThan(10)
      expect(entry.renderCompletionIntervals.samples).toBeGreaterThan(10)
      expect(entry.rafCallbackIntervals.samples).toBeGreaterThan(10)
      expect(entry.originalRenderMethodRestored && entry.sameCanvas && entry.sameRenderer).toBe(
        true,
      )
      expect(snapshot.identityDigest).toBe(evidence.scene.identityDigest)
      expect(snapshot.poseDigest).toBe(evidence.scene.poseDigest)
      report.interactions.push(entry)
      await writeFile(
        `${output}/${currentSlug}-round-${round}.json`,
        JSON.stringify(entry, null, 2) + '\n',
      )
      console.log(
        JSON.stringify({
          event: 'demo-performance-interaction',
          slug: currentSlug,
          round,
          durationMs: entry.browserMeasurementDurationMs,
          moves,
          renderCompletionIntervals: entry.renderCompletionIntervals,
          rafCallbackIntervals: entry.rafCallbackIntervals,
          rendererMemory: entry.rendererMemory,
          smoke,
        }),
      )
    }
    await context.close()
    context = null
  }
  report.summary = Object.fromEntries(
    products.map(({ product }) => {
      const cold = report.cold.filter((entry) => entry.slug === product.slug),
        rounds = report.interactions.filter((entry) => entry.slug === product.slug)
      return [
        product.slug,
        {
          coldReadyElapsed: distribution(cold.map((entry) => entry.readyElapsedMs)),
          coldRuns: cold.length,
          interactionRounds: rounds.length,
          renderCompletionIntervalsAcrossRounds: distribution(
            rounds.flatMap((entry) => intervals(entry.renderCompletionTimesMs)),
          ),
          rafCallbackIntervalsAcrossRounds: distribution(
            rounds.flatMap((entry) => intervals(entry.rafTimesMs)),
          ),
        },
      ]
    }),
  )
  expect(report.errors).toEqual([])
  expect(report.failedRequests).toEqual([])
  expect([...report.requestOrigins]).toEqual([new URL(base).origin])
  report.passed = true
  report.formalMeasurement = !smoke
  report.completedAt = new Date().toISOString()
  stage = 'complete'
  progress()
} catch (error) {
  report.failure = String(error)
  throw error
} finally {
  if (heartbeat) clearInterval(heartbeat)
  if (context) await context.close()
  if (browser) await browser.close()
  report.requestOrigins = [...report.requestOrigins]
  await writeFile(output + '/report.json', JSON.stringify(report, null, 2) + '\n')
}
console.log(
  JSON.stringify({
    passed: report.passed,
    formalMeasurement: report.formalMeasurement,
    smoke,
    coldLoads: report.cold.length,
    rounds: report.interactions.length,
    output,
  }),
)

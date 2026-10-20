/* global URL, performance, MutationObserver, setInterval, clearInterval */
import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  boundedAuditAttempt as boundedAttempt,
  withAuditDeadline,
} from './reventon-performance/audit-deadline.mjs'
import { bridge, phaseLabels } from './demo/browser-check.mjs'
import { candidateIdentity, originalIdentity } from './reventon-clean-stress/model.mjs'
import { cacheEvidence, cacheHeaders } from './reventon-clean-load/cache-evidence.mjs'
import { localAuditOrigin } from './reventon-performance/audit-origin.mjs'
import {
  collectModelTextureDescriptors,
  summarizeModelTextureMemory,
} from './reventon-performance/texture-memory.mjs'

// Read-only navigation audit. No route fixtures, renderer wrappers, GPU queries,
// traces, pixel readbacks, setting changes, writes to API or artificial quality reduction.
const availableModes = {
  'original-webgl': { asset: 'original', pipeline: 'webgl', loading: 'legacy' },
  'original-realtime-ssgi': {
    asset: 'original',
    pipeline: 'realtime',
    loading: 'streaming',
    indirect: 'ssgi',
  },
  'runtime-v2-ssgi': {
    asset: 'runtime-v2',
    pipeline: 'realtime',
    loading: 'streaming',
    indirect: 'ssgi',
  },
  'runtime-v2-ddgi': {
    asset: 'runtime-v2',
    pipeline: 'realtime',
    loading: 'streaming',
    indirect: 'ddgi',
  },
}
const integer = (name, fallback, maximum) => {
  const value = Number(process.env[name] ?? fallback)
  assert.ok(Number.isInteger(value) && value >= 1 && value <= maximum, `${name}: 1–${maximum}`)
  return value
}
const base = new URL(localAuditOrigin(process.env.CHECK_URL || 'http://127.0.0.1:5181'))
const options = {
  base: base.origin,
  modes: (process.env.REVENTON_LOAD_MODES || Object.keys(availableModes).join(','))
    .split(',')
    .map((mode) => mode.trim()),
  pairs: integer('REVENTON_LOAD_PAIRS', 5, 20),
  timeoutMs: integer('REVENTON_LOAD_TIMEOUT_MS', 300000, 900000),
  channel: process.env.REVENTON_BROWSER_CHANNEL || 'msedge',
  headless: process.env.REVENTON_LOAD_HEADLESS === '1',
  screenshots: process.env.REVENTON_LOAD_SCREENSHOTS === '1',
  output: resolve(process.env.REVENTON_LOAD_OUTPUT || 'artifacts/car-clean-20261020/loads'),
}
assert.ok(options.modes.length && new Set(options.modes).size === options.modes.length)
for (const mode of options.modes) assert.ok(availableModes[mode], `Unknown mode ${mode}`)
const viewport = { width: 1440, height: 1000 }
const report = {
  schemaVersion: 1,
  passed: false,
  passedMeaning: 'Read-only real-browser loading procedure and identity checks completed.',
  loadingTargetValidated: false,
  presentedFrameBudgetValidated: false,
  fixture: false,
  startedAt: new Date().toISOString(),
  options,
  viewport,
  modes: [],
  errors: [],
  cacheMethod: {
    profile:
      'A new, independent persistent Edge user-data directory per mode inside this ignored output directory; never the user browser profile.',
    capacity:
      'Browser default disk-cache capacity and eviction policy; no capacity or network-quality override.',
    cold: 'CDP Network.clearBrowserCache immediately before each cold navigation.',
    hot: 'Exact same URL and page, normal reload after its paired cold run with HTTP cache enabled.',
    headers:
      'Only cache-control, etag and content-length are retained. Network response status is separately observed through responseReceivedExtraInfo, including real 304s.',
  },
  limitations: [
    'Cold means CDP Network.clearBrowserCache before navigation, not cold OS file cache, driver shader cache, server cache or a reboot.',
    'Hot means a normal reload of the same URL in the same persistent-profile context immediately after its paired cold load, with HTTP cache enabled; actual cache reuse is separately observed rather than assumed.',
    'Browser resource timings, HTTP sizes and DOM/lighting observations include measurement overhead; timings are not isolated parser, GPU or display times.',
    'firstRasterMs is the existing coordinator elapsed value, not a navigation-relative timestamp, GPU completion or display presentation.',
    'original-webgl is the ordinary visitor entry; realtime modes explicitly use streaming, so this group difference is not pure renderer cost.',
    'No background applications, operating-system power options or browser shader cache are modified.',
  ],
}
let browser,
  context,
  page,
  cdp,
  heartbeat,
  active,
  stage = 'startup'
const persist = () =>
  writeFile(`${options.output}/report.json`, JSON.stringify(report, null, 2) + '\n')
const progress = () =>
  console.log(
    JSON.stringify({
      event: 'reventon-clean-load-progress',
      stage,
      mode: active?.mode,
      pair: active?.pair,
      cache: active?.cache,
      completed: report.modes.reduce((n, mode) => n + mode.runs.length, 0),
    }),
  )

// A hung renderer process can also hang evaluate/close. A deadline reports the
// unfinished operation honestly; it does not imply that the browser was killed.
function evaluate(pageFunction, arg) {
  return withAuditDeadline(
    'Browser evaluation',
    () => page.evaluate(pageFunction, arg),
    Math.min(options.timeoutMs, 30000),
  )
}
function sendCdp(session, method, params) {
  return withAuditDeadline(
    'CDP ' + method,
    () => session.send(method, params),
    Math.min(options.timeoutMs, 30000),
  )
}

async function closeOwnedContext() {
  const startedAt = new Date().toISOString()
  if (!context && !browser)
    return { status: 'not-needed', confirmed: true, requiresReview: false, startedAt }
  const result = await boundedAttempt('Test-owned browser close', () =>
    context ? context.close() : browser.close(),
  )
  return {
    ...result,
    confirmed: result.status === 'completed',
    requiresReview: result.status !== 'completed',
    startedAt,
    completedAt: new Date().toISOString(),
    ownership: 'Only this script-created persistent context; no user profile or process kill.',
  }
}

function installObserver(labels) {
  performance.setResourceTimingBufferSize(2048)
  const entries = [],
    names = new Map(Object.entries(labels).map(([key, value]) => [value, key]))
  let previous = ''
  const observe = () => {
    const root = document.querySelector('.workbench')
    if (!root) return
    const label = document.querySelector('.wb-stage-status p')?.textContent?.trim() ?? ''
    const state = {
      slug: root.dataset.slug,
      status: root.dataset.status,
      phase: names.get(label) ?? null,
      label,
      lightingPhase: document.querySelector('.wb-stage')?.dataset.lightingPhase ?? null,
    }
    const key = JSON.stringify(state)
    if (key !== previous) {
      previous = key
      entries.push({ atMs: performance.now(), ...state })
    }
  }
  const observer = new MutationObserver(observe)
  observer.observe(document, {
    subtree: true,
    attributes: true,
    childList: true,
    characterData: true,
  })
  window.__carCleanLoad = {
    entries,
    stop: () => {
      observe()
      observer.disconnect()
      return entries
    },
  }
}

function lightingSnapshot() {
  const seen = new Set()
  const find = (vnode) => {
    if (!vnode || typeof vnode !== 'object' || seen.has(vnode)) return null
    seen.add(vnode)
    const component = vnode.component
    if (component) {
      for (const exposed of [component.exposed, component.refs?.sceneHost]) {
        const host = exposed?.value ?? exposed
        const lighting = host?.realLighting?.value ?? host?.realLighting
        if (typeof lighting?.snapshot === 'function') return lighting.snapshot()
      }
      const child = find(component.subTree)
      if (child) return child
    }
    if (Array.isArray(vnode.children))
      for (const child of vnode.children) {
        const found = find(child)
        if (found) return found
      }
    return find(vnode.suspense?.activeBranch)
  }
  return { atMs: performance.now(), lighting: find(document.querySelector('#app')?._vnode) }
}

function collectState() {
  const { scene: context, store } = window.__demo
  const renderer = context.renderer.instance,
    canvas = renderer.domElement
  const roots = context.scene.value.children.filter((node) => node.userData.workbenchProduct)
  const root = roots[0],
    textures = new Set()
  let meshes = 0,
    triangles = 0
  root?.traverse((node) => {
    if (!node.isMesh) return
    meshes++
    triangles += (node.geometry.index?.count ?? node.geometry.attributes.position?.count ?? 0) / 3
    for (const material of Array.isArray(node.material) ? node.material : [node.material])
      for (const value of Object.values(material ?? {})) if (value?.isTexture) textures.add(value)
  })
  const textureFormats = new Map()
  for (const texture of textures) {
    const image = texture.image ?? texture.source?.data
    const native = renderer.backend?.get(texture)?.texture
    const entry = {
      format: native?.format ?? texture.format,
      formatMeaning: native
        ? 'Initialized native GPUTexture format'
        : 'Source Three texture format enum; not native WebGL storage',
      colorSpace: texture.colorSpace,
      compressed: Boolean(texture.isCompressedTexture),
      width: native?.width ?? image?.width,
      height: native?.height ?? image?.height,
      mipLevels: native?.mipLevelCount ?? texture.mipmaps?.length ?? null,
    }
    const key = JSON.stringify(entry),
      old = textureFormats.get(key)
    textureFormats.set(key, { ...entry, count: (old?.count ?? 0) + 1 })
  }
  return {
    product: root?.userData.workbenchProduct,
    rootCount: roots.length,
    adapter: root?.userData.adapter,
    bundle: root?.userData.assetBundle,
    bundleVersion: root?.userData.bundleVersion,
    bundleSha256: root?.userData.bundleSha256,
    meshes,
    triangles,
    finish: store.finishId,
    textureWrappers: textures.size,
    textureFormats: [...textureFormats.values()],
    backend: renderer.backend?.isWebGPUBackend ? 'webgpu' : 'webgl',
    canvases: document.querySelectorAll('canvas').length,
    output: {
      width: canvas.width,
      height: canvas.height,
      dpr: window.devicePixelRatio,
      pixelRatio: renderer.getPixelRatio(),
    },
    page: { visibilityState: document.visibilityState, hasFocus: document.hasFocus() },
    memory: { ...renderer.info.memory },
  }
}

function safeUrl(value) {
  const address = new URL(value)
  address.username = ''
  address.password = ''
  return address.href
}

async function load(mode, pair, cache, target) {
  const run = {
    mode,
    pair,
    cache,
    url: target.href,
    passed: false,
    startedAt: new Date().toISOString(),
    network: [],
    networkExtraResponses: [],
    errors: [],
    failedRequests: [],
    writes: [],
  }
  active = run
  const requests = new Map(),
    current = () => active === run
  const requested = (event) => {
    if (!current()) return
    const entry = {
      requestId: event.requestId,
      url: safeUrl(event.request.url),
      method: event.request.method,
      resourceType: event.type,
      startedAtSeconds: event.timestamp,
      initiator: event.initiator.type,
    }
    requests.set(event.requestId, entry)
    run.network.push(entry)
    if (!['GET', 'HEAD', 'OPTIONS'].includes(entry.method)) run.writes.push(entry)
  }
  const response = (event) => {
    const entry = requests.get(event.requestId)
    if (!entry) return
    Object.assign(entry, {
      status: event.response.status,
      responseAtSeconds: event.timestamp,
      protocol: event.response.protocol,
      mimeType: event.response.mimeType,
      fromDiskCache: Boolean(event.response.fromDiskCache),
      fromServiceWorker: Boolean(event.response.fromServiceWorker),
      timing: event.response.timing ?? null,
      cacheHeaders: cacheHeaders(event.response.headers),
    })
  }
  const responseExtra = (event) => {
    if (!current()) return
    // CDP may deliver ExtraInfo before responseReceived. Keep its own row and
    // request ID; never overwrite the browser's cache-normalized status or copy
    // raw headers/cookies. Request IDs also survive a redirect chain.
    run.networkExtraResponses.push({
      requestId: event.requestId,
      statusCode: event.statusCode,
      cacheHeaders: cacheHeaders(event.headers),
    })
  }
  const complete = (event) => {
    const entry = requests.get(event.requestId)
    if (entry)
      Object.assign(entry, {
        finishedAtSeconds: event.timestamp,
        encodedDataLength: event.encodedDataLength,
      })
  }
  const cached = (event) => {
    const entry = requests.get(event.requestId)
    if (entry) entry.servedFromCache = true
  }
  const failed = (event) => {
    const entry = requests.get(event.requestId)
    if (entry) {
      entry.failure = event.errorText
      run.failedRequests.push({ url: entry.url, reason: event.errorText })
    }
  }
  const pageError = (error) => run.errors.push({ type: 'pageerror', message: error.message })
  const consoleError = (message) => {
    if (message.type() === 'error') run.errors.push({ type: 'console', message: message.text() })
  }
  for (const [name, handler] of [
    ['Network.requestWillBeSent', requested],
    ['Network.responseReceived', response],
    ['Network.responseReceivedExtraInfo', responseExtra],
    ['Network.loadingFinished', complete],
    ['Network.requestServedFromCache', cached],
    ['Network.loadingFailed', failed],
  ])
    cdp.on(name, handler)
  page.on('pageerror', pageError)
  page.on('console', consoleError)
  try {
    stage = `${cache}-navigation`
    if (cache === 'cold') await sendCdp(cdp, 'Network.clearBrowserCache')
    if (cache === 'hot') assert.equal(page.url(), target.href, 'Hot load must reuse exact URL')
    if (cache === 'hot')
      await page.reload({ waitUntil: 'domcontentloaded', timeout: options.timeoutMs })
    else await page.goto(target.href, { waitUntil: 'domcontentloaded', timeout: options.timeoutMs })
    await page.bringToFront()
    stage = `${cache}-first-frame`
    await page.waitForFunction(
      () =>
        ['ready', 'error', 'content'].includes(
          document.querySelector('.workbench')?.dataset.status,
        ),
      null,
      { timeout: options.timeoutMs, polling: 250 },
    )
    run.interactiveObservedAtMs = await evaluate(() => performance.now())
    const status = await page.locator('.workbench').getAttribute('data-status')
    if (status !== 'ready')
      throw new Error(
        `Real car ${status}: ${await page
          .locator('.wb-stage-status')
          .textContent({ timeout: 1000 })
          .catch(() => '')}`,
      )
    await withAuditDeadline('Scene bridge', () => bridge(page, true), 30000)
    run.initialLighting = await evaluate(lightingSnapshot)
    run.initial = await evaluate(collectState)
    assert.equal(run.initial.product, 'reventon')
    assert.equal(run.initial.adapter, 'reventon-v1')
    assert.equal(run.initial.rootCount, 1)
    assert.equal(run.initial.canvases, 1)
    assert.equal(run.initial.output.width, 1440)
    assert.equal(run.initial.output.height, 1000)
    assert.ok(Math.abs(run.initial.output.dpr - 1) < 1e-6, 'DPR must be 1')
    assert.ok(Math.abs(run.initial.output.pixelRatio - 1) < 1e-6, 'Renderer DPR must be 1')
    const settings = availableModes[mode]
    assert.equal(run.initial.backend, settings.pipeline === 'webgl' ? 'webgl' : 'webgpu')
    assert.equal(run.initial.bundleVersion, settings.asset === 'original' ? 1 : 2)
    assert.equal(run.initial.bundle, `reventon-workbench@${settings.asset === 'original' ? 1 : 2}`)
    assert.equal(
      run.initial.bundleSha256,
      (settings.asset === 'original' ? originalIdentity : candidateIdentity).sha256,
      'Loading comparison must use the audited immutable bundle, not another same-version resource',
    )
    assert.equal(run.initial.meshes, 135)
    assert.equal(run.initial.triangles, 1500363)
    if (settings.pipeline === 'realtime') {
      stage = `${cache}-enhancement`
      const started = Date.now()
      while (true) {
        const snapshot = await evaluate(lightingSnapshot)
        run.lastLighting = snapshot
        assert.notEqual(
          snapshot.lighting?.phase,
          'error',
          snapshot.lighting?.error ?? 'Lighting failed',
        )
        if (
          snapshot.lighting?.phase === 'ready' &&
          snapshot.lighting.indirectLighting?.actual === settings.indirect &&
          !snapshot.lighting.indirectLighting?.preparing
        ) {
          run.enhancedReadyObservedAtMs = snapshot.atMs
          break
        }
        assert.ok(
          Date.now() - started < options.timeoutMs,
          'Requested enhancement readiness timed out',
        )
        await page.waitForTimeout(250)
      }
      run.modelTextureMemory = summarizeModelTextureMemory(
        await evaluate(collectModelTextureDescriptors),
      )
    } else {
      run.enhancedReadyObservedAtMs = null
      run.enhancementMeaning =
        'No realtime coordinator requested; normal WebGL ready is measured separately.'
    }
    run.phases = await evaluate(() => window.__carCleanLoad.stop())
    run.interactiveMutationAtMs = run.phases.find((entry) => entry.status === 'ready')?.atMs ?? null
    run.navigation = await evaluate(() => {
      const navigation = performance.getEntriesByType('navigation')[0]
      return navigation?.toJSON() ?? null
    })
    run.resources = await evaluate(() =>
      performance.getEntriesByType('resource').map((entry) => ({
        url: entry.name,
        initiatorType: entry.initiatorType,
        startTime: entry.startTime,
        duration: entry.duration,
        fetchStart: entry.fetchStart,
        requestStart: entry.requestStart,
        responseStart: entry.responseStart,
        responseEnd: entry.responseEnd,
        transferSize: entry.transferSize,
        encodedBodySize: entry.encodedBodySize,
        decodedBodySize: entry.decodedBodySize,
        deliveryType: entry.deliveryType,
      })),
    )
    run.sameOrigin = run.network.every(
      (entry) => !/^https?:/.test(entry.url) || new URL(entry.url).origin === base.origin,
    )
    assert.ok(run.sameOrigin, 'Runtime HTTP requests must be same-origin')
    assert.equal(run.writes.length, 0, 'Read-only measurement must issue no write requests')
    assert.equal(run.failedRequests.length, 0, 'No failed requests')
    assert.equal(run.network.filter((entry) => entry.status >= 400).length, 0, 'No HTTP errors')
    assert.equal(run.errors.length, 0, 'No browser errors')
    if (options.screenshots && pair === 1) {
      run.screenshot = `${mode}-${cache}.png`
      await page.screenshot({ path: `${options.output}/${run.screenshot}` })
    }
    run.passed = true
  } catch (error) {
    run.failure = error.stack ?? String(error)
    // Both reads share one total five-second budget. Do not mutate the report
    // from pending callbacks after that budget has expired.
    const evidence = await boundedAttempt('Failure evidence', () =>
      Promise.allSettled([
        evaluate(() => window.__carCleanLoad?.stop()),
        evaluate(lightingSnapshot),
      ]),
    )
    run.failureEvidence = { status: evidence.status, error: evidence.error ?? null }
    if (evidence.status === 'completed') {
      const [phases, lighting] = evidence.value
      if (phases.status === 'fulfilled') run.phases ??= phases.value
      else run.failureEvidence.phasesError = String(phases.reason)
      if (lighting.status === 'fulfilled') run.lastLighting ??= lighting.value
      else run.failureEvidence.lightingError = String(lighting.reason)
    }
    report.errors.push({ mode, pair, cache, failure: run.failure })
  } finally {
    run.completedAt = new Date().toISOString()
    run.cacheEvidence = cacheEvidence(run.network, run.networkExtraResponses)
    for (const [name, handler] of [
      ['Network.requestWillBeSent', requested],
      ['Network.responseReceived', response],
      ['Network.responseReceivedExtraInfo', responseExtra],
      ['Network.loadingFinished', complete],
      ['Network.requestServedFromCache', cached],
      ['Network.loadingFailed', failed],
    ])
      cdp.off(name, handler)
    page.off('pageerror', pageError)
    page.off('console', consoleError)
    active = null
  }
  return run
}

try {
  await mkdir(options.output, { recursive: true })
  heartbeat = setInterval(progress, 15000)
  for (const mode of options.modes) {
    const settings = availableModes[mode],
      target = new URL('/', base)
    target.searchParams.set('product', 'reventon')
    if (settings.pipeline === 'realtime') {
      target.searchParams.set('renderPipeline', 'realtime')
      target.searchParams.set('indirectLighting', settings.indirect)
      target.searchParams.set('assetLoading', settings.loading)
    }
    if (settings.asset === 'runtime-v2') target.searchParams.set('reventonAsset', 'runtime-v2')
    const profileDirectory = await mkdtemp(resolve(options.output, `profile-${mode}-`))
    const modeReport = { mode, settings, url: target.href, profileDirectory, runs: [] }
    report.modes.push(modeReport)
    context = await chromium.launchPersistentContext(profileDirectory, {
      channel: options.channel,
      headless: options.headless,
      viewport,
      deviceScaleFactor: 1,
      reducedMotion: 'no-preference',
    })
    browser = context.browser()
    modeReport.browserVersion = browser?.version() ?? null
    report.browserVersion ??= modeReport.browserVersion
    page = context.pages()[0] ?? (await context.newPage())
    await page.addInitScript(installObserver, phaseLabels)
    cdp = await withAuditDeadline(
      'Create test CDP session',
      () => context.newCDPSession(page),
      30000,
    )
    await sendCdp(cdp, 'Network.enable')
    await sendCdp(cdp, 'Network.setCacheDisabled', { cacheDisabled: false })
    await sendCdp(cdp, 'Network.setBypassServiceWorker', { bypass: true })
    for (let pair = 1; pair <= options.pairs; pair++) {
      for (const cache of ['cold', 'hot']) {
        const run = await load(mode, pair, cache, target)
        modeReport.runs.push(run)
        await persist()
        progress()
        if (!run.passed)
          throw new Error(
            `Preserved failed ${mode}/${pair}/${cache}; stopping to avoid contaminated subsequent measurements`,
          )
      }
    }
    modeReport.checksCompletedAt = new Date().toISOString()
    modeReport.cleanup = { status: 'pending', confirmed: false, requiresReview: true }
    await persist()
    // Context close owns its CDP sessions too; a separate unbounded detach is
    // unnecessary. Save all runs before asking a possibly unresponsive browser.
    modeReport.cleanup = await closeOwnedContext()
    await persist()
    assert.ok(modeReport.cleanup.confirmed, 'Browser cleanup unconfirmed; stop further modes')
    context = null
    browser = null
    page = null
    cdp = null
  }
  report.passed = report.modes.every(
    (mode) => mode.runs.length === options.pairs * 2 && mode.runs.every((run) => run.passed),
  )
} catch (error) {
  report.failure = error.stack ?? String(error)
  process.exitCode = 1
} finally {
  stage = 'cleanup'
  if (heartbeat) clearInterval(heartbeat)
  report.completedAt = new Date().toISOString()
  report.cleanup = { status: 'pending', confirmed: false, requiresReview: true }
  await mkdir(options.output, { recursive: true })
  await persist()
  report.cleanup = await closeOwnedContext()
  if (!report.cleanup.confirmed) {
    report.passed = false
    process.exitCode = 1
  }
  await persist()
  console.log(
    JSON.stringify({
      event: 'reventon-clean-load-complete',
      passed: report.passed,
      output: options.output,
      failure: report.failure ?? null,
      cleanup: report.cleanup,
    }),
  )
  // Pending Playwright IPC must not trap the audit runner forever. This exits
  // only this test process; cleanup remains explicitly unconfirmed in evidence.
  if (!report.cleanup.confirmed) process.exit(1)
}

/* global fetch, URL, AbortSignal, performance */
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { chromium, expect } from '@playwright/test'
import { bridge } from './demo/browser-check.mjs'
import { localAuditOrigin } from './reventon-performance/audit-origin.mjs'
import { boundedAuditAttempt, withAuditDeadline } from './reventon-performance/audit-deadline.mjs'
import { installPipelineObservation } from './reventon-performance/pipeline-observation.mjs'
import { candidateIdentity } from './reventon-clean-stress/model.mjs'

// Run baseline and candidate sequentially, with the same checkout/browser settings.
// This audit requests no timestamp queries, readbacks, synthetic draws or RAF loop.
const variant = process.env.REVENTON_PIPELINE_VARIANT ?? 'candidate',
  base = localAuditOrigin(process.env.CHECK_URL ?? 'http://127.0.0.1:5181'),
  output = resolve(process.env.REVENTON_PIPELINE_OUTPUT ?? `artifacts/car-pipeline/${variant}`),
  timeout = Number(process.env.REVENTON_PIPELINE_TIMEOUT_MS ?? 300000),
  reloads = Number(process.env.REVENTON_PIPELINE_RELOADS ?? 4),
  viewport = { width: 1440, height: 1000 },
  url = new URL('/', base)
assert.ok(['baseline', 'candidate'].includes(variant), 'Unknown pipeline variant')
assert.ok(Number.isSafeInteger(timeout) && timeout >= 1000 && timeout <= 600000)
assert.ok(Number.isSafeInteger(reloads) && reloads >= 0 && reloads <= 4)
assert.ok(output.startsWith(resolve('artifacts') + sep), 'Output must stay under artifacts/')
for (const [key, value] of Object.entries({
  product: 'reventon',
  renderPipeline: 'realtime',
  indirectLighting: 'ddgi',
  assetLoading: 'streaming',
  reventonAsset: 'runtime-v2',
  carPrewarm: variant === 'baseline' ? 'off' : 'on',
  carShadowKernel: variant === 'baseline' ? 'legacy' : 'paired',
}))
  url.searchParams.set(key, value)
const report = {
  schemaVersion: 1,
  passed: false,
  meaning:
    'The fixed procedure completed and native creation requests were observed. This is not driver-cache-hit, display-FPS, GPU elapsed time, visual-equivalence or performance-benefit acceptance.',
  presentedBudgetValidated: false,
  variant,
  url: url.href,
  viewport,
  startedAt: new Date().toISOString(),
  headless: process.env.REVENTON_HEADLESS === '1',
  checkpoints: [],
  errors: [],
  failedRequests: [],
  limitations: [
    'Native interception adds CPU overhead; compare repeated paired runs.',
    'Fresh browser HTTP cache does not reset driver shader cache or OS cache.',
    'Async pipeline spans end at native promise settlement; they are not GPU execution time.',
    'Identity values are page-local; descriptor identities cannot be compared numerically across processes.',
    'Existing defaults/query support must be verified from the exact checkout; query strings alone do not prove a feature was enabled.',
  ],
}
let browser,
  page,
  stage = 'preflight'
const evaluate = (action, arg) =>
    withAuditDeadline('Pipeline audit evaluation', () => page.evaluate(action, arg), 30000),
  persist = () =>
    writeFile(
      resolve(output, 'partial-report.json'),
      JSON.stringify({ ...report, stage }, null, 2) + '\n',
    ),
  mark = async (name) => {
    stage = name
    await evaluate((name) => window.__carPipelineAudit.mark(name), name)
    await persist()
  }
await mkdir(output, { recursive: true })

async function attach(remember = false) {
  await withAuditDeadline('Pipeline scene bridge', () => bridge(page, remember), 30000)
  await evaluate(() => {
    const seen = new Set(),
      find = (vnode) => {
        if (!vnode || typeof vnode !== 'object' || seen.has(vnode)) return
        seen.add(vnode)
        const component = vnode.component,
          exposed = component?.exposed?.realLighting,
          value = exposed?.value ?? exposed
        if (value?.snapshot && value?.setSignals) return value
        const found = find(component?.subTree)
        if (found) return found
        for (const child of Array.isArray(vnode.children) ? vnode.children : []) {
          const found = find(child)
          if (found) return found
        }
        return find(vnode.suspense?.activeBranch)
      }
    window.__carLighting = find(document.querySelector('#app')?._vnode)
    if (!window.__carLighting) throw new Error('Actual realtime coordinator not found')
  })
}
async function state() {
  return evaluate(() => {
    const test = window.__demo,
      context = test.scene,
      renderer = context.renderer.instance,
      roots = context.scene.value.children.filter((node) => node.userData.workbenchProduct),
      root = roots[0],
      camera = context.camera.activeCamera.value
    return {
      atMs: performance.now(),
      uuid: root?.uuid,
      product: root?.userData.workbenchProduct,
      products: roots.length,
      bundleVersion: root?.userData.bundleVersion,
      sha256: root?.userData.bundleSha256,
      generation: test.store.revision,
      lighting: window.__carLighting.snapshot(),
      motion: { ...test.motion.states.value },
      output: { width: renderer.domElement.width, height: renderer.domElement.height },
      camera: [...camera.position.toArray(), ...camera.quaternion.toArray()],
      canvases: document.querySelectorAll('canvas').length,
      sameCanvas: renderer.domElement === test.canvas,
      sameRenderer: renderer === test.renderer,
      backend: renderer.backend?.isWebGPUBackend ? 'webgpu' : 'other',
      adapterInfo: renderer.backend?.device?.adapterInfo
        ? {
            vendor: renderer.backend.device.adapterInfo.vendor,
            device: renderer.backend.device.adapterInfo.device,
            description: renderer.backend.device.adapterInfo.description,
            architecture: renderer.backend.device.adapterInfo.architecture,
          }
        : null,
      shadow: context.scene.value.getObjectByName('Reventon / live contact shadow')?.userData,
      native: window.__carPipelineAudit.snapshot({ records: false }),
    }
  })
}
async function frames(count = 12) {
  const initial = (await state()).lighting.frames
  await expect
    .poll(async () => (await state()).lighting.frames, { timeout, intervals: [100, 250] })
    .toBeGreaterThanOrEqual(initial + count)
}
async function ready(remember, previousUuid) {
  await page.waitForFunction(
    () =>
      ['ready', 'error', 'content'].includes(document.querySelector('.workbench')?.dataset.status),
    null,
    { timeout, polling: 250 },
  )
  assert.equal(await page.locator('.workbench').getAttribute('data-status'), 'ready')
  await attach(remember)
  if (previousUuid) assert.notEqual((await state()).uuid, previousUuid)
  const deadline = Date.now() + timeout
  while (true) {
    const lighting = (await state()).lighting
    if (lighting.error || lighting.indirectLighting?.error)
      throw new Error(JSON.stringify(lighting))
    if (lighting.indirectLighting.actual === 'ddgi') break
    assert.ok(Date.now() < deadline, 'Requested DDGI readiness timed out')
    await page.waitForTimeout(250)
  }
  await frames()
  const value = await state()
  assert.equal(value.product, 'reventon')
  assert.equal(value.products, 1)
  assert.equal(value.bundleVersion, candidateIdentity.version)
  assert.equal(value.sha256, candidateIdentity.sha256)
  assert.equal(value.backend, 'webgpu')
  assert.equal(value.canvases, 1)
  assert.equal(value.sameCanvas, true)
  assert.equal(value.sameRenderer, true)
  assert.deepEqual(value.output, viewport)
  assert.equal(value.lighting.preparation?.sceneInputs, variant === 'candidate')
  assert.equal(value.shadow?.pipelinesPrepared, variant === 'candidate')
  assert.equal(value.shadow?.shadowKernel?.reads, variant === 'candidate' ? 33 : 65)
  assert.ok(value.lighting.frames >= 12)
  assert.ok(
    value.native.counts.createShaderModule > 0,
    'Native instrumentation attached before renderer creation',
  )
  report.checkpoints.push({ stage, ...value })
  await persist()
  return value
}
async function motion(id, target) {
  await evaluate(({ id, target }) => window.__demo.store.motion('play', id, target), { id, target })
  await expect
    .poll(async () => (await state()).motion[id]?.progress, { timeout, intervals: [100, 250] })
    .toBeCloseTo(target, 7)
  await expect.poll(async () => (await state()).motion[id]?.playing, { timeout }).toBe(false)
  await frames()
}
async function checkpoint(name, action) {
  await mark(name)
  const before = await state()
  await action()
  const after = await state()
  assert.ok(
    after.lighting.frames > before.lighting.frames,
    'Operation must produce actual completed coordinator frames',
  )
  assert.equal(after.sameRenderer, true)
  assert.equal(after.canvases, 1)
  report.checkpoints.push({ stage, ...after })
  await persist()
}

try {
  const response = await fetch(new URL('/api/v1/products/reventon', base), {
    signal: AbortSignal.timeout(30000),
  })
  assert.equal(response.status, 200, 'Real API must be ready')
  const product = await response.json()
  assert.equal(product.presentation.source.adapter, 'reventon-v1')
  browser = await chromium.launch({
    channel: process.env.REVENTON_BROWSER_CHANNEL ?? 'msedge',
    headless: process.env.REVENTON_HEADLESS === '1',
    args: [
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling',
    ],
  })
  report.browserVersion = browser.version()
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    reducedMotion: 'no-preference',
  })
  await context.addInitScript(installPipelineObservation, { maxRecords: 5000 })
  page = await context.newPage()
  page.setDefaultTimeout(30000)
  page.on('pageerror', (error) => report.errors.push(String(error)))
  page.on('console', (message) => {
    if (message.type() === 'error') report.errors.push(message.text())
  })
  page.on('requestfailed', (request) => {
    if (report.failedRequests.length < 50)
      report.failedRequests.push({ url: request.url(), reason: request.failure()?.errorText })
  })
  stage = 'first-scene'
  await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 90000 })
  await mark(stage)
  await ready(true)
  await checkpoint('first-open-doors', () => motion('open-doors', 1))
  await checkpoint('first-close-doors', () => motion('open-doors', 0))
  await checkpoint('first-cabin-view', async () => {
    const before = (await state()).camera
    await evaluate(() => window.__demo.store.view('car-cabin'))
    await expect.poll(async () => (await state()).camera, { timeout }).not.toEqual(before)
    await motion('open-doors', 1)
    await frames()
  })
  await checkpoint('first-separation', () => motion('explore-parts', 1))
  await checkpoint('first-reset', async () => {
    await evaluate(() => window.__demo.store.overview())
    for (const id of ['open-doors', 'explore-parts'])
      await expect.poll(async () => (await state()).motion[id]?.progress, { timeout }).toBe(0)
    await frames()
  })
  for (let index = 0; index < reloads; index++) {
    await mark(`same-host-retry-${index + 1}`)
    const previous = (await state()).uuid
    await evaluate(() => window.__demo.store.retry())
    await ready(false, previous)
    await checkpoint(`retry-${index + 1}-open`, () => motion('open-doors', 1))
    await checkpoint(`retry-${index + 1}-close`, () => motion('open-doors', 0))
  }
  assert.deepEqual(report.errors, [])
  assert.deepEqual(report.failedRequests, [])
  const final = { native: await evaluate(() => window.__carPipelineAudit.snapshot()) }
  assert.equal(final.native.dropped, 0, 'Native record limit reached; audit incomplete')
  assert.deepEqual(final.native.issues, [])
  assert.equal(final.native.pending, 0, 'Native asynchronous pipeline creation must settle')
  const rejected = final.native.records.filter((row) => ['threw', 'rejected'].includes(row.status))
  assert.deepEqual(rejected, [])
  report.passed = true
} catch (error) {
  report.failure = { stage, error: String(error), stack: error.stack }
} finally {
  report.finishedAt = new Date().toISOString()
  if (page) {
    const result = await boundedAuditAttempt(
      'Final native pipeline evidence',
      () => evaluate(() => window.__carPipelineAudit?.stop()),
      5000,
    )
    report.native = result.status === 'completed' ? result.value : result
    if (result.status !== 'completed' || !result.value?.restored) report.passed = false
  }
  // Evidence is durable before potentially blocked browser shutdown.
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  const close = browser
    ? await boundedAuditAttempt('Close owned audit browser', () => browser.close(), 5000)
    : { status: 'not-started' }
  report.cleanup = { ...close, confirmed: ['completed', 'not-started'].includes(close.status) }
  if (!report.cleanup.confirmed) report.passed = false
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
}
console.log(
  JSON.stringify({
    passed: report.passed,
    output,
    failure: report.failure ?? null,
    cleanup: report.cleanup,
  }),
)
if (!report.passed) process.exitCode = 1

/* global URL, performance */
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { chromium } from '@playwright/test'
import { bridge, inputPoint } from './demo/browser-check.mjs'
import { localAuditOrigin } from './reventon-performance/audit-origin.mjs'
import { boundedAuditAttempt } from './reventon-performance/audit-deadline.mjs'
import { candidateIdentity } from './reventon-clean-stress/model.mjs'

const output = resolve(process.env.REVENTON_FPS_OUTPUT || 'artifacts/car-startup-fps'),
  base = localAuditOrigin(process.env.CHECK_URL || 'http://127.0.0.1:5181'),
  url = new URL(
    '/?product=reventon&renderPipeline=realtime&indirectLighting=ddgi&assetLoading=streaming&reventonAsset=runtime-v2',
    base,
  ),
  report = {
    passed: false,
    passedMeaning: 'Measurement completed; not a presentation FPS or minimum-FPS acceptance.',
    presentedFpsValidated: false,
    startedAt: new Date().toISOString(),
    method:
      'Real completed coordinator frames per page monotonic elapsed second, after full scene/history commit. No GPU queries, tracing, extra drawing clock or quality changes. Submitted scene FPS is not display presentation FPS.',
    viewport: { width: 1440, height: 1000 },
    segments: [],
    errors: [],
    failedRequests: [],
  }
assert.ok(output.startsWith(resolve('artifacts') + sep))
await mkdir(output, { recursive: true })
let browser, page
const state = () =>
  page.evaluate(() => ({
    atMs: performance.now(),
    lighting: window.__fpsLighting.snapshot(),
    focus: document.hasFocus(),
    visibility: document.visibilityState,
    motion: { ...window.__demo.motion.states.value },
  }))
try {
  browser = await chromium.launch({ channel: 'msedge', headless: false })
  const context = await browser.newContext({ viewport: report.viewport, deviceScaleFactor: 1 })
  page = await context.newPage()
  page.on('pageerror', (e) => report.errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') report.errors.push(m.text())
  })
  page.on('requestfailed', (r) =>
    report.failedRequests.push({ url: r.url(), error: r.failure()?.errorText }),
  )
  await page.goto(url.href, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(
    () => ['ready', 'error'].includes(document.querySelector('.workbench')?.dataset.status),
    null,
    { timeout: 300000 },
  )
  assert.equal(await page.locator('.workbench').getAttribute('data-status'), 'ready')
  report.interactiveObservedMs = await page.evaluate(() => performance.now())
  await bridge(page, true)
  await page.evaluate(() => {
    const seen = new Set()
    const find = (vnode) => {
      if (!vnode || typeof vnode !== 'object' || seen.has(vnode)) return
      seen.add(vnode)
      const c = vnode.component,
        exposed = c?.exposed?.realLighting,
        value = exposed?.value ?? exposed
      if (value?.snapshot && value?.setSignals) return value
      const nested = find(c?.subTree)
      if (nested) return nested
      for (const child of Array.isArray(vnode.children) ? vnode.children : []) {
        const found = find(child)
        if (found) return found
      }
      return find(vnode.suspense?.activeBranch)
    }
    window.__fpsLighting = find(document.querySelector('#app')?._vnode)
  })
  await page.waitForFunction(
    () => window.__fpsLighting?.snapshot().indirectLighting.actual === 'ddgi',
    null,
    { timeout: 120000 },
  )
  report.enhancedObservedMs = await page.evaluate(() => performance.now())
  report.identity = await page.evaluate(() => {
    const c = window.__demo.scene,
      r = c.renderer.instance,
      root = c.scene.value.children.find((n) => n.userData.workbenchProduct)
    return {
      product: root.userData.workbenchProduct,
      sha256: root.userData.bundleSha256,
      output: [r.domElement.width, r.domElement.height],
      gpu: {
        vendor: r.backend.device.adapterInfo.vendor,
        architecture: r.backend.device.adapterInfo.architecture,
        device: r.backend.device.adapterInfo.device,
        description: r.backend.device.adapterInfo.description,
      },
      canvasCount: document.querySelectorAll('canvas').length,
    }
  })
  assert.equal(report.identity.sha256, candidateIdentity.sha256)
  assert.equal(report.identity.product, 'reventon')
  assert.deepEqual(report.identity.output, [1440, 1000])
  assert.equal(report.identity.canvasCount, 1)
  // Match the established interactive audit: activate this known local test
  // tab before timing, without changing visibility properties or RAF policy.
  await page.bringToFront()
  await page.waitForTimeout(5000)
  for (const kind of ['orbit', 'doors', 'separation']) {
    await page.bringToFront()
    for (const id of ['open-doors', 'explore-parts']) {
      await page.evaluate((id) => window.__demo.store.motion('seek', id, 0), id)
      await page.waitForFunction((id) => window.__demo.motion.states.value[id].progress === 0, id)
    }
    await page.evaluate(() => window.__demo.store.view('perspective'))
    await page.waitForTimeout(1000)
    const start = await state(),
      samples = [start],
      began = performance.now()
    let next = 1000
    const point = await inputPoint(page)
    if (kind === 'orbit') {
      await page.mouse.move(point.x, point.y)
      await page.mouse.down()
    }
    try {
      while (performance.now() - began < 10000) {
        const time = performance.now() - began
        if (kind === 'orbit')
          await page.mouse.move(
            point.x + Math.sin(time / 1200) * 130,
            point.y + Math.cos(time / 1500) * 32,
          )
        else
          await page.evaluate(
            (id) => {
              const motion = window.__demo.motion.states.value[id]
              if (!motion.playing)
                window.__demo.store.motion('play', id, motion.progress > 0.5 ? 0 : 1)
            },
            kind === 'doors' ? 'open-doors' : 'explore-parts',
          )
        if (time >= next) {
          samples.push(await state())
          next += 1000
        }
        await page.waitForTimeout(kind === 'orbit' ? 16 : 50)
      }
    } finally {
      if (kind === 'orbit') await page.mouse.up()
    }
    const end = await state()
    samples.push(end)
    const elapsedMs = end.atMs - start.atMs,
      frames = end.lighting.frames - start.lighting.frames
    assert.ok(frames > 1 && elapsedMs >= 10000)
    assert.ok(
      samples.every(
        (s) =>
          s.visibility === 'visible' &&
          !s.lighting.error &&
          s.lighting.indirectLighting.actual === 'ddgi',
      ),
    )
    const windows = samples
      .slice(1)
      .map((s, i) => ({
        elapsedMs: s.atMs - samples[i].atMs,
        frames: s.lighting.frames - samples[i].lighting.frames,
        fps: ((s.lighting.frames - samples[i].lighting.frames) * 1000) / (s.atMs - samples[i].atMs),
      }))
      .filter((s) => s.elapsedMs >= 500)
    report.segments.push({
      kind,
      elapsedMs,
      frames,
      submittedSceneFps: (frames * 1000) / elapsedMs,
      focusedThroughout: samples.every((s) => s.focus),
      windows,
      start,
      end,
    })
    if (kind !== 'orbit')
      await page.evaluate(
        (id) => window.__demo.store.motion('pause', id),
        kind === 'doors' ? 'open-doors' : 'explore-parts',
      )
    console.log(JSON.stringify({ kind, submittedSceneFps: (frames * 1000) / elapsedMs }))
  }
  assert.deepEqual(report.errors, [])
  assert.deepEqual(report.failedRequests, [])
  report.passed = true
} catch (e) {
  report.failure = String(e)
} finally {
  report.completedAt = new Date().toISOString()
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2))
  const cleanup = await boundedAuditAttempt('Close owned FPS browser', () => browser?.close(), 5000)
  report.cleanup = { status: cleanup.status, confirmed: cleanup.status === 'completed' }
  if (!report.cleanup.confirmed) report.passed = false
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2))
}
console.log(JSON.stringify({ passed: report.passed, output, failure: report.failure }))
if (!report.passed) process.exitCode = 1

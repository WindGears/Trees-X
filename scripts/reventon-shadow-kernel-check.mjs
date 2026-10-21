/* global btoa, URL */
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { chromium, expect } from '@playwright/test'
import { bridge } from './demo/browser-check.mjs'
import { localAuditOrigin } from './reventon-performance/audit-origin.mjs'
import { boundedAuditAttempt, withAuditDeadline } from './reventon-performance/audit-deadline.mjs'

// Deliberate one-off shadow-target readback, outside all performance runs.
// Same native renderer, model, target size and poses; no synthetic shadow input.
const base = localAuditOrigin(process.env.CHECK_URL || 'http://127.0.0.1:5181'),
  output = 'artifacts/car-efficiency-20261021/shadow-pixels',
  report = {
    passed: false,
    startedAt: new Date().toISOString(),
    poses: [],
    errors: [],
    meaning: 'RGBA8 contact shadow alpha comparison, not overall render/FPS acceptance.',
  },
  references = new Map()
let browser, page
await mkdir(output, { recursive: true })
const evaluate = (fn, value) =>
  withAuditDeadline('Shadow pixel evidence', () => page.evaluate(fn, value), 30000)
async function drawPose(progress) {
  const frame = await evaluate(() => window.__demo.scene.renderer.instance.info.frame)
  // The store transports one command intent per Vue flush; deliver channels
  // separately so one assignment cannot replace the other before its watcher.
  await evaluate((value) => window.__demo.store.motion('seek', 'open-doors', value), progress.doors)
  await evaluate(
    (value) => window.__demo.store.motion('seek', 'explore-parts', value),
    progress.parts,
  )
  await expect
    .poll(() => evaluate(() => window.__demo.scene.renderer.instance.info.frame), {
      timeout: 30000,
      intervals: [50, 100],
    })
    .toBeGreaterThan(frame + 1)
  await evaluate(async () => {
    const renderer = window.__demo.scene.renderer.instance
    await renderer.backend.device.queue.onSubmittedWorkDone()
  })
}
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true })
  report.browserVersion = browser.version()
  for (const mode of ['legacy', 'paired']) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      deviceScaleFactor: 1,
    })
    page = await context.newPage()
    page.on('pageerror', (error) => report.errors.push(String(error)))
    const url = new URL(
      '/?product=reventon&renderPipeline=realtime&indirectLighting=ssgi&assetLoading=streaming&reventonAsset=runtime-v2',
      base,
    )
    url.searchParams.set('carShadowKernel', mode)
    url.searchParams.set('carPrewarm', mode === 'paired' ? 'on' : 'off')
    await page.goto(url.href, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.workbench[data-status="ready"]', { timeout: 300000 })
    await withAuditDeadline('Shadow scene bridge', () => bridge(page, true), 30000)
    for (const [name, pose] of [
      ['whole', { doors: 0, parts: 0 }],
      ['doors', { doors: 1, parts: 0 }],
      ['separated', { doors: 0.6, parts: 0.6 }],
    ]) {
      await drawPose(pose)
      const captured = await evaluate(async () => {
        const renderer = window.__demo.scene.renderer.instance,
          shadow = window.__demo.scene.scene.value.getObjectByName(
            'Reventon / live contact shadow',
          ),
          target = shadow.material.map.renderTarget
        if (!target || target.width !== 2048 || target.height !== 2048)
          throw Error('Real 2048 shadow target unavailable')
        const bytes = await renderer.readRenderTargetPixelsAsync(
            target,
            0,
            0,
            target.width,
            target.height,
          ),
          alpha = new Uint8Array(target.width * target.height)
        for (let i = 0; i < alpha.length; i++) alpha[i] = bytes[i * 4 + 3]
        let encoded = ''
        for (let i = 0; i < alpha.length; i += 32768)
          encoded += String.fromCharCode(...alpha.subarray(i, i + 32768))
        return {
          alpha: btoa(encoded),
          kernel: shadow.userData.shadowKernel,
          canvases: document.querySelectorAll('canvas').length,
          output: [renderer.domElement.width, renderer.domElement.height],
          motion: Object.fromEntries(
            Object.entries(window.__demo.motion.states.value).map(([id, value]) => [
              id,
              value.progress,
            ]),
          ),
        }
      })
      const bytes = Buffer.from(captured.alpha, 'base64')
      delete captured.alpha
      assert.equal(captured.canvases, 1)
      assert.deepEqual(captured.output, [1440, 1000])
      assert.equal(captured.motion['open-doors'], pose.doors)
      assert.equal(captured.motion['explore-parts'], pose.parts)
      assert.equal(captured.kernel.reads, mode === 'legacy' ? 65 : 33)
      await writeFile(`${output}/${mode}-${name}.alpha`, bytes)
      await page.screenshot({ path: `${output}/${mode}-${name}.png` })
      const entry = {
        mode,
        name,
        ...captured,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        nonzero: bytes.reduce((n, b) => n + (b > 0), 0),
      }
      assert.ok(entry.nonzero > 1000, 'Projection must contain actual model shadow')
      if (mode === 'legacy') references.set(name, bytes)
      else {
        const reference = references.get(name)
        assert.equal(bytes.length, reference.length)
        let max = 0,
          total = 0,
          changed = 0,
          overOne = 0
        for (let i = 0; i < bytes.length; i++) {
          const delta = Math.abs(bytes[i] - reference[i])
          max = Math.max(max, delta)
          total += delta
          changed += delta > 0
          overOne += delta > 1
        }
        entry.difference = {
          maxAlphaByte: max,
          meanAlphaByte: total / bytes.length,
          changedPixels: changed,
          overOneBytePixels: overOne,
          pixels: bytes.length,
        }
        assert.ok(
          max <= 2 && total / bytes.length <= 0.02,
          'Paired projection differs beyond RGBA8 rounding tolerance',
        )
      }
      report.poses.push(entry)
      await writeFile(`${output}/partial-report.json`, JSON.stringify(report, null, 2))
    }
    await context.close()
  }
  assert.deepEqual(report.errors, [])
  report.passed = true
} catch (error) {
  report.failure = String(error)
} finally {
  report.completedAt = new Date().toISOString()
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2))
  const closed = await boundedAuditAttempt(
    'Close shadow test browser',
    () => browser?.close(),
    5000,
  )
  report.cleanup = { status: closed.status, confirmed: closed.status === 'completed' }
  if (!report.cleanup.confirmed) report.passed = false
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2))
}
console.log(JSON.stringify({ passed: report.passed, failure: report.failure, output }))
if (!report.passed) process.exitCode = 1

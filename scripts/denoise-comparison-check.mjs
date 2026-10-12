/* global URL, URLSearchParams */
import { chromium, expect } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'

const base = process.env.CHECK_URL || 'http://127.0.0.1:5183',
  output = process.env.DENOISE_COMPARISON_OUTPUT || 'artifacts/hybrid-workbench/denoise-comparison',
  views = (process.env.DENOISE_COMPARISON_VIEWS || 'whole,paint,metal,layers,flat').split(',')
for (const view of views) {
  if (!['whole', 'paint', 'metal', 'layers', 'flat'].includes(view))
    throw new Error('Invalid comparison view')
}
await mkdir(output, { recursive: true })
const report = {
  passed: false,
  input: 'Independent common-input render lab; not production screenshots',
  requestedSamples: [32, 64, 128, 1024],
  captures: [],
  runs: [],
  requestOrigins: [],
  errors: [],
}
const browser = await chromium.launch({ channel: 'msedge', headless: true })
try {
  for (const view of views) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }),
      errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
    page.on('response', (response) => {
      if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`)
    })
    page.on('request', (request) => {
      if (/^https?:/.test(request.url())) report.requestOrigins.push(new URL(request.url()).origin)
    })
    try {
      const query = new URLSearchParams({ mode: 'pathtrace', view, samples: '32', capture: '1' })
      await page.goto(`${base}/renderlab.html?${query}`)
      let reference
      for (const target of [32, 64, 128, 1024]) {
        const started = Date.now(),
          deadline = started + 15 * 60 * 1000
        let evidence,
          lastLog = 0
        while (true) {
          evidence = await page.evaluate(() => window.__treesRenderLab?.snapshot())
          if (evidence?.phase === 'ready') break
          if (evidence && ['error', 'disposed', 'paused'].includes(evidence.phase))
            throw new Error(evidence.message)
          if (Date.now() > deadline) throw new Error(`Path-trace target ${target} timed out`)
          if (Date.now() - lastLog > 10000) {
            lastLog = Date.now()
            console.log(`OIDN comparison ${view}/${target}: ${evidence?.message ?? 'loading'}`)
          }
          await page.waitForTimeout(500)
        }
        expect(evidence.identity.parts).toBe(572)
        expect(evidence.runtime.backend.actual).toBe('webgpu')
        expect(evidence.runtime.backend.fallback).toBe(false)
        expect(evidence.runtime.rendererCount).toBe(1)
        expect(evidence.runtime.canvasCount).toBe(1)
        expect(evidence.runtime.drawingBuffer).toEqual([1440, 1000])
        expect(evidence.runtime.dpr).toBe(1)
        expect(evidence.runtime.samples.min).toBe(target)
        expect(evidence.runtime.samples.max).toBe(target)
        const common = {
          identity: evidence.identity,
          camera: evidence.camera,
          materials: evidence.materials,
          settings: evidence.settings,
        }
        if (reference) expect(common).toEqual(reference)
        else reference = common
        const samplingWallMs = Date.now() - started
        if (target < 1024) {
          const checkpoint = await page.evaluate(
            (minimum) => window.__treesRenderLab.denoiseCheckpoint(minimum),
            target,
          )
          expect(checkpoint.evidence.runtime.samples.min).toBe(target)
          expect(checkpoint.denoise.complete).toBe(true)
          expect(checkpoint.denoise.hdr).toBe(true)
          expect(checkpoint.denoise.auxiliary).toEqual(['albedo', 'normal'])
          expect(checkpoint.denoise.runtime.gpuEngine).toBe('wgsl')
          expect(checkpoint.denoise.runtime.inputChannels).toBe(9)
          expect(checkpoint.pixels.opaque).toBeGreaterThan(1440000 * 0.95)
          expect(checkpoint.pixels.levels).toBeGreaterThanOrEqual(32)
          await writeFile(
            `${output}/denoised-${view}-${target}.png`,
            Buffer.from(checkpoint.png.split(',')[1], 'base64'),
          )
          await writeFile(
            `${output}/raw-${view}-${target}.png`,
            Buffer.from(checkpoint.raw.png.split(',')[1], 'base64'),
          )
          await writeFile(
            `${output}/denoised-${view}-${target}.json`,
            JSON.stringify(checkpoint.evidence, null, 2) + '\n',
          )
          report.captures.push(`denoised-${view}-${target}`, `raw-${view}-${target}`)
          report.runs.push({
            view,
            target,
            actualSamples: evidence.runtime.samples,
            samplingWallMs,
            denoise: checkpoint.denoise,
            sameAccumulation: true,
          })
          await page.evaluate(
            (next) => window.__treesRenderLab.resumeTo(next),
            target === 32 ? 64 : target === 64 ? 128 : 1024,
          )
        } else {
          const raw = await page.evaluate(() => window.__treesRenderLab.png())
          expect(raw.pixels.opaque).toBeGreaterThan(1440000 * 0.95)
          expect(raw.pixels.levels).toBeGreaterThanOrEqual(32)
          await writeFile(
            `${output}/raw-${view}-1024.png`,
            Buffer.from(raw.png.split(',')[1], 'base64'),
          )
          await writeFile(
            `${output}/raw-${view}-1024.json`,
            JSON.stringify(evidence, null, 2) + '\n',
          )
          report.captures.push(`raw-${view}-1024`)
          report.runs.push({
            view,
            target,
            actualSamples: evidence.runtime.samples,
            samplingWallMs,
            denoise: null,
            sameAccumulation: true,
          })
          const stopped = await page.evaluate(() => window.__treesRenderLab.snapshot())
          await page.waitForTimeout(600)
          expect(
            (await page.evaluate(() => window.__treesRenderLab.snapshot())).runtime.renderCalls,
          ).toBe(stopped.runtime.renderCalls)
        }
      }
      expect(errors).toEqual([])
    } catch (error) {
      report.failure = { view, message: error.stack || String(error) }
      await page.screenshot({ path: `${output}/failure-${view}.png` }).catch(() => {})
      throw error
    } finally {
      report.errors.push(...errors)
      await page.evaluate(() => window.__treesRenderLab?.dispose()).catch(() => {})
      await page.close()
    }
  }
  expect(report.requestOrigins.every((origin) => origin === new URL(base).origin)).toBe(true)
  report.passed = true
} catch (error) {
  report.failure ??= { message: error.stack || String(error) }
} finally {
  await browser.close()
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2) + '\n')
}
console.log(
  JSON.stringify(
    {
      passed: report.passed,
      runs: report.runs.length,
      captures: report.captures.length,
      output,
      failure: report.failure,
    },
    null,
    2,
  ),
)
if (!report.passed) process.exitCode = 1

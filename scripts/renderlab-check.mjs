/* global URL, URLSearchParams */
import { chromium, expect } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'

const base = process.env.CHECK_URL || 'http://127.0.0.1:5183',
  output = process.env.RENDERLAB_OUTPUT || 'artifacts/renderlab/check',
  samples = Number(process.env.RENDERLAB_SAMPLES || 128),
  views = (process.env.RENDERLAB_VIEWS || 'whole,paint,metal,layers,flat').split(','),
  modes = (process.env.RENDERLAB_MODES || 'webgl,webgpu,pathtrace').split(',')
if (!Number.isInteger(samples) || samples < 1 || samples > 1024)
  throw new Error('Invalid sample target')
await mkdir(output, { recursive: true })
const report = {
  passed: false,
  captures: [],
  runs: [],
  errors: [],
  requestOrigins: [],
  comparisons: [],
  checkpoints: [],
  interactions: [],
}
const browser = await chromium.launch({
  channel: 'msedge',
  headless: process.env.RENDERLAB_HEADED !== '1',
})
const reference = new Map()
try {
  // A page is closed before the next mode starts: there is never a second live renderer.
  for (const view of views)
    for (const mode of modes) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
      const errors = []
      page.on('pageerror', (error) => errors.push(error.message))
      page.on('response', (response) => {
        if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`)
      })
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text())
      })
      page.on('request', (request) => {
        if (/^https?:/.test(request.url()))
          report.requestOrigins.push(new URL(request.url()).origin)
      })
      try {
        const query = new URLSearchParams({ mode, view, samples: String(samples), capture: '1' })
        console.log(`Render lab: ${mode}/${view}, target ${samples} spp`)
        await page.goto(`${base}/renderlab.html?${query}`)
        const deadline = Date.now() + (mode === 'pathtrace' ? 15 * 60 * 1000 : 120000)
        let checkpointCaptured = false,
          lastLog = 0
        while (true) {
          const progress = await page.evaluate(() => window.__treesRenderLab?.snapshot())
          if (progress && ['ready', 'error', 'paused'].includes(progress.phase)) break
          if (Date.now() > deadline) throw new Error('Renderer or sample target timed out')
          if (Date.now() - lastLog > 10000) {
            lastLog = Date.now()
            console.log(`${mode}/${view}: ${progress?.message ?? 'loading entry'}`)
          }
          if (
            mode === 'pathtrace' &&
            view === 'whole' &&
            samples > 32 &&
            !checkpointCaptured &&
            progress?.runtime?.samples?.min >= 32
          ) {
            const checkpoint = await page.evaluate(() => window.__treesRenderLab.checkpoint(32))
            await writeFile(
              `${output}/pathtrace-whole-checkpoint-min32.png`,
              Buffer.from(checkpoint.png.split(',')[1], 'base64'),
            )
            await writeFile(
              `${output}/pathtrace-whole-checkpoint-min32.json`,
              JSON.stringify(checkpoint.evidence, null, 2) + '\n',
            )
            report.checkpoints.push({
              view,
              minimumRequested: 32,
              actual: checkpoint.evidence.runtime.samples,
              pixels: checkpoint.pixels,
              sameAccumulation: true,
            })
            checkpointCaptured = true
          }
          await page.waitForTimeout(500)
        }
        const evidence = await page.evaluate(() => window.__treesRenderLab.snapshot())
        report.runs.push(evidence)
        expect(evidence.phase, evidence.message).toBe('ready')
        expect(evidence.identity.parts).toBe(572)
        expect(evidence.runtime.rendererCount).toBe(1)
        expect(evidence.runtime.canvasCount).toBe(1)
        expect(evidence.runtime.drawingBuffer).toEqual([1440, 1000])
        expect(evidence.runtime.dpr).toBe(1)
        expect(evidence.runtime.renderCalls).toBeGreaterThan(0)
        expect(evidence.runtime.backend.actual).toBe(mode === 'webgl' ? 'webgl2' : 'webgpu')
        if (mode !== 'webgl') {
          expect(evidence.runtime.backend.fallback).toBe(false)
          expect(evidence.runtime.backend.device).toBe('[object GPUDevice]')
        }
        if (mode === 'pathtrace') {
          expect(evidence.runtime.samples.min).toBeGreaterThanOrEqual(samples)
          const calls = evidence.runtime.renderCalls
          await page.waitForTimeout(400)
          const stopped = await page.evaluate(() => window.__treesRenderLab.snapshot())
          expect(stopped.runtime.renderCalls).toBe(calls)
          report.comparisons.push({
            view,
            convergence: 'target reached; no denoising',
            samples: evidence.runtime.samples,
          })
        }
        const common = {
          settings: evidence.settings,
          identity: evidence.identity,
          materials: evidence.materials,
          camera: {
            position: evidence.camera.position,
            target: evidence.camera.target,
            quaternion: evidence.camera.quaternion,
            fov: evidence.camera.fov,
            zoom: evidence.camera.zoom,
            view: evidence.camera.view,
            matrixWorld: evidence.camera.matrixWorld,
          },
        }
        // Clip-space Z conventions differ; position/target/FOV/zoom/offset must not.
        if (reference.has(view)) {
          const expected = reference.get(view)
          expect({ ...common, camera: undefined }).toEqual({ ...expected, camera: undefined })
          expect({
            fov: common.camera.fov,
            zoom: common.camera.zoom,
            view: common.camera.view,
          }).toEqual({
            fov: expected.camera.fov,
            zoom: expected.camera.zoom,
            view: expected.camera.view,
          })
          let maximumCameraError = 0
          for (const field of ['position', 'target', 'quaternion', 'matrixWorld']) {
            expect(common.camera[field].length).toBe(expected.camera[field].length)
            for (let i = 0; i < common.camera[field].length; i++)
              maximumCameraError = Math.max(
                maximumCameraError,
                Math.abs(common.camera[field][i] - expected.camera[field][i]),
              )
          }
          // OrbitControls spherical round-trip introduces machine-precision tails.
          // Keep raw evidence; reject any world-space difference above 1e-12.
          expect(maximumCameraError).toBeLessThanOrEqual(1e-12)
          report.comparisons.push({ view, mode, maximumCameraError, cameraTolerance: 1e-12 })
        } else reference.set(view, common)
        const capture = await page.evaluate(() => window.__treesRenderLab.png())
        expect(capture.png.startsWith('data:image/png;base64,')).toBe(true)
        expect(capture.pixels.opaque).toBeGreaterThan(capture.pixels.total * 0.95)
        expect(capture.pixels.levels).toBeGreaterThanOrEqual(32)
        evidence.pixels = capture.pixels
        await writeFile(
          `${output}/${mode}-${view}.png`,
          Buffer.from(capture.png.split(',')[1], 'base64'),
        )
        await writeFile(`${output}/${mode}-${view}.json`, JSON.stringify(evidence, null, 2) + '\n')
        report.captures.push(`${mode}-${view}`)
        if (mode !== 'pathtrace' && view === 'whole') {
          const before = await page.evaluate(() => window.__treesRenderLab.snapshot())
          await page.mouse.move(820, 520)
          await page.mouse.down()
          await page.mouse.move(900, 545, { steps: 10 })
          await page.mouse.up()
          await expect
            .poll(
              async () =>
                (await page.evaluate(() => window.__treesRenderLab.snapshot())).runtime.renderCalls,
            )
            .toBeGreaterThan(before.runtime.renderCalls)
          const rotated = await page.evaluate(() => window.__treesRenderLab.snapshot())
          expect(rotated.camera.position).not.toEqual(before.camera.position)
          await page.mouse.wheel(0, 220)
          await expect
            .poll(
              async () =>
                (await page.evaluate(() => window.__treesRenderLab.snapshot())).runtime.renderCalls,
            )
            .toBeGreaterThan(rotated.runtime.renderCalls)
          const zoomed = await page.evaluate(() => window.__treesRenderLab.snapshot())
          expect(zoomed.camera.position).not.toEqual(rotated.camera.position)
          const moved = await page.evaluate(() => window.__treesRenderLab.png())
          expect(moved.png).not.toBe(capture.png)
          await writeFile(
            `${output}/${mode}-interactive.png`,
            Buffer.from(moved.png.split(',')[1], 'base64'),
          )
          const idle = await page.evaluate(() => window.__treesRenderLab.snapshot())
          await page.waitForTimeout(500)
          const stopped = await page.evaluate(() => window.__treesRenderLab.snapshot())
          expect(stopped.runtime.renderCalls).toBe(idle.runtime.renderCalls)
          report.interactions.push({
            mode,
            rotated: true,
            zoomed: true,
            pixelsChanged: true,
            idleStopped: true,
          })
        }
        expect(errors).toEqual([])
      } catch (error) {
        report.failure = { mode, view, message: String(error) }
        await page.screenshot({ path: `${output}/failure-${mode}-${view}.png` }).catch(() => {})
        throw error
      } finally {
        report.errors.push(...errors)
        await page.evaluate(() => window.__treesRenderLab?.dispose()).catch(() => {})
        await page.close()
      }
    }
  expect(report.requestOrigins.every((origin) => origin === new URL(base).origin)).toBe(true)
  report.passed = true
} finally {
  await browser.close()
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2) + '\n')
}
console.log(
  JSON.stringify({ passed: report.passed, captures: report.captures, errors: report.errors }),
)

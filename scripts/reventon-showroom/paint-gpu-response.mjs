/* global window */
import assert from 'node:assert/strict'
import { URLSearchParams } from 'node:url'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium, expect } from '@playwright/test'
import { unpackRgbaReadback } from './rgba-readback.mjs'
import {
  attachShowroomBridge,
  showroomState,
  selectShowroomView,
  cameraError,
  flushShowroomGpu,
} from './browser.mjs'

// Test-only, bounded readback of real attachments. No production hooks or extra draw loop.
const output = 'artifacts/car-showroom/paint-gpu-response'
const base = 'http://127.0.0.1:5181/'
const params = {
  product: 'reventon',
  renderPipeline: 'realtime',
  indirectLighting: 'ddgi',
  assetLoading: 'streaming',
  reventonAsset: 'runtime-v2',
  carQuality: 'studio',
  carKeyShadow: '1',
  carShowroom: 'cold-studio',
  carFloor: 'cycles',
  carFloorLight: 'local',
  carFloorReflection: 'planar',
  carStudioPaint: 'metallic',
  carAntialias: 'msaa',
  carStudioTrim: 'satin',
  carCabinLight: 'local',
}
const report = {
  passed: false,
  visualPassed: false,
  errors: [],
  captures: [],
  method:
    'Fixed side camera, r14 versus r15, real linear HDR surface baseSpecular/baseDiffuse and native beauty. Bounded asynchronous readbacks can span adjacent static frames; not a same-frame additive decomposition. ROI paint mask uses actual G-buffer metallic value plus source base-color match, and is not a semantic ID buffer. No performance measurement.',
}
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'msedge', headless: true })
try {
  for (const finish of ['rim', 'stone']) {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
      deviceScaleFactor: 1,
    })
    page.on('pageerror', (e) => report.errors.push(e.message))
    page.on('console', (m) => {
      if (m.type() === 'error') report.errors.push(m.text())
    })
    const url = base + '?' + new URLSearchParams({ ...params, carStudioFinish: finish })
    await page.goto(url)
    await page.addScriptTag({
      content: `window.__unpackRgbaReadback = ${unpackRgbaReadback.toString()}`,
    })
    await expect(page.getByRole('slider', { name: '摄影棚照明', exact: true })).toBeVisible({
      timeout: 240000,
    })
    await attachShowroomBridge(page)
    await expect
      .poll(
        async () => {
          const s = (await page.evaluate(showroomState)).lighting
          return (
            s.phase === 'ready' &&
            s.keyShadow?.phase === 'ready' &&
            s.indirectLighting.actual === 'ddgi'
          )
        },
        { timeout: 240000 },
      )
      .toBe(true)
    const target = await selectShowroomView(page, 'perspective', {
      position: [6, 1.55, -0.3],
      target: [0, 0.7, -0.3],
    })
    await expect
      .poll(async () => cameraError((await page.evaluate(showroomState)).camera, target), {
        timeout: 90000,
      })
      .toBeLessThan(1e-6)
    await page.evaluate(() => {
      const renderer = window.__demo.scene.renderer.instance
      const original = renderer.setRenderTarget
      window.__paintTargets = new Map()
      renderer.setRenderTarget = function (target, ...args) {
        if (target?.textures?.some((t) => t.name === 'baseSpecular'))
          window.__paintTargets.set('surface', target)
        if (target?.textures?.some((t) => t.name === 'correctionThroughput'))
          window.__paintTargets.set('beauty', target)
        return original.call(this, target, ...args)
      }
      window.__restorePaintTargets = () => {
        renderer.setRenderTarget = original
      }
    })
    for (const mode of ['complete', 'native']) {
      await page.evaluate(
        (mode) => window.__carLighting.setSignals(mode === 'complete', mode === 'complete', true),
        mode,
      )
      const frames = (await page.evaluate(showroomState)).lighting.frames
      await expect
        .poll(async () => (await page.evaluate(showroomState)).lighting.frames, { timeout: 90000 })
        .toBeGreaterThan(frames + 40)
      await flushShowroomGpu(page)
      const state = await page.evaluate(showroomState)
      assert.equal(state.sameRenderer && state.sameCanvas, true)
      assert.equal(state.canvases, 1)
      assert.deepEqual(state.output, [1440, 1000])
      assert.deepEqual(state.gpuErrors, [])
      const pixels = await page.evaluate(async () => {
        const renderer = window.__demo.scene.renderer.instance
        const surface = window.__paintTargets.get('surface'),
          beauty = window.__paintTargets.get('beauty')
        if (!surface || !beauty) throw new Error('Actual surface/beauty target not captured')
        const half = (v) => {
          const s = v & 32768 ? -1 : 1,
            e = (v >> 10) & 31,
            f = v & 1023
          return e === 31
            ? f
              ? NaN
              : s * Infinity
            : s * (e === 0 ? f * 2 ** -24 : (1 + f / 1024) * 2 ** (e - 15))
        }
        const regions = [
          { id: 'lower-door', x: 770, y: 570, width: 200, height: 30 },
          { id: 'upper-door', x: 770, y: 515, width: 150, height: 20 },
          { id: 'rear-highlight', x: 370, y: 490, width: 150, height: 20 },
          { id: 'wall-control', x: 770, y: 240, width: 150, height: 20 },
        ]
        const root = window.__demo.scene.scene.value.children.find(
          (n) => n.userData.workbenchProduct,
        )
        let paint
        root.traverse((n) => {
          for (const m of n.isMesh ? (Array.isArray(n.material) ? n.material : [n.material]) : [])
            if (m.userData.source_vpb_material_id === 20159) paint = m
        })
        if (!paint || Math.abs(paint.metalness - 0.65) > 1e-6)
          throw new Error('Expected metallic paint missing')
        // MRT albedo uses diffuseColor after setupVariants, i.e. pre energy-split base color.
        const expected = paint.color.toArray()
        const results = []
        for (const region of regions) {
          const channels = {}
          for (const name of ['albedo', 'normal', 'baseSpecular', 'baseDiffuse', 'beauty']) {
            const rt = name === 'beauty' ? beauty : surface
            const index =
              name === 'beauty'
                ? rt.textures.findIndex((t) => t.name === 'output')
                : rt.textures.findIndex((t) => t.name === name)
            if (index < 0 || rt.width !== 1440 || rt.height !== 1000)
              throw new Error('Unexpected target layout')
            const values = await renderer.readRenderTargetPixelsAsync(
              rt,
              region.x,
              region.y,
              region.width,
              region.height,
              index,
            )
            channels[name] = Array.from(
              window.__unpackRgbaReadback(values, region.width, region.height),
              values instanceof Uint16Array
                ? half
                : values instanceof Uint8Array
                  ? (v) => v / 255
                  : (v) => v,
            )
          }
          const all = [],
            mask = []
          for (let i = 0; i < region.width * region.height; i++) {
            all.push(i)
            const a = channels.albedo.slice(i * 4, i * 4 + 4)
            if (
              Math.abs(a[3] - 0.65) < 0.01 &&
              expected.every((c, k) => Math.abs(a[k] - c) < 0.015)
            )
              mask.push(i)
          }
          const summarize = (indices) =>
            Object.fromEntries(
              Object.entries(channels).map(([name, values]) => {
                const average = [0, 1, 2, 3].map(
                  (c) =>
                    indices.reduce((sum, i) => sum + values[i * 4 + c], 0) /
                    Math.max(1, indices.length),
                )
                return [
                  name,
                  {
                    mean: average,
                    luminance: average[0] * 0.2126 + average[1] * 0.7152 + average[2] * 0.0722,
                  },
                ]
              }),
            )
          results.push({
            ...region,
            maskPixels: mask.length,
            masked: summarize(mask),
            all: summarize(all),
          })
        }
        return {
          expected,
          paint: {
            metalness: paint.metalness,
            roughness: paint.roughness,
            clearcoat: paint.clearcoat,
          },
          results,
        }
      })
      const file = `${finish}-${mode}.png`
      await page.screenshot({ path: `${output}/${file}` })
      report.captures.push({ finish, mode, url, file, state, pixels })
      await writeFile(`${output}/checkpoint.json`, JSON.stringify(report, null, 2))
      for (const roi of pixels.results.slice(0, 3)) {
        assert.ok(
          roi.maskPixels > roi.width * roi.height * 0.8,
          `Paint ROI/origin mismatch: ${roi.id}`,
        )
        for (const value of Object.values(roi.masked)) assert.ok(value.mean.every(Number.isFinite))
      }
      assert.equal(pixels.results[3].maskPixels, 0, 'Control ROI must reject non-paint')
      console.log(
        `${finish}-${mode}: ${pixels.results.map((r) => `${r.id}=${r.maskPixels}`).join(', ')}`,
      )
    }
    await page.evaluate(() => window.__restorePaintTargets())
    await page.close()
  }
  for (const mode of ['complete', 'native']) {
    const [a, b] = report.captures.filter((c) => c.mode === mode)
    for (const key of ['camera', 'lights', 'exposure', 'sha256'])
      assert.deepEqual(a.state[key], b.state[key])
    assert.deepEqual(a.pixels.paint, b.pixels.paint)
  }
  assert.deepEqual(report.errors, [])
  report.passed = true
} catch (error) {
  report.failure = String(error)
  throw error
} finally {
  await browser.close()
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2))
}

import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium, expect } from '@playwright/test'
import {
  attachShowroomBridge,
  showroomState,
  flushShowroomGpu,
} from './reventon-showroom/browser.mjs'

// Diagnostic only: near-plane probes never change the product camera contract.
const msaa = process.env.TREES_CAR_MSAA === '1'
const output = msaa ? 'artifacts/car-showroom/edge-msaa' : 'artifacts/car-showroom/edge-isolation'
await mkdir(output, { recursive: true })
const report = { passed: false, errors: [], samples: [] }
const browser = await chromium.launch({ channel: 'msedge', headless: true })
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
  })
  page.on('pageerror', (e) => report.errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') report.errors.push(m.text())
  })
  await page.goto(
    'http://127.0.0.1:5181/?product=reventon&renderPipeline=realtime&indirectLighting=ddgi&assetLoading=streaming&reventonAsset=runtime-v2&carQuality=studio&carKeyShadow=1&carShowroom=cold-studio&carFloor=cycles&carFloorLight=local&carFloorReflection=planar&carStudioFinish=refined&carStudioPaint=graphite' +
      (msaa ? '&carAntialias=msaa' : ''),
  )
  await expect(page.getByRole('slider', { name: '灯板亮度 · 调试' })).toBeVisible({
    timeout: 240000,
  })
  await attachShowroomBridge(page)
  await expect
    .poll(
      async () => {
        const s = await page.evaluate(showroomState)
        return (
          s.lighting.phase === 'ready' &&
          s.lighting.keyShadow?.phase === 'ready' &&
          s.lighting.indirectLighting.actual === 'ddgi'
        )
      },
      { timeout: 240000 },
    )
    .toBe(true)
  report.camera = await page.evaluate(() => {
    const camera = window.__demo.scene.camera.activeCamera.value
    return { near: camera.near, far: camera.far }
  })
  for (const [name, signals, near] of [
    ['full', true, report.camera.near],
    ['native', false, report.camera.near],
    ['native-near', false, 0.5],
    ['full-near', true, 0.5],
  ]) {
    const before = (await page.evaluate(showroomState)).lighting.frames
    await page.evaluate(
      ({ signals, near }) => {
        window.__carLighting.setSignals(signals, signals, true)
        const camera = window.__demo.scene.camera.activeCamera.value
        camera.near = near
        camera.updateProjectionMatrix()
      },
      { signals, near },
    )
    await expect
      .poll(async () => (await page.evaluate(showroomState)).lighting.frames, { timeout: 90000 })
      .toBeGreaterThan(before + 64)
    await flushShowroomGpu(page)
    const state = await page.evaluate(showroomState)
    assert.equal(state.lighting.signals.beautySamples, msaa ? 4 : 0)
    assert.equal(state.canvases, 1)
    assert.deepEqual(state.gpuErrors, [])
    await page.screenshot({ path: `${output}/${name}.png` })
    report.samples.push({ name, signals, near, state })
    console.log(`Captured ${name}`)
  }
  assert.deepEqual(report.errors, [])
  report.passed = true
} finally {
  await browser.close()
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2))
}

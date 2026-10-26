import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium, expect } from '@playwright/test'
import {
  attachShowroomBridge,
  showroomState,
  flushShowroomGpu,
} from './reventon-showroom/browser.mjs'

// Disposable material sensitivity study. These overrides deliberately do not
// update the offline room probe and must never be published as matched bakes.
const output = 'artifacts/car-showroom/look-sensitivity'
await mkdir(output, { recursive: true })
const report = {
  passed: false,
  errors: [],
  samples: [],
  limitation: 'Floor changes are preview-only; room radiance remains r11.',
}
const browser = await chromium.launch({ channel: 'msedge', headless: true })
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
  })
  page.on('pageerror', (error) => report.errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') report.errors.push(message.text())
  })
  await page.goto(
    'http://127.0.0.1:5181/?product=reventon&renderPipeline=realtime&indirectLighting=ddgi&assetLoading=streaming&reventonAsset=runtime-v2&carQuality=studio&carKeyShadow=1&carShowroom=cold-studio&carFloor=cycles&carFloorLight=local&carFloorReflection=planar&carStudioFinish=refined&carStudioPaint=graphite',
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
  const variants = [
    { name: 'baseline', paint: [0.42, 0.28, 0.24], floor: ['#a9a9a9', 1.3] },
    { name: 'coat', paint: [0.3, 0.65, 0.13], floor: ['#a9a9a9', 1.3] },
    { name: 'floor-polished', paint: [0.42, 0.28, 0.24], floor: ['#a9a9a9', 0.8] },
    { name: 'floor-dark', paint: [0.42, 0.28, 0.24], floor: ['#737373', 1.3] },
    { name: 'combined', paint: [0.3, 0.65, 0.13], floor: ['#737373', 0.8] },
  ]
  for (const variant of variants) {
    const before = (await page.evaluate(showroomState)).lighting.frames
    const changes = await page.evaluate(({ paint, floor }) => {
      const seen = new Set(),
        changed = []
      window.__demo.scene.scene.value.traverse((object) => {
        if (!object.isMesh) return
        const isFloor = object.userData.showroomSurface === 'floor'
        for (let m of Array.isArray(object.material) ? object.material : [object.material]) {
          while (m && !seen.has(m)) {
            seen.add(m)
            if (/\/ 20159$/.test(m.name)) {
              ;[m.roughness, m.clearcoat, m.clearcoatRoughness] = paint
              changed.push({ name: m.name, paint })
            }
            if (isFloor && m.color) {
              m.color.set(floor[0])
              m.roughness = floor[1]
              changed.push({ name: object.name, floor })
            }
            m = m.source
          }
        }
      })
      return changed
    }, variant)
    assert.ok(
      changes.some((x) => x.floor),
      'actual floor material required',
    )
    assert.ok(
      changes.some((x) => x.paint),
      'actual paint material required',
    )
    await expect
      .poll(async () => (await page.evaluate(showroomState)).lighting.frames, { timeout: 90000 })
      .toBeGreaterThan(before + 64)
    await flushShowroomGpu(page)
    const state = await page.evaluate(showroomState)
    assert.equal(state.canvases, 1)
    assert.deepEqual(state.gpuErrors, [])
    report.samples.push({ ...variant, changes, state })
    await page.screenshot({ path: `${output}/${variant.name}.png` })
    console.log(`Captured ${variant.name}`)
  }
  assert.deepEqual(report.errors, [])
  report.passed = true
} finally {
  await browser.close()
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2))
}

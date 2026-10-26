import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium, expect } from '@playwright/test'
import {
  attachShowroomBridge,
  showroomState,
  flushShowroomGpu,
  seekShowroomMotion,
} from './reventon-showroom/browser.mjs'

const output = process.env.TREES_PAINT_BINDING_OUTPUT ?? 'artifacts/car-showroom/paint-binding-r10'
await mkdir(output, { recursive: true })
const report = { passed: false, errors: [], captures: [] }
const browser = await chromium.launch({ channel: 'msedge', headless: true })
function bindings() {
  const root = window.__demo.scene.scene.value.children.find(
    (node) => node.userData.workbenchProduct,
  )
  const paint = {},
    plastic = {}
  root.traverse((object) => {
    if (!object.isMesh) return
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      const data = {
        color: material.color?.toArray(),
        roughness: material.roughness,
        clearcoat: material.clearcoat,
      }
      if (/\/ 20159$/.test(material.name)) paint[material.name] = data
      if (/\/ 15023$/.test(material.name)) plastic[material.name] = data
    }
  })
  return { resolution: root.userData.finishBinding, paint, plastic }
}
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
    'http://127.0.0.1:5181/?product=reventon&renderPipeline=realtime&indirectLighting=ddgi&assetLoading=streaming&reventonAsset=runtime-v2&carQuality=studio&carKeyShadow=1&carShowroom=cold-studio&carFloor=cycles&carFloorLight=local&carFloorReflection=planar',
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
          s.lighting.keyShadow?.phase === 'ready' && s.lighting.indirectLighting.actual === 'ddgi'
        )
      },
      { timeout: 240000 },
    )
    .toBe(true)
  const baseline = await page.evaluate(bindings)
  assert.equal(baseline.resolution.corrected, true)
  assert.equal(Object.keys(baseline.paint).length, 4)
  assert.equal(Object.keys(baseline.plastic).length, 8)
  report.baseline = baseline
  for (const finish of ['ivory', 'graphite', 'original']) {
    const before = (await page.evaluate(showroomState)).lighting.frames
    const expected = await page.evaluate((id) => {
      const store = window.__demo.store
      const color = store.presentation.finishes.find((f) => f.id === id).color
      const camera = window.__demo.scene.camera.activeCamera.value
      // Three Color belongs to the existing material; no second Three runtime.
      let sample
      window.__demo.scene.scene.value.traverse((o) => {
        if (o.isMesh && !sample && !Array.isArray(o.material) && o.material.color)
          sample = o.material.color.clone().set(color).toArray()
      })
      store.finish(id)
      return { color: sample, camera: camera.matrixWorld.toArray() }
    }, finish)
    await expect
      .poll(async () => (await page.evaluate(showroomState)).lighting.frames, { timeout: 90000 })
      .toBeGreaterThan(before + 64)
    await flushShowroomGpu(page)
    const result = await page.evaluate(bindings)
    assert.deepEqual(
      result.plastic,
      baseline.plastic,
      'Paint selection must not recolor or varnish plastic',
    )
    for (const [name, material] of Object.entries(result.paint))
      assert.deepEqual(
        material.color,
        finish === 'original' ? baseline.paint[name].color : expected.color,
      )
    const state = await page.evaluate(showroomState)
    assert.equal(state.canvases, 1)
    assert.deepEqual(state.gpuErrors, [])
    report.captures.push({ finish, result, state })
    await page.screenshot({ path: `${output}/${finish}.png` })
    console.log(`Verified ${finish}`)
  }
  await seekShowroomMotion(page, 'open-doors', 1)
  await flushShowroomGpu(page)
  assert.deepEqual((await page.evaluate(bindings)).paint, baseline.paint)
  await page.screenshot({ path: `${output}/doors.png` })
  assert.deepEqual(report.errors, [])
  report.passed = true
} finally {
  await browser.close()
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2))
}

/* global crypto */
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium, expect } from '@playwright/test'
import {
  attachShowroomBridge,
  showroomState,
  selectShowroomView,
  cameraError,
  flushShowroomGpu,
  seekShowroomMotion,
} from './reventon-showroom/browser.mjs'

const output = process.env.TREES_BEVEL_OUTPUT ?? 'artifacts/car-showroom/silver-seams-r18'
const modes = ['baseline', 'finish']
const base =
  'http://127.0.0.1:5181/?product=reventon&renderPipeline=realtime&indirectLighting=ddgi&assetLoading=streaming&reventonAsset=runtime-v2&carQuality=studio&carKeyShadow=1&carShowroom=cold-studio&carFloor=cycles&carFloorLight=local&carFloorReflection=planar&carStudioFinish=wrap-wide&carStudioPaint=silver&carAntialias=msaa&carStudioTrim=satin&carCabinLight=local'
await mkdir(output, { recursive: true })
const report = { passed: false, visualPassed: false, errors: [], runs: [] }
const browser = await chromium.launch({ channel: 'msedge', headless: true })
try {
  for (const mode of modes) {
    console.log('Starting', mode)
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    page.on('pageerror', (e) => report.errors.push(e.message))
    page.on('console', (m) => {
      if (m.type() === 'error') report.errors.push(m.text())
    })
    await page.goto(base + '&carBevelStudy=' + mode)
    await expect(page.getByRole('slider', { name: '摄影棚照明', exact: true })).toBeVisible({
      timeout: 240000,
    })
    await attachShowroomBridge(page)
    await expect
      .poll(
        async () => {
          const { lighting } = await page.evaluate(showroomState)
          return (
            lighting.phase === 'ready' &&
            lighting.keyShadow?.phase === 'ready' &&
            lighting.indirectLighting.actual === 'ddgi'
          )
        },
        { timeout: 240000 },
      )
      .toBe(true)
    const geometry = await page.evaluate(async () => {
      const result = []
      window.__demo.scene.scene.value.traverse((o) => {
        if (
          o.isMesh &&
          !Array.isArray(o.material) &&
          o.material.userData.source_vpb_material_id === 20159
        )
          result.push(o)
      })
      return Promise.all(
        result.map(async (o) => {
          // Test-only CPU buffer comparison; no readback or instrumentation in production.
          const expanded = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()
          try {
            const signatures = {}
            for (const [name, attribute] of Object.entries(expanded.attributes)) {
              if (name === 'treesPaintBevel') continue
              const digest = await crypto.subtle.digest('SHA-256', attribute.array)
              signatures[name] = {
                sha256: Array.from(new Uint8Array(digest), (v) =>
                  v.toString(16).padStart(2, '0'),
                ).join(''),
                itemSize: attribute.itemSize,
                normalized: attribute.normalized,
              }
            }
            return {
              name: o.name,
              vertices: o.geometry.attributes.position.count,
              indices: o.geometry.index?.count ?? null,
              stats: o.geometry.userData.paintBevelStudy ?? null,
              signatures,
            }
          } finally {
            expanded.dispose()
          }
        }),
      )
    })
    assert.equal(geometry.length, 4)
    assert.ok(geometry.every((g) => (mode === 'baseline' ? !g.stats : g.stats?.selected > 0)))
    const shots = []
    for (const view of [
      'perspective',
      'side',
      'rear',
      'top',
      'doors',
      'cabin',
      'separated',
      'restored',
      'orange',
      'silver-restored',
    ]) {
      if (view === 'doors') await seekShowroomMotion(page, 'open-doors', 1)
      if (view === 'separated') await seekShowroomMotion(page, 'explore-parts', 0.6)
      if (view === 'restored') {
        await seekShowroomMotion(page, 'open-doors', 0)
        await seekShowroomMotion(page, 'explore-parts', 0)
      }
      if (view === 'orange' || view === 'silver-restored') {
        await page.getByRole('button', { name: '外观', exact: true }).click()
        await page
          .getByRole('button', { name: view === 'orange' ? '亮橙' : '亮银金属', exact: true })
          .click()
        await page.getByRole('button', { name: '外观', exact: true }).click()
      }
      const custom = {
        side: { position: [6, 1.55, -0.3], target: [0, 0.7, -0.3] },
        rear: { position: [-3.9, 1.7, 5.2], target: [0, 0.7, -0.3] },
        top: { position: [0, 7, -0.4], target: [0, 0.6, -0.3] },
      }[view]
      const target = await selectShowroomView(
        page,
        view === 'cabin' ? 'car-cabin' : 'perspective',
        custom,
      )
      await expect
        .poll(async () => cameraError((await page.evaluate(showroomState)).camera, target), {
          timeout: 90000,
        })
        .toBeLessThan(1e-6)
      const frame = (await page.evaluate(showroomState)).lighting.frames
      await expect
        .poll(async () => (await page.evaluate(showroomState)).lighting.frames, { timeout: 90000 })
        .toBeGreaterThan(frame + 40)
      await flushShowroomGpu(page)
      const state = await page.evaluate(showroomState)
      assert.equal(state.sameCanvas && state.sameRenderer, true)
      assert.deepEqual(state.output, [1440, 1000])
      assert.deepEqual(state.gpuErrors, [])
      assert.equal(state.showroom.revision, 18)
      const file = `${mode}-${view}.png`
      await page.screenshot({ path: `${output}/${file}` })
      shots.push({ view, file, state })
      console.log(file)
    }
    report.runs.push({ mode, url: page.url(), geometry, shots })
    await writeFile(`${output}/checkpoint.json`, JSON.stringify(report, null, 2))
    await page.close()
  }
  for (const run of report.runs.slice(1))
    for (const mesh of run.geometry) {
      const original = report.runs[0].geometry.find((g) => g.name === mesh.name)
      assert.ok(original)
      assert.deepEqual(mesh.signatures, original.signatures)
      assert.equal(mesh.indices, original.indices)
    }
  for (const run of report.runs.slice(1))
    for (let i = 0; i < report.runs[0].shots.length; i++) {
      const before = report.runs[0].shots[i].state,
        after = run.shots[i].state
      assert.deepEqual(before.camera, after.camera)
      assert.deepEqual(before.lights, after.lights)
      assert.equal(before.exposure, after.exposure)
      assert.equal(before.sha256, after.sha256)
    }
  assert.deepEqual(report.errors, [])
  report.passed = true
} finally {
  await browser.close()
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2))
}

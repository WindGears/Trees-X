import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium, expect } from '@playwright/test'
import {
  attachShowroomBridge,
  showroomState,
  selectShowroomView,
  focusShowroomPart,
  seekShowroomMotion,
  flushShowroomGpu,
  cameraError,
} from './reventon-showroom/browser.mjs'

const output = process.env.TREES_TRIM_OUTPUT ?? 'artifacts/car-showroom/trim-neutral-r11'
await mkdir(output, { recursive: true })
const report = { passed: false, visualPassed: false, errors: [], runs: [] }
function materials() {
  const root = window.__demo.scene.scene.value.children.find((n) => n.userData.workbenchProduct)
  const result = new Map()
  root.traverse((n) => {
    if (!n.isMesh) return
    for (const m of Array.isArray(n.material) ? n.material : [n.material]) {
      if (!/^Reventon \/ /.test(m.name)) continue
      result.set(m.name, {
        name: m.name,
        color: m.color?.toArray(),
        roughness: m.roughness,
        coat: m.clearcoat,
        coatRoughness: m.clearcoatRoughness,
        metalness: m.metalness,
        maps: ['map', 'normalMap', 'aoMap', 'specularIntensityMap'].map((k) => ({
          slot: k,
          present: !!m[k],
          channel: m[k]?.channel,
        })),
      })
    }
  })
  return [...result.values()].sort((a, b) => a.name.localeCompare(b.name))
}
const browser = await chromium.launch({ channel: 'msedge', headless: true })
try {
  for (const variant of ['source', 'satin']) {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
      deviceScaleFactor: 1,
    })
    page.on('pageerror', (e) => report.errors.push(e.message))
    page.on('console', (m) => {
      if (m.type() === 'error') report.errors.push(m.text())
    })
    await page.goto(
      'http://127.0.0.1:5181/?product=reventon&renderPipeline=realtime&indirectLighting=ddgi&assetLoading=streaming&reventonAsset=runtime-v2&carQuality=studio&carKeyShadow=1&carShowroom=cold-studio&carFloor=cycles&carFloorLight=local&carFloorReflection=planar&carStudioFinish=refined&carStudioPaint=graphite&carAntialias=msaa&carStudioTrim=' +
        variant,
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
    const initial = await page.evaluate(showroomState),
      entries = await page.evaluate(materials),
      shots = []
    assert.equal(initial.lighting.signals.beautySamples, 4)
    const tires = entries.filter((m) => /\/ (15411|15491)$/.test(m.name))
    const rims = entries.filter((m) => /^Reventon \/ wheel_-?1_-?1 \/ 15731$/.test(m.name))
    assert.equal(tires.length, 4)
    assert.equal(rims.length, 4)
    if (variant === 'satin') {
      tires.forEach((m) => {
        assert.equal(m.roughness, 0.68)
        assert.deepEqual(m.color, [0.012, 0.012, 0.012])
      })
      rims.forEach((m) => {
        assert.equal(m.roughness, 0.38)
        assert.equal(m.coatRoughness, 0.22)
      })
    }
    for (const shot of ['perspective', 'wheel', 'doors', 'cabin', 'separated', 'restored']) {
      if (shot === 'doors') await seekShowroomMotion(page, 'open-doors', 1)
      if (shot === 'separated') await seekShowroomMotion(page, 'explore-parts', 0.6)
      if (shot === 'restored') {
        await seekShowroomMotion(page, 'open-doors', 0)
        await seekShowroomMotion(page, 'explore-parts', 0)
      }
      const target =
        shot === 'wheel'
          ? await focusShowroomPart(page, 'wheel_1_1')
          : await selectShowroomView(page, shot === 'cabin' ? 'car-cabin' : 'perspective')
      // Reuse the semantic focus pose but remove its emissive selection overlay
      // for a material comparison. The regular focus interaction is exercised above.
      if (shot === 'wheel') await selectShowroomView(page, 'perspective', target)
      await expect
        .poll(async () => cameraError((await page.evaluate(showroomState)).camera, target), {
          timeout: 90000,
        })
        .toBeLessThan(1e-6)
      const frames = (await page.evaluate(showroomState)).lighting.frames
      await expect
        .poll(async () => (await page.evaluate(showroomState)).lighting.frames, { timeout: 90000 })
        .toBeGreaterThan(frames + 32)
      await flushShowroomGpu(page)
      const state = await page.evaluate(showroomState)
      assert.equal(state.canvases, 1)
      assert.ok(state.sameRenderer)
      assert.deepEqual(state.gpuErrors, [])
      await page.screenshot({ path: `${output}/${variant}-${shot}.png` })
      shots.push({ shot, state })
      console.log(`${variant}: ${shot}`)
    }
    assert.deepEqual(await page.evaluate(materials), entries, 'motions must not overwrite trim')
    report.runs.push({ variant, initial, materials: entries, shots })
    await page.close()
  }
  const [source, candidate] = report.runs
  const unaffected = (list) =>
    list.filter((m) => !/^Reventon \/ wheel_-?1_-?1 \/ (15411|15491|15731)$/.test(m.name))
  assert.deepEqual(unaffected(candidate.materials), unaffected(source.materials))
  assert.deepEqual(report.errors, [])
  report.passed = true
} finally {
  await browser.close()
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2))
}

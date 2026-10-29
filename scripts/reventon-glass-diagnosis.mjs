/* global window */
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium, expect } from '@playwright/test'
import { glassReflectionFootprint } from './reventon-showroom/glass-footprint.mjs'
import {
  attachShowroomBridge,
  showroomState,
  flushShowroomGpu,
} from './reventon-showroom/browser.mjs'
const output = 'artifacts/car-showroom/glass-signal-diagnosis'
await mkdir(output, { recursive: true })
const report = { passed: false, qualityPassed: false, errors: [], shots: [] }
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
    'http://127.0.0.1:5181/?product=reventon&renderPipeline=realtime&indirectLighting=ddgi&assetLoading=streaming&reventonAsset=runtime-v2&carQuality=studio&carKeyShadow=1&carShowroom=cold-studio&carFloor=cycles&carFloorLight=local&carFloorReflection=planar&carStudioPaint=graphite&carAntialias=msaa&carStudioTrim=satin&carCabinLight=local&carStudioFinish=compact',
  )
  await expect(page.getByRole('slider', { name: '摄影棚照明', exact: true })).toBeVisible({
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
  report.materials = await page.evaluate(() => {
    const root = window.__demo.scene.scene.value.children.find((n) => n.userData.workbenchProduct),
      mats = new Map(),
      meshes = []
    root.traverse((n) => {
      if (!n.isMesh) return
      const list = Array.isArray(n.material) ? n.material : [n.material]
      if (list.some((m) => /\/ (15103|21865)$/.test(m.name))) meshes.push(n)
      for (const m of list) if (/\/ (15103|21865)$/.test(m.name)) mats.set(m.uuid, m)
    })
    window.__glassAudit = { materials: [...mats.values()], meshes, restore: [] }
    return [...mats.values()].map((m) => ({
      name: m.name,
      color: m.color.toArray(),
      metalness: m.metalness,
      roughness: m.roughness,
      ior: m.ior,
      specularIntensity: m.specularIntensity,
      clearcoat: m.clearcoat,
      transmission: m.transmission,
      thickness: m.thickness,
      envMapIntensity: m.envMapIntensity,
      transparent: m.transparent,
      opacity: m.opacity,
      side: m.side,
      envName: m.envNode?.value?.name,
    }))
  })
  assert.ok(report.materials.length > 0)
  report.reflectionFootprint = await page.evaluate(glassReflectionFootprint)
  for (const mode of [
    'baseline',
    'no-ssr',
    'no-scene-environment',
    'no-glass-specular',
    'no-glass',
  ]) {
    await page.evaluate((mode) => {
      const a = window.__glassAudit
      for (const restore of a.restore) restore()
      a.restore = []
      window.__carLighting.setSignals(mode !== 'no-ssr', true, true)
      if (mode === 'no-scene-environment') {
        // r185 materialEnvIntensity reads scene.environmentIntensity when
        // envMap is null. Changing material.envMapIntensity would be a no-op.
        const scene = window.__demo.scene.scene.value
        const original = Object.getOwnPropertyDescriptor(scene, 'environmentIntensity')
        Object.defineProperty(scene, 'environmentIntensity', {
          configurable: true,
          get: () => 0,
          set: () => {},
        })
        a.restore.push(() => Object.defineProperty(scene, 'environmentIntensity', original))
      }
      if (mode === 'no-glass-specular')
        for (const m of a.materials) {
          const original = Object.getOwnPropertyDescriptor(m, 'specularIntensity')
          Object.defineProperty(m, 'specularIntensity', {
            configurable: true,
            get: () => 0,
            set: () => {},
          })
          a.restore.push(() => Object.defineProperty(m, 'specularIntensity', original))
        }
      if (mode === 'no-glass')
        for (const mesh of a.meshes) {
          const old = mesh.visible
          mesh.visible = false
          a.restore.push(() => {
            mesh.visible = old
          })
        }
    }, mode)
    const before = (await page.evaluate(showroomState)).lighting.frames
    await expect
      .poll(async () => (await page.evaluate(showroomState)).lighting.frames, { timeout: 90000 })
      .toBeGreaterThan(before + 40)
    await flushShowroomGpu(page)
    const state = await page.evaluate(showroomState)
    assert.deepEqual(state.gpuErrors, [])
    assert.equal(state.product, 'reventon')
    assert.equal(state.canvases, 1)
    assert.equal(state.sameRenderer, true)
    assert.deepEqual(state.output, [1440, 1000])
    await page.screenshot({ path: `${output}/${mode}.png` })
    const inputs = await page.evaluate(() => ({
      environment: window.__demo.scene.scene.value.environmentIntensity,
      glass: window.__glassAudit.materials.map((m) => ({
        name: m.name,
        envMap: m.envMap !== null,
        specularIntensity: m.specularIntensity,
      })),
    }))
    if (mode === 'no-scene-environment') {
      assert.equal(inputs.environment, 0)
      assert.ok(inputs.glass.every((m) => !m.envMap))
    }
    if (mode === 'no-glass-specular')
      assert.ok(inputs.glass.every((m) => m.specularIntensity === 0))
    report.shots.push({ mode, state, inputs })
    console.log(mode)
  }
  assert.deepEqual(report.errors, [])
  report.passed = true
} finally {
  await browser.close()
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2))
}

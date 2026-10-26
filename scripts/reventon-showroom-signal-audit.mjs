/* global window */
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium, expect } from '@playwright/test'
import {
  attachShowroomBridge,
  showroomState,
  flushShowroomGpu,
} from './reventon-showroom/browser.mjs'

const output = process.env.TREES_SIGNAL_OUTPUT ?? 'artifacts/car-showroom/signal-audit-r11-ready'
await mkdir(output, { recursive: true })
const report = { passed: false, errors: [], samples: [] }
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
    'http://127.0.0.1:5181/?product=reventon&renderPipeline=realtime&indirectLighting=ddgi&assetLoading=streaming&reventonAsset=runtime-v2&carQuality=studio&carKeyShadow=1&carShowroom=cold-studio&carFloor=cycles&carFloorLight=local&carFloorReflection=planar&carStudioFinish=refined',
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
  report.materials = await page.evaluate(() => {
    const root = window.__demo.scene.scene.value.children.find(
      (node) => node.userData.workbenchProduct,
    )
    const entries = new Map()
    root.traverse((object) => {
      if (!object.isMesh) return
      for (const m of Array.isArray(object.material) ? object.material : [object.material]) {
        if (entries.has(m.uuid)) continue
        entries.set(m.uuid, {
          name: m.name,
          type: m.type,
          color: m.color?.toArray(),
          roughness: m.roughness,
          metalness: m.metalness,
          coat: m.clearcoat,
          coatRoughness: m.clearcoatRoughness,
          specular: m.specularIntensity,
          environment: m.envMapIntensity,
          maps: ['map', 'roughnessMap', 'metalnessMap', 'normalMap'].map((key) => ({
            key,
            name: m[key]?.name,
            colorSpace: m[key]?.colorSpace,
          })),
        })
      }
    })
    return [...entries.values()]
  })
  const materialOnly = process.env.TREES_SIGNAL_MATERIALS === '1'
  for (const [name, ssr, gi] of materialOnly
    ? []
    : [
        ['full', true, true],
        ['native', false, false],
        ['gi-only', false, true],
        ['ssr-only', true, false],
      ]) {
    const before = (await page.evaluate(showroomState)).lighting.frames
    await page.evaluate(([s, g]) => window.__carLighting.setSignals(s, g, true), [ssr, gi])
    await expect
      .poll(async () => (await page.evaluate(showroomState)).lighting.frames, { timeout: 90000 })
      .toBeGreaterThan(before + 64)
    await flushShowroomGpu(page)
    const state = await page.evaluate(showroomState)
    assert.equal(state.canvases, 1)
    assert.deepEqual(state.gpuErrors, [])
    report.samples.push({ name, state })
    await page.screenshot({ path: `${output}/${name}.png` })
    console.log(`Captured ${name}`)
  }
  await page.evaluate(() => {
    window.__carLighting.setSignals(false, false, true)
    const root = window.__demo.scene.scene.value.children.find(
      (node) => node.userData.workbenchProduct,
    )
    const materials = new Set(),
      lights = []
    root.traverse((object) => {
      if (!object.isMesh) return
      for (let m of Array.isArray(object.material) ? object.material : [object.material]) {
        while (m && !materials.has(m)) {
          materials.add(m)
          m = m.source
        }
      }
    })
    window.__demo.scene.scene.value.traverse((object) => {
      if (object.isLight) lights.push([object, object.intensity])
    })
    window.__auditOriginals = {
      lights,
      environment: window.__demo.scene.scene.value.environmentIntensity,
      materials: [...materials].map((m) => [m, m.envMapIntensity, m.color?.clone(), m.roughness]),
    }
  })
  for (const mode of materialOnly
    ? ['baseline', 'paint-mid', 'paint-satin', 'semantic-ids']
    : ['no-direct', 'no-environment', 'graphite-mid', 'graphite-satin']) {
    const before = (await page.evaluate(showroomState)).lighting.frames
    await page.evaluate((mode) => {
      // r185 scene.environmentIntensity is used when envMap is null; per-material
      // envMapIntensity alone cannot isolate this scene-local environment hook.
      window.__demo.scene.scene.value.environmentIntensity =
        mode === 'no-environment' ? 0 : window.__auditOriginals.environment
      for (const [light, intensity] of window.__auditOriginals.lights)
        light.intensity = mode === 'no-direct' ? 0 : intensity
      for (const [m, environment, color, roughness] of window.__auditOriginals.materials) {
        m.envMapIntensity = mode === 'no-environment' ? 0 : environment
        if (color) m.color.copy(color)
        m.roughness = roughness
        if (/\/ 15023$/.test(m.name) && mode.startsWith('graphite')) {
          m.color.set('#55585b')
          if (mode === 'graphite-satin') m.roughness = 0.48
        }
        if (/\/ 20159$/.test(m.name) && mode.startsWith('paint')) {
          m.color.set('#55585b')
          if (mode === 'paint-satin') m.roughness = 0.4
        }
        if (mode === 'semantic-ids' && m.emissive) {
          m.emissive.set(
            /\/ 15023$/.test(m.name) ? '#ff0000' : /\/ 20159$/.test(m.name) ? '#00ff00' : '#000000',
          )
          m.emissiveIntensity = 1
        }
      }
    }, mode)
    await expect
      .poll(async () => (await page.evaluate(showroomState)).lighting.frames, { timeout: 90000 })
      .toBeGreaterThan(before + 32)
    await flushShowroomGpu(page)
    report.samples.push({ name: mode, state: await page.evaluate(showroomState) })
    await page.screenshot({ path: `${output}/${mode}.png` })
    console.log(`Captured ${mode}`)
  }
  assert.deepEqual(report.errors, [])
  report.passed = true
} finally {
  await browser.close()
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2))
}

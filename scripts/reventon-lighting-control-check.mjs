import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium, expect } from '@playwright/test'
import {
  attachShowroomBridge,
  showroomState,
  seekShowroomMotion,
  flushShowroomGpu,
} from './reventon-showroom/browser.mjs'

const output =
  process.env.TREES_LIGHTING_OUTPUT ?? 'artifacts/car-showroom/lighting-control-verified'
await mkdir(output, { recursive: true })
const report = { passed: false, visualPassed: false, errors: [], shots: [], layouts: [] }
const browser = await chromium.launch({ channel: 'msedge', headless: true })
let page
try {
  page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
  })
  page.on('pageerror', (e) => report.errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') report.errors.push(m.text())
  })
  await page.goto(
    'http://127.0.0.1:5181/?product=reventon&renderPipeline=realtime&indirectLighting=ddgi&assetLoading=streaming&reventonAsset=runtime-v2&carQuality=studio&carKeyShadow=1&carShowroom=cold-studio&carFloor=cycles&carFloorLight=local&carFloorReflection=planar&carStudioFinish=refined&carStudioPaint=graphite&carAntialias=msaa&carStudioTrim=satin&carCabinLight=local',
  )
  const lighting = page.getByRole('slider', { name: '摄影棚照明', exact: true })
  await expect(lighting).toBeVisible({ timeout: 240000 })
  await attachShowroomBridge(page)
  const settle = async (gain) => {
    await expect
      .poll(
        async () => {
          const s = await page.evaluate(showroomState),
            gi = s.lighting.indirectLighting
          return (
            s.lighting.phase === 'ready' &&
            s.lighting.keyShadow?.phase === 'ready' &&
            gi.actual === 'ddgi' &&
            gi.details?.environment?.intensity === gain &&
            gi.details?.scheduling?.cached === true
          )
        },
        { timeout: 240000 },
      )
      .toBe(true)
    const frames = (await page.evaluate(showroomState)).lighting.frames
    await expect
      .poll(async () => (await page.evaluate(showroomState)).lighting.frames, { timeout: 20000 })
      .toBeGreaterThan(frames + 32)
    await flushShowroomGpu(page)
  }
  await settle(1)
  const baseline = await page.evaluate(showroomState)
  const panels = () =>
    page.evaluate(() => {
      const result = []
      window.__demo.scene.scene.value.traverse((n) => {
        if (n.userData.showroomLightId)
          result.push({ id: n.userData.showroomLightId, color: n.material.color.toArray() })
      })
      return result.sort((a, b) => a.id.localeCompare(b.id))
    })
  const initialPanels = await panels()
  assert.equal(initialPanels.length, 4)
  for (const [name, gain, doors] of [
    ['baseline', 1, 0],
    ['dim', 0.65, 0],
    ['bright', 1.5, 0],
    ['bright-doors', 1.5, 1],
    ['reset', 1, 0],
  ]) {
    await lighting.evaluate((input, value) => {
      input.value = String(value)
      input.dispatchEvent(new Event('change', { bubbles: true }))
    }, gain)
    await seekShowroomMotion(page, 'open-doors', doors)
    await settle(gain)
    const state = await page.evaluate(showroomState),
      visiblePanels = await panels()
    assert.equal(state.showroom.lightingBrightness, gain)
    assert.equal(state.environmentIntensity, gain)
    assert.equal(state.exposure, baseline.exposure)
    assert.equal(state.environment, baseline.environment)
    assert.deepEqual(state.showroom.probe, baseline.showroom.probe)
    assert.equal(state.sameRenderer && state.sameCanvas, true)
    assert.equal(state.canvases, 1)
    for (const [i, entry] of state.lights.entries())
      assert.ok(Math.abs(entry.intensity - baseline.lights[i].intensity * gain) < 1e-9)
    for (const [i, entry] of visiblePanels.entries())
      entry.color.forEach((value, c) =>
        assert.ok(Math.abs(value - initialPanels[i].color[c] * gain) < 1e-8),
      )
    assert.deepEqual(state.gpuErrors, [])
    await page.screenshot({ path: `${output}/${name}.png` })
    report.shots.push({ name, gain, state })
    console.log(name)
  }
  // The appearance-only trim remains independent of actual illumination.
  await page.getByText('仅调整灯板外观', { exact: true }).click()
  await page.getByRole('slider', { name: '灯板亮度 · 调试' }).evaluate((input) => {
    input.value = '0.5'
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  assert.equal((await page.evaluate(showroomState)).environmentIntensity, 1)
  await page.getByRole('slider', { name: '灯板亮度 · 调试' }).evaluate((input) => {
    input.value = '1'
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await page.getByText('仅调整灯板外观', { exact: true }).click()
  for (const [width, height] of [
    [1280, 720],
    [1920, 1080],
    [390, 844],
    [320, 740],
  ]) {
    await page.setViewportSize({ width, height })
    await expect(lighting).toBeVisible()
    await settle(1)
    const box = await page.locator('.wb-showroom-debug').boundingBox()
    assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= width)
    await page.screenshot({ path: `${output}/layout-${width}.png` })
    report.layouts.push({ width, height, box, state: await page.evaluate(showroomState) })
    console.log('layout', width)
  }
  assert.deepEqual(report.errors, [])
  report.passed = true
} catch (error) {
  report.failure = String(error)
  if (page) {
    report.failureState = await page.evaluate(showroomState).catch(() => null)
    await page.screenshot({ path: `${output}/failure.png` }).catch(() => {})
  }
  throw error
} finally {
  await browser.close()
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2))
  await writeFile(
    `${output}/index.html`,
    `<!doctype html><meta charset="utf-8"><title>摄影棚联动照明对照</title><style>body{background:#181a1c;color:#eee;font:16px system-ui;margin:24px}img{max-width:100%}section{margin:32px 0}a{color:#ddd}</style><h1>摄影棚联动照明</h1><p>同一资产、灯位、曝光、镜头。统一缩放光源与环境，未重新捕获；不代表整体画质已通过。</p>${report.shots.map((s) => `<section><h2>${s.name} · ${s.gain * 100}%</h2><img src="${s.name}.png"></section>`).join('')}`,
  )
}

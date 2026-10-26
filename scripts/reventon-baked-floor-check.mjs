/* global URL */
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium, expect } from '@playwright/test'
import { showroomUrl } from './reventon-showroom/model.mjs'
import { inspectCarReflection } from './reventon-showroom/floor-reflection.mjs'
import {
  attachShowroomBridge,
  showroomState,
  selectShowroomView,
  seekShowroomMotion,
  flushShowroomGpu,
} from './reventon-showroom/browser.mjs'

const output = process.env.TREES_FLOOR_OUTPUT ?? 'artifacts/car-showroom/baked-floor'
await mkdir(output, { recursive: true })
const report = {
  passed: false,
  errors: [],
  warnings: [],
  runs: [],
  limitations: [
    'Baked is persisted raster radiance; cycles is offline path-traced room radiance. Neither is a floor lightmap.',
    'No baked car reflection. No displayed FPS measurement. Default remains unchanged.',
  ],
}
let browser, activePage
try {
  const variants = process.env.TREES_FLOOR_VARIANTS?.split(',') ?? ['baseline', 'baked']
  assert.ok(
    variants.every((variant) =>
      ['baseline', 'baked', 'cycles', 'cycles-local', 'cycles-planar'].includes(variant),
    ),
  )
  for (const variant of variants) {
    browser = await chromium.launch({ channel: 'msedge', headless: true })
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      deviceScaleFactor: 1,
    })
    const page = await context.newPage()
    activePage = page
    const requests = []
    page.on('pageerror', (error) => report.errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') report.errors.push(message.text())
      if (message.type() === 'warning') report.warnings.push(message.text())
    })
    page.on('request', (request) => {
      if (/\/(baked|cycles)-r(10|11)\//.test(request.url())) requests.push(request.url())
    })
    page.on('requestfailed', (request) =>
      report.errors.push({ url: request.url(), failure: request.failure() }),
    )
    const url = new URL(showroomUrl('http://127.0.0.1:5181', 'showroom'))
    if (variant !== 'baseline')
      url.searchParams.set('carFloor', variant.startsWith('cycles') ? 'cycles' : variant)
    if (['cycles-local', 'cycles-planar'].includes(variant))
      url.searchParams.set('carFloorLight', 'local')
    if (variant === 'cycles-planar') url.searchParams.set('carFloorReflection', 'planar')
    if (process.env.TREES_STUDIO_FINISH === 'refined')
      url.searchParams.set('carStudioFinish', 'refined')
    if (process.env.TREES_STUDIO_PAINT === 'graphite')
      url.searchParams.set('carStudioPaint', 'graphite')
    if (process.env.TREES_CAR_MSAA === '1') url.searchParams.set('carAntialias', 'msaa')
    await page.goto(url.href, { waitUntil: 'domcontentloaded' })
    console.log(`Opened ${variant}`)
    await expect
      .poll(
        async () => {
          const fallback = report.warnings.find((message) =>
            message.includes('cold studio fallback'),
          )
          return (
            report.errors.length > 0 ||
            Boolean(fallback) ||
            page.getByRole('slider', { name: '灯板亮度 · 调试' }).isVisible()
          )
        },
        { timeout: 240000 },
      )
      .toBe(true)
    assert.deepEqual(report.errors, [], 'Browser/network error')
    assert.ok(
      !report.warnings.some((message) => message.includes('cold studio fallback')),
      report.warnings.join('\n'),
    )
    await attachShowroomBridge(page)
    console.log(`Loaded ${variant}`)
    await expect
      .poll(
        async () => {
          const s = await page.evaluate(showroomState)
          report.lastState = s
          assert.equal(s.showroom.error, null)
          return (
            s.lighting.phase === 'ready' &&
            s.lighting.indirectLighting.actual === 'ddgi' &&
            s.lighting.keyShadow?.phase === 'ready'
          )
        },
        { timeout: 240000 },
      )
      .toBe(true)
    const initial = await page.evaluate(showroomState)
    if (process.env.TREES_CAR_MSAA === '1') {
      assert.equal(initial.lighting.signals.beautySamples, 4)
      assert.equal(initial.lighting.signals.surfaceSamples, 0)
    }
    assert.equal(initial.showroom.probe.totalFaceDraws, variant === 'baseline' ? 12 : 0)
    assert.equal(requests.length, variant === 'baseline' ? 0 : 2)
    const floor = await page.evaluate(() => {
      const mesh = window.__demo.scene.scene.value.getObjectByName('Trees X / cold studio floor')
      return {
        baked: mesh.userData.bakedFloorReflection === true,
        hasEnvironment: !!mesh.material.envNode,
        materialType: mesh.material.type,
        roughness: mesh.material.roughness,
      }
    })
    assert.equal(floor.baked, variant !== 'baseline')
    if (variant.startsWith('cycles')) {
      assert.equal(
        initial.showroom.probe.source,
        process.env.TREES_STUDIO_FINISH === 'refined' ? 'cycles-r11' : 'cycles-r10',
      )
      assert.equal(
        await page.evaluate(
          () => window.__demo.scene.scene.value.environment.image.data.constructor.name,
        ),
        'Uint16Array',
      )
      if (['cycles-local', 'cycles-planar'].includes(variant))
        assert.equal(initial.showroom.floorLight, 'local-area+indirect-probe')
      if (variant === 'cycles-planar')
        assert.equal(initial.showroom.floorReflection, 'cycles-room-probe+dynamic-car-planar')
    }
    const shots = []
    const reflectionChecks = []
    const inspectReflection = async (label) => {
      if (variant !== 'cycles-planar') return
      const value = await page.evaluate(inspectCarReflection)
      assert.equal(value.width, 1440)
      assert.equal(value.height, 1000)
      assert.equal(value.invalid, 0)
      assert.ok(value.coverage > 1000 && value.transparent > 1000)
      assert.ok(value.checked > 10 && value.projectionError < 1e-6)
      reflectionChecks.push({ label, ...value })
    }
    for (const view of ['perspective', 'side', 'rear']) {
      await selectShowroomView(page, view)
      await page.waitForTimeout(1800)
      await flushShowroomGpu(page)
      await page.screenshot({ path: `${output}/${variant}-${view}.png` })
      shots.push(await page.evaluate(showroomState))
      await inspectReflection(view)
    }
    await seekShowroomMotion(page, 'open-doors', 1)
    await selectShowroomView(page, 'perspective')
    await page.waitForTimeout(1800)
    await flushShowroomGpu(page)
    await page.screenshot({ path: `${output}/${variant}-doors.png` })
    await inspectReflection('doors')
    await seekShowroomMotion(page, 'explore-parts', 0.6)
    await flushShowroomGpu(page)
    await page.screenshot({ path: `${output}/${variant}-separated.png` })
    await inspectReflection('separated')
    await seekShowroomMotion(page, 'open-doors', 0)
    await seekShowroomMotion(page, 'explore-parts', 0)
    if (variant === 'cycles-planar') {
      await page.getByRole('button', { name: '外观', exact: true }).click()
      await page.waitForTimeout(1200)
      await inspectReflection('right-panel')
      await page.screenshot({ path: `${output}/${variant}-panel.png` })
      await page.getByRole('button', { name: '外观', exact: true }).click()
      await page.getByRole('button', { name: '商品目录', exact: true }).click()
      await page.waitForTimeout(1200)
      await inspectReflection('catalog')
      await page.screenshot({ path: `${output}/${variant}-catalog.png` })
      assert.ok(new Set(reflectionChecks.map((entry) => entry.spatialMoment)).size > 3)
    }
    const final = await page.evaluate(showroomState)
    assert.equal(final.canvases, 1)
    assert.ok(final.sameRenderer && final.sameCanvas)
    assert.deepEqual(
      final.showroom.probe,
      initial.showroom.probe,
      'No recapture during observation/actions',
    )
    assert.deepEqual(await page.evaluate(() => window.__carShowroomErrors), [])
    report.runs.push({
      variant,
      url: url.href,
      initial,
      final,
      floor,
      requests,
      shots,
      reflectionChecks,
    })
    await context.close()
    await browser.close()
    browser = undefined
  }
  assert.deepEqual(report.errors, [])
  report.passed = true
} catch (error) {
  report.failure = error.stack
  if (activePage && !activePage.isClosed()) {
    report.pageText = await activePage
      .locator('body')
      .innerText()
      .catch(() => '')
    await activePage.screenshot({ path: `${output}/failure.png` }).catch(() => {})
  }
} finally {
  await browser?.close()
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2))
}
console.log(JSON.stringify({ passed: report.passed, failure: report.failure, output }))
if (!report.passed) process.exitCode = 1

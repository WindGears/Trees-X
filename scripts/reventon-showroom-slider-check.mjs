import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium, expect } from '@playwright/test'
import { showroomUrl } from './reventon-showroom/model.mjs'
import { attachShowroomBridge, showroomState } from './reventon-showroom/browser.mjs'

const output = 'artifacts/car-showroom/brightness-slider'
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 1,
})
const report = { passed: false, errors: [], sizes: [], states: [] }
page.on('pageerror', (error) => report.errors.push(error.message))
page.on('console', (message) => {
  if (message.type() === 'error') report.errors.push(message.text())
})
const panels = () =>
  page.evaluate(() => {
    const values = []
    window.__demo.scene.scene.value.traverse((node) => {
      if (node.userData.showroomLightId)
        values.push({
          id: node.userData.showroomLightId,
          color: node.material.color.toArray(),
          source: node.userData.traceMaterial.color.toArray(),
        })
    })
    return values
  })
try {
  await page.goto(showroomUrl('http://127.0.0.1:5181', 'showroom'), {
    waitUntil: 'domcontentloaded',
  })
  const slider = page.getByRole('slider', { name: '灯板亮度 · 调试' })
  await expect(slider).toBeVisible({ timeout: 240000 })
  await attachShowroomBridge(page)
  await expect
    .poll(async () => (await page.evaluate(showroomState)).lighting.phase, { timeout: 240000 })
    .toBe('ready')
  const initial = await panels(),
    initialState = await page.evaluate(showroomState)
  assert.equal(initial.length, 4)
  await slider.focus()
  await slider.press('Home')
  await expect(slider).toHaveValue('0')
  const dark = await panels()
  assert.ok(dark.every((panel) => panel.color.every((value) => value === 0)))
  assert.deepEqual(
    dark.map((panel) => panel.source),
    initial.map((panel) => panel.source),
  )
  await page.screenshot({ path: output + '/zero.png' })
  await slider.press('End')
  await expect(slider).toHaveValue('3')
  const bright = await panels()
  bright.forEach((panel, index) =>
    panel.color.forEach((value, channel) =>
      assert.ok(Math.abs(value - initial[index].color[channel] * 3) < 1e-9),
    ),
  )
  assert.deepEqual(
    bright.map((panel) => panel.source),
    initial.map((panel) => panel.source),
  )
  await slider.press('ArrowLeft')
  await expect(slider).toHaveValue('2.95')
  await page.getByRole('button', { name: '复原', exact: true }).click()
  await expect(slider).toHaveValue('1')
  const final = await page.evaluate(showroomState)
  assert.deepEqual(final.camera, initialState.camera, 'Slider keyboard must not move the camera')
  assert.deepEqual(final.environment, initialState.environment)
  assert.deepEqual(final.showroom.probe, initialState.showroom.probe, 'No recapture during drag')
  report.states = [initial, dark, bright]
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 })
    await expect(slider).toBeVisible()
    await expect(page.locator('canvas')).toHaveCount(1)
    const rect = await page.locator('.wb-showroom-debug').boundingBox()
    assert.ok(rect.x >= 0 && rect.x + rect.width <= width + 1)
    assert.ok(rect.y >= 0 && rect.y + rect.height <= (width === 1440 ? 1000 : 844))
    await page.screenshot({ path: `${output}/${width}.png` })
    report.sizes.push({ width, rect })
  }
  assert.deepEqual(report.errors, [])
  report.passed = true
} catch (error) {
  report.failure = error.stack
  await page.screenshot({ path: output + '/failure.png' }).catch(() => {})
} finally {
  await browser.close()
  await writeFile(output + '/report.json', JSON.stringify(report, null, 2))
}
console.log(JSON.stringify({ passed: report.passed, failure: report.failure, output }))
if (!report.passed) process.exitCode = 1

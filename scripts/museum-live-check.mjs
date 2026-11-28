/* global performance */
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium, expect } from '@playwright/test'
import { bridge } from './demo/browser-check.mjs'

const output = process.env.MUSEUM_OUTPUT ?? 'artifacts/museum/typewriter'
const base = process.env.CHECK_URL ?? 'http://127.0.0.1:5181'
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 1,
  recordVideo: { dir: `${output}/video`, size: { width: 1440, height: 1000 } },
})
const page = await context.newPage()
page.setDefaultTimeout(30000)
const report = { passed: false, errors: [], sizes: [], identity: null }
page.on('pageerror', (error) => report.errors.push(error.message))
const button = (name) => page.getByRole('button', { name, exact: true })
async function shot(name) {
  await page.screenshot({ path: `${output}/${name}.png` })
}
async function settled(id, value) {
  await expect
    .poll(
      () =>
        page.evaluate(
          ({ id, value }) => {
            const state = window.__demo.motion.states.value[id]
            return Boolean(state && !state.playing && Math.abs(state.progress - value) < 0.001)
          },
          { id, value },
        ),
      { timeout: 30000 },
    )
    .toBe(true)
}
try {
  await page.goto(`${base}/?gallery=next`)
  await expect(button('开始互动')).toBeVisible()
  await expect(page.locator('canvas')).toHaveCount(0)
  await shot('cover-1440')
  const start = performance.now()
  await button('开始互动').click()
  await expect(page.locator('.wb-stage')).toHaveAttribute('data-scene-status', 'ready', {
    timeout: 180000,
  })
  report.firstFrameMs = performance.now() - start
  await bridge(page, true)
  report.identity = await page.evaluate(() => {
    const { scene, renderer } = window.__demo
    return {
      backend: renderer.backend?.isWebGPUBackend ? 'webgpu' : 'other',
      size: [renderer.domElement.width, renderer.domElement.height],
      roots: scene.scene.value.children
        .filter((node) => node.userData.workbenchProduct)
        .map((node) => node.userData.workbenchProduct),
    }
  })
  assert.equal(report.identity.backend, 'webgpu')
  await expect(page.locator('.wb-stage-status')).toHaveCount(0, { timeout: 15000 })
  await shot('whole-1440')
  await button('分层').click()
  await settled('explore-layout', 0.6)
  await shot('layers-1440')
  await button('部件').click()
  await page.getByRole('textbox', { name: '查找部件' }).fill('字杆')
  await page.locator('.museum-option-list button').first().click()
  await expect(page.locator('.museum-inspector h2')).toContainText('字杆')
  await page.waitForTimeout(900)
  await shot('part-1440')
  const camera = () =>
    page.evaluate(() => window.__demo.scene.camera.activeCamera.value.position.toArray())
  const before = await camera()
  await button('关闭检查面板').click()
  expect(await camera()).toEqual(before)
  await expect(button('部件')).toBeFocused()
  await button('视角').click()
  await expect(button('关闭检查面板')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.locator('.museum-inspector')).toHaveCount(0)
  await expect(button('视角')).toBeFocused()
  await settled('explore-layout', 0.6)
  await button('分层').click()
  await page.getByRole('button', { name: /[敲击发]+ A 键/ }).click()
  await button('平铺').click()
  await settled('explore-layout', 1)
  await shot('flat-1440')
  await page.evaluate(() => {
    const renderer = window.__demo.renderer
    const original = renderer.render
    window.__museumFrames = 0
    renderer.render = function (...args) {
      window.__museumFrames++
      return original.apply(this, args)
    }
  })
  await button('展品库').click()
  await expect(page.getByRole('dialog')).toHaveCSS('opacity', '1')
  await page.waitForTimeout(350)
  const count = await page.evaluate(() => window.__museumFrames)
  await page.waitForTimeout(400)
  assert.equal(await page.evaluate(() => window.__museumFrames), count, 'Library must stop drawing')
  await shot('library-1440')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await settled('explore-layout', 1)
  await button('整机').click()
  await settled('explore-layout', 0)
  for (const size of [
    { width: 1280, height: 720 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(size)
    await page.waitForTimeout(2000)
    await shot(`whole-${size.width}`)
    const dock = await page.locator('.museum-dock').boundingBox()
    const tools = await page.locator('.museum-tools').boundingBox()
    assert.ok(dock.x + dock.width < tools.x, 'Controls overlap')
    report.sizes.push(size)
  }
  assert.deepEqual(report.errors, [])
  await expect(page.locator('canvas')).toHaveCount(1)
  report.passed = true
} catch (error) {
  report.debug = await page
    .evaluate(() => ({
      status: document.querySelector('.wb-stage-status')?.outerHTML,
      motion: window.__demo?.motion.states.value,
      hidden: document.hidden,
    }))
    .catch(() => null)
  report.failure = String(error.stack ?? error)
  await shot('failure').catch(() => {})
  throw error
} finally {
  await context.close()
  await browser.close()
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2))
}
console.log(JSON.stringify(report, null, 2))

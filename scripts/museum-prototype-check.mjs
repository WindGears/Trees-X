import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium, expect } from '@playwright/test'

const output = 'artifacts/museum/prototype'
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const report = { passed: false, sizes: [], errors: [], resources: [] }
try {
  const page = await browser.newPage()
  page.on('pageerror', (error) => report.errors.push(error.message))
  page.on('request', (request) => {
    if (/\.(?:glb|hdr|ktx2|exr|wasm)(?:\?|$)/.test(request.url()))
      report.resources.push(request.url())
  })
  for (const size of [
    { width: 1280, height: 720 },
    { width: 1440, height: 1000 },
  ]) {
    await page.setViewportSize(size)
    await page.goto('http://127.0.0.1:5181/?galleryPrototype=1')
    await expect(page.getByRole('button', { name: '开始互动', exact: true })).toBeVisible()
    await expect(page.locator('.museum-poster')).toHaveJSProperty('complete', true)
    await page.screenshot({ path: `${output}/cover-${size.width}.png` })
    await page.getByRole('button', { name: '开始互动', exact: true }).click()
    await page.getByRole('button', { name: '分层', exact: true }).click()
    await page.getByRole('button', { name: '部件', exact: true }).click()
    await page.getByRole('button', { name: '字杆', exact: true }).click()
    await page.screenshot({ path: `${output}/parts-${size.width}.png` })
    const dock = await page.locator('.museum-dock').boundingBox()
    const tools = await page.locator('.museum-tools').boundingBox()
    assert.ok(dock.x + dock.width + 12 < tools.x, 'Chapter dock must not overlap tools')
    await page.getByRole('button', { name: '展品库', exact: true }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCSS('opacity', '1')
    await page.screenshot({ path: `${output}/library-${size.width}.png` })
    await page.getByRole('textbox', { name: '搜索展品名称', exact: true }).fill('汽车')
    await expect(page.locator('.museum-card')).toHaveCount(1)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByRole('button', { name: '展品库', exact: true })).toBeFocused()
    await page.getByRole('button', { name: '展品库', exact: true }).click()
    await expect(page.getByRole('textbox', { name: '搜索展品名称', exact: true })).toHaveValue(
      '汽车',
    )
    report.sizes.push(size)
  }
  assert.equal(report.errors.length, 0)
  assert.equal(report.resources.length, 0)
  await expect(page.locator('canvas')).toHaveCount(0)
  report.passed = true
} finally {
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2))
  await browser.close()
}
console.log(JSON.stringify(report, null, 2))

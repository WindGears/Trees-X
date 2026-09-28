import { chromium, expect } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { assertStablePixels } from './pixel-stability.mjs'
const base = process.env.CHECK_URL || 'http://127.0.0.1:5180'
const output = '.impeccable/review/speaker-film'
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const report = { errors: [], results: [] }
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.on('pageerror', (error) => report.errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') report.errors.push(message.text())
  })
  await page.goto(base)
  const studio = page.locator('.product-studio')
  const button = (name) => page.getByRole('button', { name, exact: true })
  const start = page.getByRole('button', { name: /观看演绎/ })
  await expect(start).toBeEnabled({ timeout: 40000 })
  await expect(page.locator('.product-viewer')).toHaveAttribute('data-intro-state', 'stable')
  await page.waitForTimeout(2600)
  await page.evaluate(() => {
    window.__canvas = document.querySelector('canvas')
  })
  await page.screenshot({ path: `${output}/hero-1440.png` })
  await start.click()
  await expect(studio).toHaveAttribute('data-film', 'detail')
  await page.waitForTimeout(1400)
  await page.screenshot({ path: `${output}/detail.png` })
  await expect(studio).toHaveAttribute('data-film', 'hero')
  await page.waitForTimeout(1000)
  await page.screenshot({ path: `${output}/reveal.png` })
  await expect(studio).toHaveAttribute('data-film', 'layers')
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${output}/layers.png` })
  await expect(studio).toHaveAttribute('data-film', 'complete', { timeout: 10000 })
  await expect(studio).toHaveAttribute('data-film-playing', 'false')
  report.results.push('three authored shots complete; assembled handoff')
  await start.click()
  await page.waitForTimeout(1450)
  await button('接手探索').click()
  await expect(studio).toHaveAttribute('data-film-playing', 'false')
  const stableStyle = '.model-hotspot,.film-help {visibility:hidden!important}'
  const before = await page.locator('canvas').screenshot({ style: stableStyle })
  await page.waitForTimeout(600)
  const after = await page.locator('canvas').screenshot({ style: stableStyle })
  report.handoffPixels = await assertStablePixels(
    page,
    before,
    after,
    'interrupted macro camera remains still',
  )
  await button('正面').click()
  await start.click()
  await page.waitForTimeout(450)
  await page.keyboard.press('Escape')
  await expect(studio).toHaveAttribute('data-film-playing', 'false')
  await start.click()
  const box = await page.locator('canvas').boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 25, { steps: 10 })
  await page.mouse.up()
  await expect(studio).toHaveAttribute('data-film-playing', 'false')
  report.results.push('macro handoff, Escape and pointer interruption')
  await button('外观').click()
  await button('石墨').click()
  await button('收起面板').click()
  await start.click()
  await expect(studio).toHaveAttribute('data-film', 'complete', { timeout: 12000 })
  await button('外观').click()
  await expect(button('石墨')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.studio-console')).toHaveCSS('opacity', '1')
  await page.screenshot({ path: `${output}/appearance.png` })
  await button('收起面板').click()
  await start.click()
  await button('商品目录 07').click()
  await expect(studio).toHaveAttribute('data-film-playing', 'false')
  await page.keyboard.press('Escape')
  expect(await page.evaluate(() => window.__canvas === document.querySelector('canvas'))).toBe(true)
  report.results.push('finish preserved; catalog interrupts; same canvas')
  await start.click()
  await button('手势').click()
  await expect(studio).toHaveAttribute('data-film-playing', 'false')
  await button('收起面板').click()
  await start.click()
  await button('下一件商品').click()
  await expect(studio).toHaveAttribute('data-film', 'idle')
  await expect(button('正面')).toBeEnabled({ timeout: 30000 })
  await button('上一件商品').click()
  await expect(start).toBeEnabled({ timeout: 30000 })
  expect(await page.evaluate(() => window.__canvas === document.querySelector('canvas'))).toBe(true)
  report.results.push('gesture entry and product switch interrupt without remounting canvas')
  await page.close()
  for (const [width, height, motion] of [
    [1280, 720, 'no-preference'],
    [1920, 1080, 'no-preference'],
    [390, 844, 'reduce'],
    [320, 740, 'reduce'],
  ]) {
    const layout = await browser.newPage({ viewport: { width, height }, reducedMotion: motion })
    layout.on('pageerror', (error) => report.errors.push(error.message))
    await layout.goto(base)
    await expect(layout.getByRole('button', { name: '正面', exact: true })).toBeEnabled({
      timeout: 40000,
    })
    await layout.waitForTimeout(2800)
    expect(await layout.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    )
    if (motion === 'reduce') {
      await layout.getByRole('button', { name: '静态欣赏', exact: true }).click()
      await expect(layout.locator('.product-studio')).toHaveAttribute('data-film', 'complete')
      await expect(layout.locator('.product-studio')).toHaveAttribute('data-film-playing', 'false')
    }
    await layout.screenshot({ path: `${output}/layout-${width}.png`, fullPage: true })
    await layout.close()
  }
  expect(report.errors).toEqual([])
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} finally {
  await browser.close()
}

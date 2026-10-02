/* global location */
import { chromium, expect } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'

const base = process.env.CHECK_URL || 'http://127.0.0.1:5182'
const output = '.impeccable/review/workbench/production.json'
await mkdir('.impeccable/review/workbench', { recursive: true })
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const report = { errors: [], products: [], passed: false }
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce',
  })
  page.on('pageerror', (e) => report.errors.push(e.message))
  for (const [slug, name] of [
    ['form-01', '桌面音箱'],
    ['typewriter-study', '机械打字机'],
    ['reventon', '汽车样板'],
  ]) {
    await page.goto(`${base}/?product=${slug}`)
    await expect(page.locator('.workbench')).toHaveAttribute('data-status', 'ready', {
      timeout: 30000,
    })
    await expect(page.locator('h1')).toHaveText(name)
    await page.getByRole('button', { name: '外观', exact: true }).click()
    const canvas = page.locator('canvas')
    const pixels = () =>
      canvas.screenshot({
        style: '.wb-hotspots,.wb-intro,.wb-tools,.wb-input-hint{visibility:hidden!important}',
      })
    const originalColor = await pixels()
    await page.locator('.wb-finishes button').nth(1).click()
    expect((await pixels()).equals(originalColor), 'finish must alter real canvas pixels').toBe(
      false,
    )
    await page.getByRole('button', { name: '结构与动作', exact: true }).click()
    const before = await pixels()
    await page.getByRole('button', { name: '展开部件', exact: true }).click()
    const expanded = await pixels()
    expect(expanded.equals(before), 'structure must alter actual production canvas pixels').toBe(
      false,
    )
    await page.locator('.wb-action-list button').first().click()
    await page.getByRole('button', { name: '还原商品', exact: true }).click()
    await page.getByRole('button', { name: '导览', exact: true }).click()
    await page.getByRole('button', { name: '开始导览' }).click()
    for (let i = 0; i < 3; i++) await page.getByRole('button', { name: '下一步' }).click()
    await page.getByRole('button', { name: '完成导览', exact: true }).click()
    await expect(canvas).toHaveCount(1)
    report.products.push({
      slug,
      ready: true,
      structurePixels: 'changed',
      appearancePixels: 'changed',
      guide: '4 steps',
      reducedMotion: 'no page errors',
    })
  }
  // A real service outage must remain explicit in the built app.
  await page.route('**/api/v1/products/**', (route) => route.abort())
  await page.goto(`${base}/?product=form-01`)
  await expect(page.locator('.workbench')).toHaveAttribute('data-status', 'error')
  await expect(page.getByRole('button', { name: '重新加载', exact: true })).toBeVisible()
  await page.unroute('**/api/v1/products/**')
  await page.getByRole('button', { name: '重新加载', exact: true }).click()
  await expect(page.locator('.workbench')).toHaveAttribute('data-status', 'ready', {
    timeout: 30000,
  })
  await page.getByRole('button', { name: '商品目录', exact: true }).click()
  await page.getByRole('textbox', { name: '搜索商品' }).fill('不存在')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '商品目录', exact: true }).click()
  await expect(page.getByText('没有找到对应商品，试试其他关键词。')).toBeVisible()
  await page.getByRole('textbox', { name: '搜索商品' }).fill('')
  await expect(page.locator('.wb-catalog-list button')).toHaveCount(3)
  await page.keyboard.press('Escape')
  // Also exercise component disposal through client-side legacy routing.
  await page.evaluate(() => {
    window.history.pushState(null, '', location.pathname + '?legacy=1&product=form-01')
    window.dispatchEvent(new Event('popstate'))
  })
  await expect(page.locator('.workbench')).toHaveCount(0)
  await expect(page.locator('.product-viewer')).toBeVisible({ timeout: 30000 })
  await page.goBack()
  await expect(page.locator('.workbench')).toHaveAttribute('data-status', 'ready', {
    timeout: 30000,
  })
  await expect(page.locator('canvas')).toHaveCount(1)
  await page.close()
  expect(report.errors).toEqual([])
  report.passed = true
} finally {
  await writeFile(output, JSON.stringify(report, null, 2))
  await browser.close()
}
console.log(JSON.stringify(report, null, 2))

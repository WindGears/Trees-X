import { chromium, expect } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
const base = process.env.CHECK_URL || 'http://127.0.0.1:4173'
const output = '.impeccable/review/typewriter'
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const report = { errors: [], external: [], states: {} }
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.on('pageerror', (e) => report.errors.push(e.message))
  page.on('request', (r) => {
    if (/^https?:/.test(r.url()) && !r.url().startsWith(base)) report.external.push(r.url())
  })

  // 1. 直达链接进入打字机研究
  await page.goto(`${base}/?legacy=1&product=typewriter-study`)
  await page.waitForTimeout(4000)
  await page.screenshot({ path: `${output}/01-assembled.png` })
  report.states.assembled = await page.locator('.study-host').getAttribute('data-mode')

  // 2. 爆炸中段（进度 0.45）
  await page.evaluate(() => {
    const slider = document.querySelector('.tw-progress input[type=range]')
    slider.value = '0.45'
    slider.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await page.waitForTimeout(1600)
  await page.screenshot({ path: `${output}/02-exploded.png` })
  report.states.exploded = await page.locator('.study-host').getAttribute('data-mode')

  // 3. 平铺（进度 1）
  await page.evaluate(() => {
    const slider = document.querySelector('.tw-progress input[type=range]')
    slider.value = '1'
    slider.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await page.waitForTimeout(1800)
  await page.screenshot({ path: `${output}/03-flat.png` })
  report.states.flat = await page.locator('.study-host').getAttribute('data-mode')

  // 4. 回到整机并击发 K
  await page.evaluate(() => {
    const slider = document.querySelector('.tw-progress input[type=range]')
    slider.value = '0'
    slider.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await page.waitForTimeout(1400)
  await page.keyboard.press('k')
  await page.waitForTimeout(120)
  await page.screenshot({ path: `${output}/04-strike.png` })

  // 5. 暗色主题
  await page.keyboard.press('t')
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${output}/05-dark.png` })
  await page.keyboard.press('t')

  // 6. 零件浏览器 + 筛选
  await page.getByRole('button', { name: '零件浏览', exact: true }).click()
  await page.waitForTimeout(300)
  await page.getByRole('button', { name: '键盘', exact: true }).click()
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${output}/06-browser.png` })
  const browserCount = await page.locator('.tw-browser li').count()
  report.states.browserKeysShown = browserCount

  // 7. 搜索
  await page.locator('.tw-browser input[type=search]').fill('枢轴销')
  await page.waitForTimeout(300)
  report.states.searchPivotPins = await page.locator('.tw-browser li').count()

  // 8. 选中检视
  await page.locator('.tw-browser li').first().click()
  await page.waitForTimeout(900)
  await expect(page.locator('.tw-inspector')).toBeVisible()
  await page.screenshot({ path: `${output}/07-inspector.png` })
  await page.getByRole('button', { name: '下一件 →', exact: true }).click()
  await page.waitForTimeout(400)
  await page.getByRole('button', { name: '关闭检视', exact: true }).click()
  await page.waitForTimeout(600)

  // 9. 自动演示
  await page.keyboard.press('p')
  await page.waitForTimeout(900)
  report.states.playing = await page.locator('.tw-toolbar button', { hasText: '暂停' }).count()
  await page.keyboard.press('p')

  // 10. 目录包含 8 件且可切换回其他商品
  await page.getByRole('button', { name: /商品目录/ }).click()
  await expect(page.getByRole('dialog').getByRole('button', { name: /^展示/ })).toHaveCount(8)
  await page.screenshot({ path: `${output}/08-catalog.png` })
  await page.getByRole('dialog').getByRole('button', { name: '展示桌面音箱', exact: true }).click()
  await page.waitForTimeout(2500)
  await expect(page.locator('.product-viewer')).toHaveAttribute('data-product-id', 'form-01')
  await page.screenshot({ path: `${output}/09-back-to-speaker.png` })

  // 11. 再切回打字机（Canvas 重建无泄漏错误）
  await page.goBack()
  await page.waitForTimeout(3000)
  await page.screenshot({ path: `${output}/10-study-again.png` })
  report.states.backToStudy = await page.locator('.study-host').count()

  expect(report.errors).toEqual([])
  expect(report.external).toEqual([])
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} finally {
  await browser.close()
}

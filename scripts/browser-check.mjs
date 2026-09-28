import { mkdir, writeFile } from 'node:fs/promises'
import { chromium, expect } from '@playwright/test'

const base = process.env.CHECK_URL || 'http://127.0.0.1:5180'
const output = '.impeccable/review'
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const results = []

try {
  for (const [name, width, height] of [
    ['desktop', 1440, 1000],
    ['mobile', 390, 844],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: 1,
      reducedMotion: 'reduce',
      isMobile: name === 'mobile',
      hasTouch: name === 'mobile',
    })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
    await page.goto(base)
    await expect(page.getByRole('button', { name: '正面', exact: true })).toBeEnabled({
      timeout: 30000,
    })
    await page.evaluate(() => document.fonts.ready)
    await expect(page.locator('canvas')).toHaveCount(1)
    const initial = await page.locator('canvas').screenshot()
    await page.getByRole('button', { name: '正面', exact: true }).click()
    await page.waitForTimeout(200)
    const front = await page.locator('canvas').screenshot()
    expect(initial.equals(front), 'View buttons must change actual pixels').toBe(false)
    await page.getByRole('button', { name: '背面', exact: true }).click()
    await page.waitForTimeout(200)
    expect(front.equals(await page.locator('canvas').screenshot()), 'Back view must differ').toBe(
      false,
    )
    await page.getByRole('button', { name: '正面', exact: true }).click()
    await page.getByRole('button', { name: '放大模型', exact: true }).click()
    await page.waitForTimeout(200)
    const zoom = await page.locator('canvas').screenshot()
    expect(front.equals(zoom), 'Zoom must change actual pixels').toBe(false)
    await page.getByRole('button', { name: '复位视角', exact: true }).click()
    await expect(page.locator('.product-viewer')).toHaveAttribute('data-visual-quality', 'eco')
    await expect(page.getByRole('button', { name: /基础画质/, exact: false })).toBeDisabled()
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.waitForTimeout(250)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
    expect(overflow, `${name} must not overflow horizontally`).toBe(false)
    await page.screenshot({ path: `${output}/${name}.png`, fullPage: true })
    results.push({
      viewport: name,
      width,
      canvas: 1,
      views: 'pass',
      zoom: 'pass',
      quality: 'pass',
      overflow,
      errors,
    })
    expect(errors).toEqual([])
    await context.close()
  }
  const context = await browser.newContext({ reducedMotion: 'reduce' })
  const page = await context.newPage()
  await page.route('**/models/form-01.glb', (route) => route.fulfill({ status: 404, body: '' }))
  await page.goto(base)
  await expect(page.getByRole('button', { name: '重新加载', exact: true })).toBeVisible()
  await page.unroute('**/models/form-01.glb')
  await page.getByRole('button', { name: '重新加载', exact: true }).click()
  await expect(page.getByRole('button', { name: '正面', exact: true })).toBeEnabled()
  results.push({ failureRecovery: 'pass' })
  await page.evaluate(() => {
    document
      .querySelector('canvas')
      .getContext('webgl2')
      .getExtension('WEBGL_lose_context')
      .loseContext()
  })
  await expect(page.getByText('三维画面已中断，请重新打开场景。')).toBeVisible()
  await page.getByRole('button', { name: '重新加载', exact: true }).click()
  await expect(page.getByRole('button', { name: '正面', exact: true })).toBeEnabled()
  await expect(page.locator('canvas')).toHaveCount(1)
  results.push({ contextRecovery: 'pass' })
  await context.close()

  const fallback = await browser.newContext()
  await fallback.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      return type === 'webgl2' ? null : original.call(this, type, ...args)
    }
  })
  const fallbackPage = await fallback.newPage()
  await fallbackPage.goto(base)
  await expect(fallbackPage.getByText('换个窗口，继续探索。')).toBeVisible()
  await expect(fallbackPage.locator('canvas')).toHaveCount(0)
  results.push({ webglFallback: 'pass' })
  await fallback.close()

  const motion = await browser.newContext({ viewport: { width: 320, height: 800 } })
  const motionPage = await motion.newPage()
  await motionPage.goto(base)
  await expect(motionPage.getByRole('button', { name: '正面', exact: true })).toBeEnabled()
  await motionPage.keyboard.press('Tab')
  await expect(motionPage.getByText('跳转到内容')).toBeFocused()
  await motionPage.getByRole('button', { name: '背面', exact: true }).click()
  await motionPage.waitForTimeout(1000)
  await expect(motionPage.locator('canvas')).toHaveCount(1)
  expect(await motionPage.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
    false,
  )
  results.push({ normalMotion: 'pass', keyboardSkipLink: 'pass', narrow320Overflow: false })
  await motion.close()
} finally {
  await browser.close()
  await writeFile(`${output}/browser-report.json`, JSON.stringify(results, null, 2))
  console.log(JSON.stringify(results, null, 2))
}

import { mkdir, writeFile } from 'node:fs/promises'
import { chromium, expect } from '@playwright/test'
import { assertStablePixels } from './pixel-stability.mjs'

const base = process.env.CHECK_URL || 'http://127.0.0.1:5181'
const output = '.impeccable/review'
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const reports = []
try {
  for (const [name, width, height] of [
    ['desktop', 1440, 1000],
    ['mobile', 390, 844],
  ]) {
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' })
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(`${base}/?legacy=1`)

    await page.getByRole('button', { name: '完整控制台', exact: true }).click()
    const button = (label) => page.getByRole('button', { name: label, exact: true })
    await expect(button('展开结构')).toBeEnabled({ timeout: 30000 })
    await page.evaluate(() => document.fonts.ready)
    const canvas = page.locator('canvas')
    const capture = async () => {
      await canvas.scrollIntoViewIfNeeded()
      await page.waitForTimeout(250)
      return canvas.screenshot()
    }
    const initial = await capture()
    await button('石墨').click()
    await expect(button('石墨')).toHaveAttribute('aria-pressed', 'true')
    const graphite = await capture()
    expect(initial.equals(graphite), 'Finish must recolor actual model pixels').toBe(false)
    await button('香槟').click()
    expect(graphite.equals(await capture())).toBe(false)
    await button('展开结构').click()
    await expect(button('合拢结构')).toHaveAttribute('aria-pressed', 'true')
    const expanded = await capture()
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.screenshot({ path: `${output}/experience-${name}-structure.png`, fullPage: true })
    await button('合拢结构').click()
    expect(expanded.equals(await capture()), 'Structure must move actual model geometry').toBe(
      false,
    )
    for (const part of ['低音单元', '高音单元', '顶部旋钮']) {
      await button(`了解${part}`).click()
      await expect(page.getByRole('region', { name: `${part}说明` })).toBeVisible()
      await capture()
      const hotspot = page.getByRole('button', { name: `查看${part}`, exact: true })
      await expect(hotspot).toBeVisible()
      const position = await hotspot.evaluate((el) => ({
        x: parseFloat(el.style.left),
        y: parseFloat(el.style.top),
      }))
      expect(Math.abs(position.x - 50), `${part} must be centered horizontally`).toBeLessThan(2)
      expect(Math.abs(position.y - 50), `${part} must be centered vertically`).toBeLessThan(2)
    }
    await button('放大模型').click()
    await capture()
    const focused = page.getByRole('button', { name: '查看顶部旋钮', exact: true })
    expect(Math.abs((await focused.evaluate((el) => parseFloat(el.style.left))) - 50)).toBeLessThan(
      2,
    )
    await page
      .locator('.part-description')
      .getByRole('button', { name: '返回全景', exact: true })
      .click()
    await button('开始导览').click()
    await expect(page.getByText('1 / 3 · 圆与方的秩序', { exact: true })).toBeVisible()
    await button('下一步').click()
    await expect(page.getByRole('region', { name: '顶部旋钮说明' })).toBeVisible()
    await button('下一步').click()
    await expect(button('合拢结构')).toBeVisible()
    await button('上一步').click()
    await expect(button('展开结构')).toBeVisible()
    await expect(page.getByRole('region', { name: '顶部旋钮说明' })).toBeVisible()
    await button('下一步').click()
    await button('完成导览').click()
    await expect(button('开始导览')).toBeVisible()
    await button('重置体验').click()
    await expect(button('雾银')).toHaveAttribute('aria-pressed', 'true')
    await expect(button('展开结构')).toBeVisible()
    await expect(page.locator('.part-description')).toHaveCount(0)
    const resetPixels = await capture()
    await writeFile(`${output}/experience-initial-${name}.png`, initial)
    await writeFile(`${output}/experience-reset-${name}.png`, resetPixels)
    await assertStablePixels(
      page,
      initial,
      resetPixels,
      `${name}: Reset must restore original view, finish and geometry`,
    )
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.screenshot({ path: `${output}/experience-${name}.png`, fullPage: true })
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
    expect(overflow).toBe(false)
    if (name === 'mobile') {
      await page.setViewportSize({ width: 320, height: 740 })
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth > innerWidth))
        .toBe(false)
    }
    expect(errors).toEqual([])
    reports.push({
      name,
      finishes: 'real pixels differ',
      structure: 'real pixels differ',
      focus: 'three anchors centered',
      zoom: 'preserves focus',
      guide: 'forward/back/finish',
      reset: 'stable pixels within documented compositor tolerance',
      overflow,
      errors,
    })
    await page.close()
  }
  // Animation interruption and rapid intent replacement with motion enabled.
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  await page.goto(`${base}/?legacy=1`)

  await page.getByRole('button', { name: '完整控制台', exact: true }).click()
  await expect(page.getByRole('button', { name: '展开结构', exact: true })).toBeEnabled({
    timeout: 30000,
  })
  await page.getByRole('button', { name: '展开结构', exact: true }).click()
  await page.getByRole('button', { name: '了解高音单元', exact: true }).click()
  await page.locator('canvas').scrollIntoViewIfNeeded()
  await page.waitForTimeout(1000)
  const hotspot = page.getByRole('button', { name: '查看高音单元', exact: true })
  expect(Math.abs((await hotspot.evaluate((el) => parseFloat(el.style.left))) - 50)).toBeLessThan(2)
  await page.getByRole('button', { name: '立体', exact: true }).click()
  const bounds = await page.locator('canvas').boundingBox()
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  await page.mouse.down()
  await page.mouse.move(bounds.x + bounds.width / 2 + 60, bounds.y + bounds.height / 2, {
    steps: 6,
  })
  await page.mouse.up()
  await page.waitForTimeout(100)
  const interrupted = await hotspot.evaluate((el) => ({
    x: parseFloat(el.style.left),
    y: parseFloat(el.style.top),
  }))
  await page.waitForTimeout(950)
  const settled = await hotspot.evaluate((el) => ({
    x: parseFloat(el.style.left),
    y: parseFloat(el.style.top),
  }))
  expect(
    Math.hypot(interrupted.x - settled.x, interrupted.y - settled.y),
    'Drag must stop the camera tween',
  ).toBeLessThan(0.05)
  await page.getByRole('button', { name: '重置体验', exact: true }).click()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.waitForTimeout(150)
  await expect(page.getByRole('button', { name: '展开结构', exact: true })).toBeVisible()
  reports.push({
    motion: 'rapid expansion to detail, drag interruption, reduced-motion switch passed',
  })
  await writeFile(`${output}/experience-results.json`, JSON.stringify(reports, null, 2))
  console.log(JSON.stringify(reports, null, 2))
} finally {
  await browser.close()
}

import { chromium, expect } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
const base = process.env.CHECK_URL || 'http://127.0.0.1:5181'
const output = '.impeccable/review/exhibition'
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const report = { layouts: [], interactions: [], errors: [], external: [] }
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce',
  })
  page.on('pageerror', (e) => report.errors.push(e.message))
  page.on('request', (r) => {
    if (/^https?:/.test(r.url()) && !r.url().startsWith(base)) report.external.push(r.url())
  })
  await page.goto(`${base}/?legacy=1`)
  const button = (name) => page.getByRole('button', { name, exact: true })
  await expect(button('正面')).toBeEnabled({ timeout: 40000 })
  await expect(page.locator('.studio-console')).toBeHidden()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('桌面音箱')
  await page.evaluate(() => {
    window.__canvas = document.querySelector('canvas')
  })
  await button('外观').click()
  await button('石墨').click()
  await button('收起面板').click()
  await button('结构').click()
  await button('展开结构').click()
  await button('收起面板').click()
  await button('外观').click()
  await expect(button('石墨')).toHaveAttribute('aria-pressed', 'true')
  await button('收起面板').click()
  await button('返回全景').click()
  await button('结构').click()
  await expect(button('展开结构')).toBeVisible()
  await button('外观').click()
  await expect(button('石墨')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('heading', { name: '观察结构', exact: true })).toHaveCount(0)
  await button('收起面板').click()
  const canvas = page.locator('canvas'),
    before = await canvas.screenshot()
  const box = await canvas.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.wheel(0, -320)
  await page.waitForTimeout(300)
  expect(before.equals(await canvas.screenshot()), 'wheel changes camera pixels').toBe(false)
  await button('细节').click()
  await button('开始导览').click()
  await expect(page.locator('.guide-copy')).toContainText('圆与方的秩序')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 15, { steps: 8 })
  await page.mouse.up()
  await expect(button('开始导览')).toBeVisible()
  await button('收起面板').click()
  expect(await page.evaluate(() => window.__canvas === document.querySelector('canvas'))).toBe(true)
  report.interactions.push(
    'default immersive',
    'single panel',
    'finish/structure retained on close',
    'overview preserves finish and assembles',
    'wheel zoom',
    'drag exits guide',
    'same renderer',
  )
  await page.close()
  for (const [width, height] of [
    [1280, 720],
    [1440, 1000],
    [1920, 1080],
  ]) {
    const scene = await browser.newPage({ viewport: { width, height } })
    scene.on('pageerror', (e) => report.errors.push(e.message))
    for (const id of ['form-01', 'toy-racer', 'potted-plant']) {
      await scene.goto(`${base}/?legacy=1&product=${id}`)
      await expect(scene.getByRole('button', { name: '正面', exact: true })).toBeEnabled({
        timeout: 40000,
      })
      await scene.waitForTimeout(3000)
      expect(await scene.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
        false,
      )
      await scene.screenshot({ path: `${output}/${id}-${width}-overview.png` })
      await scene.getByRole('button', { name: '细节', exact: true }).click()
      await scene.waitForTimeout(300)
      const a = await scene.locator('.canvas-host').boundingBox(),
        b = await scene.locator('.studio-console').boundingBox()
      expect(a.x + a.width, 'panel does not overlap canvas').toBeLessThanOrEqual(b.x)
      await scene.screenshot({ path: `${output}/${id}-${width}-panel.png` })
      await scene.getByRole('group', { name: '部件聚焦' }).getByRole('button').first().click()
      await scene.waitForTimeout(1000)
      await scene.screenshot({ path: `${output}/${id}-${width}-detail.png` })
      report.layouts.push({
        id,
        width,
        height,
        meshes: await scene.locator('.product-viewer').getAttribute('data-rendered-meshes'),
        panelClearsCanvas: true,
      })
    }
    if (width === 1440) {
      await scene.getByRole('button', { name: /商品目录/ }).click()
      await scene.screenshot({ path: `${output}/catalog.png` })
    }
    await scene.close()
  }
  for (const width of [390, 320]) {
    const mobile = await browser.newPage({ viewport: { width, height: 844 } })
    await mobile.goto(`${base}/?legacy=1`)
    await expect(mobile.getByRole('button', { name: '正面', exact: true })).toBeEnabled({
      timeout: 40000,
    })
    await mobile.screenshot({ path: `${output}/mobile-${width}.png`, fullPage: true })
    await mobile.getByRole('button', { name: '手势', exact: true }).click()
    await expect(mobile.getByRole('button', { name: '跳过动作示范', exact: true })).toBeVisible()
    expect(await mobile.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    )
    await mobile.evaluate(() => window.scrollTo(0, 0))
    await mobile.waitForTimeout(400)
    await mobile.screenshot({ path: `${output}/mobile-${width}-gesture.png`, fullPage: true })
    await mobile.close()
  }
  expect(report.errors).toEqual([])
  expect(report.external).toEqual([])
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} finally {
  await browser.close()
}

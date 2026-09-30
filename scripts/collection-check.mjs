import { chromium, expect } from '@playwright/test'
import { URL } from 'node:url'
import { mkdir, writeFile } from 'node:fs/promises'
const base = process.env.CHECK_URL || 'http://127.0.0.1:5180'
const output = '.impeccable/review'
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const report = { models: [], errors: [], externalRequests: [], navigation: {}, screenshots: [] }
const products = [
  ['gamepad', '复古游戏手柄', false],
  ['gaming-console', '复古游戏主机', true],
  ['oak-side-table', '实木边桌', false],
  ['potted-plant', '陶盆绿植', true],
  ['home-furniture-set', '五件家具套件', true],
  ['toy-racer', '迷你赛车', true],
]
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce',
  })
  page.on('pageerror', (error) => report.errors.push(error.message))
  page.on('request', (request) => {
    if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== new URL(base).origin)
      report.externalRequests.push(request.url())
  })
  const ready = async () => {
    await expect(page.getByRole('button', { name: '正面', exact: true })).toBeEnabled({
      timeout: 40000,
    })
    await expect(page.locator('canvas')).toHaveCount(1)
    await page.waitForTimeout(150)
  }
  await page.goto(base)

  await page.getByRole('button', { name: '完整控制台', exact: true }).click()
  await ready()
  await page.evaluate(() => {
    window.__originalCanvas = document.querySelector('canvas')
  })
  await page.getByRole('button', { name: /商品目录/ }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('button', { name: /^展示/ })).toHaveCount(9)
  await dialog.getByRole('button', { name: '家居', exact: true }).click()
  await expect(dialog.getByRole('button', { name: /^展示/ })).toHaveCount(3)
  await dialog
    .getByRole('textbox', { name: '搜索商品' })
    .count()
    .then(async (count) => {
      const search = count
        ? dialog.getByRole('textbox', { name: '搜索商品' })
        : dialog.getByRole('searchbox', { name: '搜索商品' })
      await search.fill('不存在')
    })
  await expect(dialog.getByText('还没有找到这件物品。')).toBeVisible()
  await dialog.getByRole('button', { name: '查看全部商品', exact: true }).click()
  await page.screenshot({ path: `${output}/collection-desktop.png` })
  for (const [id, label, structure] of products) {
    if (!(await dialog.isVisible())) await page.getByRole('button', { name: /商品目录/ }).click()
    await dialog.getByRole('button', { name: `展示${label}`, exact: true }).click()
    await expect(page.locator('.product-viewer')).toHaveAttribute('data-product-id', id)
    await ready()
    expect(
      await page.evaluate(() => document.querySelector('canvas') === window.__originalCanvas),
      `${id}: same Canvas`,
    ).toBe(true)
    expect(new URL(page.url()).searchParams.get('product')).toBe(id)
    const original = await page.locator('canvas').screenshot()
    await page.getByRole('button', { name: '冷调试色', exact: true }).click()
    await page.waitForTimeout(120)
    expect(
      original.equals(await page.locator('canvas').screenshot()),
      `${id}: actual material change`,
    ).toBe(false)
    await page.getByRole('button', { name: '原始材质', exact: true }).click()
    const focus = page.getByRole('group', { name: '部件聚焦' }).getByRole('button').first()
    await focus.click()
    await expect(page.locator('.part-description')).toBeVisible()
    await page
      .locator('.part-description')
      .getByRole('button', { name: '返回全景', exact: true })
      .click()
    if (structure) {
      const before = await page.locator('canvas').screenshot()
      await page.getByRole('button', { name: '展开结构', exact: true }).click()
      await page.waitForTimeout(120)
      expect(
        before.equals(await page.locator('canvas').screenshot()),
        `${id}: expansion changes pixels`,
      ).toBe(false)
      await page.getByRole('button', { name: '合拢结构', exact: true }).click()
    } else await expect(page.getByRole('button', { name: '整体观察', exact: true })).toBeDisabled()
    await page.getByRole('button', { name: '开始导览', exact: true }).click()
    await page.getByRole('button', { name: '下一步', exact: true }).click()
    if (structure) await page.getByRole('button', { name: '下一步', exact: true }).click()
    await expect(page.getByRole('button', { name: '完成导览', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '重置体验', exact: true }).click()
    await page.screenshot({ path: `${output}/collection-${id}.png` })
    report.models.push({
      id,
      structure,
      materialPixels: 'changed',
      focus: 'pass',
      guide: 'pass',
      sameCanvas: true,
    })
  }
  await page.goBack()
  await ready()
  await expect(page.locator('.product-viewer')).toHaveAttribute(
    'data-product-id',
    'home-furniture-set',
  )
  // Rapid changes must not let a late decoder overwrite the most recent product.
  // Catalog selection remains available across authored exhibits, which
  // intentionally do not expose the generic next/previous toolbar.
  for (const label of ['陶盆绿植', '迷你赛车', '复古游戏手柄']) {
    await page.getByRole('button', { name: /商品目录/ }).click()
    await dialog.getByRole('button', { name: `展示${label}`, exact: true }).click()
  }
  await ready()
  await expect(page.locator('.product-viewer')).toHaveAttribute('data-product-id', 'gamepad')
  await page.reload()
  await ready()
  await expect(page.locator('.product-viewer')).toHaveAttribute('data-product-id', 'gamepad')
  report.navigation = {
    filters: 'pass',
    empty: 'pass',
    back: 'pass',
    deepLink: 'pass',
    rapidSwitch: 'pass',
  }
  await page.getByRole('button', { name: /商品目录/ }).click()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: /商品目录/ })).toBeFocused()
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 })
    await page.getByRole('button', { name: /商品目录/ }).click()
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
    await page.screenshot({ path: `${output}/collection-${width}.png` })
    await page.keyboard.press('Escape')
  }
  await page.close()
  // Use the actual high-end path too, including decoder, HDR and Composer.
  const cinematic = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'no-preference',
  })
  cinematic.on('pageerror', (error) => report.errors.push(error.message))
  await cinematic.goto(`${base}/?product=toy-racer`)
  await expect(cinematic.locator('.product-viewer')).toHaveAttribute('data-composer-count', '1', {
    timeout: 40000,
  })
  await expect(cinematic.locator('.product-viewer')).toHaveAttribute(
    'data-intro-state',
    'playing',
    { timeout: 40000 },
  )
  await expect(cinematic.locator('.product-viewer')).toHaveAttribute('data-intro-state', 'stable', {
    timeout: 10000,
  })
  await cinematic.screenshot({ path: `${output}/collection-cinematic.png` })
  const request = await cinematic.locator('.product-viewer').getAttribute('data-intro-request')
  await cinematic.getByRole('button', { name: /商品目录/ }).click()
  await expect(cinematic.locator('.product-viewer')).toHaveAttribute('data-composer-count', '0')
  await cinematic.keyboard.press('Escape')
  await expect(cinematic.locator('.product-viewer')).toHaveAttribute('data-composer-count', '1')
  await expect(cinematic.locator('.product-viewer')).toHaveAttribute('data-intro-request', request)
  await cinematic.getByRole('button', { name: '重播视觉演出', exact: true }).click()
  await expect(cinematic.locator('.product-viewer')).toHaveAttribute('data-intro-state', 'playing')
  await cinematic.getByRole('button', { name: '正面', exact: true }).click()
  await expect(cinematic.locator('.product-viewer')).toHaveAttribute('data-intro-state', 'stable')
  report.cinematic = 'intro, replay, input interruption, catalog pause and resume passed'
  expect(report.errors).toEqual([])
  expect(report.externalRequests).toEqual([])
  await writeFile(`${output}/collection-results.json`, JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} finally {
  await browser.close()
}

/* global getComputedStyle */
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium, expect } from '@playwright/test'

// Isolated browser response fixtures only: never create or publish test products.
const base = process.env.CHECK_URL ?? 'http://127.0.0.1:5183'
const output = 'artifacts/museum/catalog'
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage()
const report = { passed: false, cases: [], errors: [], modelRequests: [] }
page.on('pageerror', (error) => report.errors.push(error.message))
page.on('request', (request) => {
  if (/\.(?:glb|hdr|exr|ktx2|wasm)(?:\?|$)/.test(request.url()))
    report.modelRequests.push(request.url())
})
let count = 1
let unavailable = false
await page.route(/\/api\/v1\/products(?:\?.*)?$/, (route) =>
  route.fulfill({
    status: unavailable ? 503 : 200,
    json: Array.from({ length: count }, (_, index) => ({
      slug: `fixture-${index}`,
      name: index === 0 ? '用于检验长名称与多行排版的机械探索展品' : `测试展品 ${index + 1}`,
      description: '目录布局测试数据，仅存在于隔离浏览器，不写入数据库。',
      category: index % 2 ? '乐器' : '机械',
      displayStatus: 'formal',
      cover: '/covers/showcase/typewriter-whole.webp',
    })),
  }),
)
await page.route('**/api/v1/categories', (route) =>
  route.fulfill({ json: [{ name: '机械' }, { name: '乐器' }] }),
)
const button = (name) => page.getByRole('button', { name, exact: true })
try {
  for (const width of [1280, 1440, 1920]) {
    await page.setViewportSize({
      width,
      height: width === 1280 ? 720 : width === 1440 ? 1000 : 1080,
    })
    for (count of [1, 3, 12, 30]) {
      await page.goto(`${base}/?gallery=next`)
      await expect(button('开始互动')).toBeVisible()
      await button('展品库').click()
      await expect(page.locator('.museum-card')).toHaveCount(count)
      await expect(page.getByRole('dialog')).toHaveCSS('opacity', '1')
      const columns = await page
        .locator('.museum-library-grid')
        .evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length)
      assert.equal(columns, width >= 1700 ? 4 : 3)
      assert.equal(
        await page
          .getByRole('dialog')
          .evaluate((element) => element.scrollWidth > element.clientWidth),
        false,
      )
      if (count === 30) await page.screenshot({ path: `${output}/library-30-${width}.png` })
      report.cases.push({ width, count, columns })
    }
  }
  await page.getByRole('textbox', { name: '搜索展品名称' }).fill('不存在')
  await expect(page.getByRole('heading', { name: '没有找到匹配的展品' })).toBeVisible()
  await button('清除筛选').click()
  await page.getByRole('combobox', { name: '展品分类' }).selectOption('乐器')
  await expect(page.locator('.museum-card')).toHaveCount(15)
  await page.keyboard.press('Escape')
  await expect(button('展品库')).toBeFocused()
  await button('展品库').click()
  await expect(page.getByRole('combobox', { name: '展品分类' })).toHaveValue('乐器')
  await page.keyboard.press('Escape')
  unavailable = true
  await page.goto(`${base}/?gallery=next`)
  await expect(page.getByText('无法连接展品服务', { exact: true })).toBeVisible()
  await button('展品库').click()
  await expect(page.getByRole('heading', { name: '暂时无法读取展品库' })).toBeVisible()
  unavailable = false
  count = 0
  await page.getByRole('dialog').getByRole('button', { name: '重试', exact: true }).click()
  await expect(page.getByRole('heading', { name: '展品库正在准备中' })).toBeVisible()
  await expect(page.locator('canvas')).toHaveCount(0)
  assert.deepEqual(report.modelRequests, [])
  assert.deepEqual(report.errors, [])
  report.passed = true
} finally {
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2))
  await browser.close()
}
console.log(JSON.stringify(report, null, 2))

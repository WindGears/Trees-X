/* global URL */
import { chromium, expect } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'

const base = process.env.CHECK_URL || 'http://127.0.0.1:5182'
const output = '.impeccable/review/asset-ingestion'
await mkdir(output, { recursive: true })
const fixture = JSON.parse(
  await readFile('server/src/test/resources/fixtures/speaker-glb-v2.json', 'utf8'),
)
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const report = {
  scope: 'built application + real v2 GLB fixture',
  checks: [],
  errors: [],
  external: [],
}
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce',
  })
  page.on('pageerror', (error) => report.errors.push(error.message))
  page.on('request', (request) => {
    if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== new URL(base).origin)
      report.external.push(request.url())
  })
  await page.route('**/api/v1/products/form-01', (route) => route.fulfill({ json: fixture }))
  await page.goto(base + '/?product=form-01')
  const host = page.locator('.workbench'),
    canvas = page.locator('canvas')
  async function ready() {
    await expect(host).toHaveAttribute('data-status', 'ready', { timeout: 45000 })
    await expect(canvas).toHaveCount(1)
  }
  const pixels = () =>
    canvas.screenshot({
      style: '.wb-hotspots,.wb-intro,.wb-tools,.wb-input-hint{visibility:hidden!important}',
    })
  await ready()
  await page.getByRole('button', { name: '外观', exact: true }).click()
  const finish = await pixels()
  await page.locator('.wb-finishes button').nth(1).click()
  expect((await pixels()).equals(finish), 'finish changes actual GLB pixels').toBe(false)
  await page.getByRole('button', { name: '结构与动作', exact: true }).click()
  const closed = await pixels()
  await page.getByRole('button', { name: '展开部件', exact: true }).click()
  expect((await pixels()).equals(closed), 'structure changes actual GLB pixels').toBe(false)
  await page.getByRole('button', { name: /转动旋钮/ }).click()
  await page.screenshot({ path: output + '/speaker-production-action.png' })
  await page.getByRole('button', { name: '还原商品', exact: true }).click()
  await page.getByRole('button', { name: '导览', exact: true }).click()
  await page.getByRole('button', { name: '开始导览' }).click()
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: '下一步' }).click()
  await page.getByRole('button', { name: '完成导览', exact: true }).click()
  report.checks.push('v2 appearance, structure, action and four-step guide in production build')
  for (const name of ['机械打字机', '桌面音箱']) {
    await page.getByRole('button', { name: '商品目录', exact: true }).click()
    await page.locator('.wb-catalog-list button').filter({ hasText: name }).click()
    await ready()
  }
  report.checks.push('procedural and GLB switch in production build; single canvas')
  expect(report.errors).toEqual([])
  expect(report.external).toEqual([])
  report.passed = true
} catch (error) {
  report.failure = String(error)
  throw error
} finally {
  await writeFile(output + '/production.json', JSON.stringify(report, null, 2))
  await browser.close()
}
console.log(JSON.stringify(report, null, 2))

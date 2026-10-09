/* global URL */
import { chromium, expect } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
const base = process.env.CHECK_URL || 'http://127.0.0.1:5181'
const output = 'artifacts/typewriter-migration/compatibility'
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const report = { passed: false, checks: [], errors: [] }
try {
  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
    reducedMotion: 'reduce',
  })
  mobile.on('pageerror', (error) => report.errors.push(error.message))
  await mobile.goto(base)
  await expect(mobile.locator('.workbench')).toHaveAttribute('data-status', 'ready', {
    timeout: 90000,
  })
  for (const width of [390, 320]) {
    await mobile.setViewportSize({ width, height: 844 })
    await mobile.getByRole('button', { name: '结构与动作', exact: true }).click()
    await mobile.getByRole('button', { name: '平铺部件', exact: true }).click()
    await expect(mobile.getByRole('button', { name: '平铺部件', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await mobile.getByRole('button', { name: '收起面板', exact: true }).click()
    await mobile.getByRole('button', { name: '细节', exact: true }).click()
    await mobile.getByLabel('查找部件', { exact: true }).fill('A')
    await expect(mobile.locator('.wb-part-list button')).toHaveCount(2)
    await mobile.locator('.wb-part-list button').filter({ hasText: '按键 · 24 · A' }).click()
    await expect(mobile.locator('.wb-part-copy h3')).toHaveText('按键 · 24 · A')
    await mobile.getByRole('button', { name: '返回全景', exact: true }).click()
    await mobile.getByRole('button', { name: '收起面板', exact: true }).click()
    await mobile.getByRole('group', { name: '商品展示区', exact: true }).focus()
    await mobile.keyboard.press('ArrowLeft')
    await expect(mobile.getByLabel('观察视角', { exact: true })).toHaveValue('')
    await mobile.keyboard.press('Home')
    await expect(mobile.getByLabel('观察视角', { exact: true })).toHaveValue('perspective')
    expect(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    )
    await expect(mobile.locator('canvas')).toHaveCount(1)
  }
  report.checks.push(
    '390/320px panels, search/focus, keyboard, unique Canvas; reduced-motion structure endpoints',
  )
  await mobile.close()
  const fallback = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  fallback.on('pageerror', (error) => report.errors.push(error.message))
  const requests = []
  fallback.on('request', (request) => requests.push(request.url()))
  await fallback.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      return /^(webgl|experimental-webgl)/.test(type) ? null : original.call(this, type, ...args)
    }
  })
  await fallback.goto(base)
  await expect(fallback.locator('.workbench')).toHaveAttribute('data-status', 'content')
  await expect(fallback.locator('canvas')).toHaveCount(0)
  await expect(fallback.locator('.wb-tools')).toHaveCount(0)
  await expect(fallback.locator('h1')).toHaveText('机械打字机')
  await expect(fallback.locator('.wb-fallback-details dt')).toHaveCount(8)
  expect(
    await fallback
      .locator('.wb-fallback-cover')
      .evaluate((img) => img.complete && img.naturalWidth === 960),
  ).toBe(true)
  expect(requests.some((url) => /\.(glb|hdr|exr)(\?|$)/.test(url))).toBe(false)
  expect(
    requests
      .filter((url) => /^https?:/.test(url))
      .every((url) => new URL(url).origin === new URL(base).origin),
  ).toBe(true)
  await fallback.getByRole('button', { name: '浏览其他商品', exact: true }).click()
  await expect(fallback.locator('.wb-catalog-list button')).toHaveCount(2)
  await fallback.getByRole('button', { name: '关闭目录', exact: true }).click()
  for (const width of [390, 320]) {
    await fallback.setViewportSize({ width, height: 844 })
    expect(await fallback.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    )
  }
  report.checks.push(
    'WebGL unavailable retains real cover and eight key observations, no 3D assets, real two-product catalog',
  )
  await fallback.close()
  const startup = await browser.newPage()
  startup.on('pageerror', (error) => report.errors.push(error.message))
  await startup.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext
    let count = 0
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      if (/^(webgl|experimental-webgl)/.test(type) && ++count > 1) return null
      return original.call(this, type, ...args)
    }
  })
  await startup.goto(base)
  await expect(startup.locator('.workbench')).toHaveAttribute('data-status', 'content', {
    timeout: 30000,
  })
  await expect(startup.locator('canvas')).toHaveCount(0)
  await expect(startup.getByText(/三维显示启动失败，已保留商品图文/)).toBeVisible()
  await startup.close()
  report.checks.push('Renderer initialization rejection recovers to real product content')
  expect(report.errors).toEqual([])
  report.passed = true
} finally {
  await browser.close()
  await writeFile(output + '/report.json', JSON.stringify(report, null, 2) + '\n')
}
console.log(JSON.stringify(report))

/* global URL, fetch */
import { chromium, expect } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { readDemoConfig, demoProducts } from './demo/config.mjs'

const base = process.env.CHECK_URL || readDemoConfig().baseUrl
const output = process.env.DEMO_PRODUCTION_OUTPUT || 'artifacts/demo/production'
const sizes = [
  [1440, 1000],
  [1280, 720],
  [1920, 1080],
  [390, 844],
  [320, 720],
]
await mkdir(output, { recursive: true })
const report = {
  passed: false,
  base,
  networkPolicy: 'Browser HTTP(S) blocked except loopback; real local API allowed',
  externalAttempts: [],
  errors: [],
  products: [],
  captures: [],
}
const browser = await chromium.launch({ channel: 'msedge', headless: true })
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
  })
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (
      ['http:', 'https:'].includes(url.protocol) &&
      !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    ) {
      report.externalAttempts.push(url.href)
      await route.abort('blockedbyclient')
    } else await route.continue()
  })
  const page = await context.newPage()
  page.setDefaultTimeout(30000)
  page.on('pageerror', (error) => report.errors.push(error.message))
  const catalog = await (await fetch(base + '/api/v1/products')).json()
  expect(catalog.map((p) => p.slug).sort()).toEqual(demoProducts.map((p) => p.slug).sort())
  let canvasHandle
  for (const item of demoProducts) {
    const product = await (await fetch(`${base}/api/v1/products/${item.slug}`)).json()
    expect(product.presentation.source.kind).toBe('glb')
    expect(product.presentation.source.bundle.manifest).toBe(item.manifest)
    const manifest = await (await fetch(base + item.manifest)).json()
    const modelUrl = new URL(manifest.entry, base + item.manifest).href
    const responsePromise = page.waitForResponse(
      (response) => response.url() === modelUrl && response.status() === 200,
      { timeout: 240000 },
    )
    await page.goto(`${base}/?product=${item.slug}`, { waitUntil: 'domcontentloaded' })
    await expect(page.locator('.workbench')).toHaveAttribute('data-status', 'ready', {
      timeout: 240000,
    })
    const modelResponse = await responsePromise
    await expect(page.locator('h1')).toHaveText(product.name)
    await expect(page.locator('canvas')).toHaveCount(1)
    canvasHandle = await page.locator('canvas').elementHandle()
    const identity = {
      slug: item.slug,
      manifest: item.manifest,
      model: modelResponse.url(),
      contentType: modelResponse.headers()['content-type'],
      views: [],
    }
    expect(identity.contentType?.includes('text/html')).toBe(false)
    for (const [width, height] of sizes) {
      await page.setViewportSize({ width, height })
      await page.waitForTimeout(250)
      await expect(page.locator('canvas')).toHaveCount(1)
      expect(
        await canvasHandle.evaluate((canvas) => canvas === document.querySelector('canvas')),
      ).toBe(true)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      )
      await expect(page.getByRole('button', { name: '商品目录', exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: '结构与动作', exact: true })).toBeVisible()
      const path = `${output}/${item.slug}-${width}.png`
      await page.screenshot({ path })
      report.captures.push(path)
      identity.views.push({ width, height, sameCanvas: true, noHorizontalOverflow: true })
    }
    await page.setViewportSize({ width: 1440, height: 1000 })
    const canvas = page.locator('canvas')
    const pixels = () =>
      canvas.screenshot({
        style: '.wb-hotspots,.wb-intro,.wb-tools,.wb-input-hint{visibility:hidden!important}',
      })
    const before = await pixels()
    await page.getByRole('button', { name: '结构与动作', exact: true }).click()
    await page
      .getByRole('button', {
        name:
          item.slug === 'typewriter-study'
            ? '分层展开'
            : item.slug === 'piano-cfx'
              ? '剖切'
              : '打开双门',
        exact: true,
      })
      .click()
    expect((await pixels()).equals(before), 'Real GLB action changes rendered pixels').toBe(false)
    const actionPath = `${output}/${item.slug}-action.png`
    await page.screenshot({ path: actionPath })
    report.captures.push(actionPath)
    await page.getByRole('button', { name: '还原商品', exact: true }).click()
    await page.getByRole('button', { name: '细节', exact: true }).click()
    await page.locator('.wb-panel .wb-part-list button').first().click()
    await expect(page.getByRole('button', { name: '返回全景', exact: true })).toBeVisible()
    const detailPath = `${output}/${item.slug}-detail.png`
    await page.screenshot({ path: detailPath })
    report.captures.push(detailPath)
    await page.getByRole('button', { name: '返回全景', exact: true }).click()
    await page.getByRole('button', { name: '导览', exact: true }).click()
    await page.getByRole('button', { name: '开始导览', exact: true }).click()
    for (let i = 1; i < product.presentation.guide.length; i++)
      await page.getByRole('button', { name: '下一步', exact: true }).click()
    await page.getByRole('button', { name: '完成导览', exact: true }).click()
    identity.realActionPixels = 'changed'
    identity.guideSteps = product.presentation.guide.length
    report.products.push(identity)
    await canvasHandle.dispose()
  }
  await page.getByRole('button', { name: '商品目录', exact: true }).click()
  const cards = page.locator('.wb-catalog-list > button')
  await expect(cards).toHaveCount(demoProducts.length)
  for (let index = 0; index < demoProducts.length; index++) {
    const card = cards.nth(index)
    await card.scrollIntoViewIfNeeded()
    await expect(card.locator('strong')).toBeVisible()
    await expect
      .poll(() => card.locator('img').evaluate((image) => image.complete && image.naturalWidth > 0))
      .toBe(true)
  }
  expect((await cards.locator('strong').allTextContents()).sort()).toEqual(
    catalog.map((product) => product.name).sort(),
  )
  await cards.first().scrollIntoViewIfNeeded()
  report.catalogReady = true
  await page.screenshot({ path: `${output}/catalog.png` })
  report.captures.push(`${output}/catalog.png`)
  await page.keyboard.press('Escape')
  // Real public API outage/retry under the same loopback-only policy.
  await page.route('**/api/v1/products/typewriter-study', (route) => route.abort())
  await page.goto(base + '/?product=typewriter-study')
  await expect(page.locator('.workbench')).toHaveAttribute('data-status', 'error')
  await page.unroute('**/api/v1/products/typewriter-study')
  await page.getByRole('button', { name: '重新加载', exact: true }).click()
  await expect(page.locator('.workbench')).toHaveAttribute('data-status', 'ready', {
    timeout: 240000,
  })
  await expect(page.locator('canvas')).toHaveCount(1)
  report.outageRetry = true
  expect(report.errors).toEqual([])
  expect(report.externalAttempts).toEqual([])
  report.passed = true
} catch (error) {
  report.failure = String(error)
  throw error
} finally {
  await browser.close()
  report.completedAt = new Date().toISOString()
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2) + '\n')
}
console.log(
  JSON.stringify({
    passed: report.passed,
    products: report.products.length,
    captures: report.captures.length,
    output,
  }),
)

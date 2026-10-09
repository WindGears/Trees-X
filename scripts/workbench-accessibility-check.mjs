/* global URL, fetch */
import { chromium, expect } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'

const base = process.env.CHECK_URL || 'http://127.0.0.1:5181'
const current = await (await fetch(base + '/api/v1/products/typewriter-study')).json()
if (current.presentation?.source.adapter === 'typewriter-v1') {
  await import('./typewriter-compatibility-check.mjs')
  process.exit(0)
}
const output = 'artifacts/restart/2026-10-08/accessibility'
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const report = {
  api: 'Real Spring Boot / MySQL; browser-injected WebGL failures',
  checks: [],
  errors: [],
  captures: [],
}
const watchErrors = (page) =>
  page.on('pageerror', (e) => report.errors.push({ message: e.message, url: page.url() }))
const capture = async (page, name) => {
  await page.evaluate(() => document.fonts.ready)
  if (await page.locator('.wb-panel').count()) {
    await expect(page.locator('.wb-panel')).toHaveCSS('opacity', '1')
    if (await page.locator('.wb-catalog').count())
      await expect(page.locator('.wb-catalog-list button')).toHaveCount(3)
  }
  await page.screenshot({ path: `${output}/${name}.png` })
  report.captures.push(name)
}
const context = async (page) =>
  page.evaluate(() => {
    let component = document.querySelector('canvas').__vueParentComponent
    while (component) {
      const value =
        component.exposed?.context ??
        Reflect.ownKeys(component.provides ?? {})
          .map((k) => component.provides[k])
          .find((v) => v?.scene?.value?.isScene)
      if (value) {
        window.__wb = value
        return
      }
      component = component.parent
    }
    throw new Error('No Three context found')
  })
const state = (page) =>
  page.evaluate(() => {
    const camera = window.__wb.camera.activeCamera.value
    const root = window.__wb.scene.value.children.find((o) => o.userData.workbenchProduct)
    const nodes = {}
    root.traverse((o) => {
      if (o.name) nodes[o.name] = [o.position.toArray(), [o.rotation.x, o.rotation.y, o.rotation.z]]
    })
    return { camera: camera.position.toArray(), nodes }
  })
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce',
  })
  watchErrors(page)
  await page.goto(base)
  await expect(page.locator('.workbench')).toHaveAttribute('data-status', 'ready', {
    timeout: 30000,
  })
  await context(page)
  await page.evaluate(() => {
    window.__renderer = window.__wb.renderer.instance
  })
  const initial = await state(page)
  const stage = page.getByRole('group', { name: '商品展示区', exact: true })
  // Reach the scene through native Tab navigation, not a synthetic focus shortcut.
  await page.getByRole('button', { name: '商品目录', exact: true }).focus()
  await page.keyboard.press('Tab')
  await expect(stage).toBeFocused()
  await page.keyboard.press('ArrowLeft')
  await expect.poll(async () => (await state(page)).camera).not.toEqual(initial.camera)
  const rotated = await state(page)
  expect(rotated.nodes).toEqual(initial.nodes)
  await page.keyboard.press('ArrowUp')
  await expect.poll(async () => (await state(page)).camera).not.toEqual(rotated.camera)
  const tilted = await state(page)
  await page.keyboard.press('+')
  await expect.poll(async () => (await state(page)).camera).not.toEqual(tilted.camera)
  await page.keyboard.press('Home')
  await expect.poll(async () => (await state(page)).camera).toEqual(initial.camera)
  await page.keyboard.press('Control+ArrowLeft')
  expect((await state(page)).camera).toEqual(initial.camera)
  await capture(page, 'keyboard-1440')
  report.checks.push(
    'Tab reaches scene; arrows orbit; +/- zoom; Home resets camera; modifiers ignored; model pose preserved',
  )

  await page.getByRole('button', { name: '导览', exact: true }).focus()
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: '开始导览', exact: true }).press('Enter')
  await stage.press('ArrowRight')
  await expect(page.getByRole('button', { name: '开始导览', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '商品目录', exact: true }).press('Enter')
  const search = page.getByRole('textbox', { name: '搜索商品' })
  await search.fill('音箱')
  const beforeTyping = await state(page)
  await search.press('ArrowLeft')
  await search.press('Home')
  expect((await state(page)).camera).toEqual(beforeTyping.camera)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: '商品目录', exact: true })).toBeFocused()
  await stage.press('Home')
  await page.getByRole('button', { name: '细节', exact: true }).press('Enter')
  await page.locator('.wb-part-list button').first().press('Enter')
  await expect(page.locator('.wb-part-list button').first()).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(async () => (await state(page)).camera).not.toEqual(initial.camera)
  await page.keyboard.press('Escape')
  expect(await page.evaluate(() => window.__renderer === window.__wb.renderer.instance)).toBe(true)
  report.checks.push(
    'Native button activation and part selection; keyboard exits guide; panel input isolation; Escape restores opener; same renderer',
  )
  for (const width of [1280, 1920, 390, 320]) {
    await page.setViewportSize({ width, height: width < 760 ? 844 : width === 1920 ? 1080 : 720 })
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true)
    await capture(page, `keyboard-${width}`)
  }
  await page.close()

  const fallback = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  watchErrors(fallback)
  const requests = []
  fallback.on('request', (request) => requests.push(request.url()))
  await fallback.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      if (/^webgl|experimental-webgl/.test(type)) return null
      return original.call(this, type, ...args)
    }
  })
  await fallback.goto(base)
  const contentReady = async (slug) => {
    await expect(fallback.locator('.workbench')).toHaveAttribute('data-slug', slug)
    await expect(fallback.locator('.workbench')).toHaveAttribute('data-status', 'content')
    await expect(fallback.locator('canvas')).toHaveCount(0)
    await expect(fallback.locator('.wb-tools')).toHaveCount(0)
    await expect(fallback.getByText('当前显示商品图文')).toBeVisible()
    await expect
      .poll(() =>
        fallback
          .locator('.wb-fallback-cover')
          .evaluate((img) => img.complete && img.naturalWidth > 0),
      )
      .toBe(true)
  }
  await contentReady('form-01')
  await capture(fallback, 'fallback-1440')
  for (const [slug, name] of [
    ['typewriter-study', '机械打字机'],
    ['reventon', '汽车样板'],
    ['form-01', '桌面音箱'],
  ]) {
    await fallback.getByRole('button', { name: '商品目录', exact: true }).press('Enter')
    await fallback
      .locator('.wb-catalog-list')
      .getByRole('button', { name: new RegExp(name) })
      .press('Enter')
    await contentReady(slug)
    await expect(fallback.getByRole('heading', { level: 1 })).toHaveText(name)
    await expect(fallback.locator('.wb-fallback-details dt')).toHaveCount(3)
  }
  report.checks.push(
    'WebGL unavailable: genuine API covers/descriptions/parts, all three catalog entries, no Canvas or 3D controls',
  )
  for (const width of [390, 320]) {
    await fallback.setViewportSize({ width, height: 844 })
    await expect(fallback.getByRole('button', { name: '浏览其他商品' })).toBeVisible()
    expect(await fallback.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    )
    await capture(fallback, `fallback-${width}`)
    await fallback.getByRole('button', { name: '浏览其他商品' }).click()
    await capture(fallback, `fallback-${width}-catalog`)
    await fallback.getByRole('button', { name: '关闭目录' }).press('Enter')
  }
  await fallback.route('**/api/v1/products/form-01', (route) =>
    route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }),
  )
  await fallback.reload()
  await expect(fallback.locator('.workbench')).toHaveAttribute('data-status', 'error')
  await expect(fallback.locator('.wb-content-fallback')).toHaveCount(0)
  await fallback.unroute('**/api/v1/products/form-01')
  await fallback.getByRole('button', { name: '重新加载', exact: true }).click()
  await contentReady('form-01')
  await fallback.route('**/covers/**', (route) => route.abort())
  await fallback.reload()
  await expect(fallback.getByText('暂无可用封面，仍可阅读下方商品说明。')).toBeVisible()
  await expect(fallback.locator('.wb-fallback-details')).toBeVisible()
  expect(requests.some((url) => /\.(glb|hdr|exr|mp4)(\?|$)|\/gesture\//.test(url))).toBe(false)
  expect(requests.every((url) => new URL(url).origin === new URL(base).origin)).toBe(true)
  report.checks.push(
    'Fallback API 503 remains error and retries; missing image preserves content; same-origin requests, no 3D assets',
  )
  await fallback.close()

  // Permit the capability probe but reject the real renderer context.
  const startup = await browser.newPage()
  watchErrors(startup)
  await startup.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext
    let contexts = 0
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      if (/^webgl|experimental-webgl/.test(type) && ++contexts > 1) return null
      return original.call(this, type, ...args)
    }
  })
  await startup.goto(base)
  await expect(startup.locator('.workbench')).toHaveAttribute('data-status', 'content', {
    timeout: 30000,
  })
  await expect(startup.locator('canvas')).toHaveCount(0)
  await expect(startup.getByText(/三维显示启动失败，已保留商品图文/)).toBeVisible()
  report.checks.push(
    'Actual renderer startup failure also unmounts Canvas and exposes real product content',
  )
  expect(report.errors).toEqual([])
  report.passed = true
} finally {
  await writeFile(`${output}/results.json`, JSON.stringify(report, null, 2))
  await browser.close()
}
console.log(JSON.stringify(report, null, 2))

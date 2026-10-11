/* global fetch, URL, innerHeight, setTimeout */
import { chromium, expect } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { bridge, inputPoint } from './demo/browser-check.mjs'

// Deliberately one real typewriter scene. Product switching is checked in the
// no-WebGL path so this UI regression does not repeat the large asset soak test.
const base = process.env.CHECK_URL || 'http://127.0.0.1:5181'
const output = process.env.UI_FLOW_OUTPUT || 'artifacts/ui-c/flow'
await mkdir(output, { recursive: true })
const response = await fetch(base + '/api/v1/products')
expect(response.ok, 'Real public API must be available').toBe(true)
const catalog = await response.json()
expect(catalog.map((item) => item.slug).sort()).toEqual(
  ['typewriter-study', 'piano-cfx', 'reventon'].sort(),
)
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const report = { passed: false, checks: [], errors: [], captures: [], sizes: [] }
const watched = (page) =>
  page.on('pageerror', (error) => report.errors.push({ url: page.url(), message: error.message }))
const inspector = (page) => page.locator('#wb-inspector')
const command = (page, name) =>
  name === '商品目录'
    ? page.locator('.wb-catalog-trigger')
    : page.getByRole('button', { name, exact: true })
const rail = (page, slug) => page.locator(`.wb-rail button[data-product="${slug}"]`)
const open = async (page, label) => {
  await command(page, label).click()
  await expect(inspector(page)).toBeVisible()
  await expect(inspector(page)).toHaveCSS('opacity', '1')
}
const close = async (page) => {
  await command(page, '收起面板').click()
  await expect(inspector(page)).toHaveCount(0)
}
const snap = (page) =>
  page.evaluate(() => {
    const { scene, store } = window.__demo
    const root = scene.scene.value.children.find((node) => node.userData.workbenchProduct)
    const pose = []
    root.traverse((node) => {
      if (Number.isInteger(node.userData.partId))
        pose.push([node.name, ...node.position.toArray(), ...node.quaternion.toArray()])
    })
    return {
      slug: root.userData.workbenchProduct,
      source: root.userData.sourceKind,
      adapter: root.userData.adapter,
      rootId: root.uuid,
      camera: scene.camera.activeCamera.value.position.toArray(),
      pose,
      finishId: store.finishId,
      selectedPart: store.selectedPart,
      guideStep: store.guideStep,
      sameRenderer: scene.renderer.instance === window.__demo.renderer,
      sameCanvas: document.querySelector('canvas') === window.__demo.canvas,
    }
  })
const capture = async (page, name) => {
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${output}/${name}.png` })
  report.captures.push(name)
}
const fit = async (page, width, height) => {
  await page.setViewportSize({ width, height })
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true)
  const controls = await page.locator('.wb-tools button, .wb-header button').evaluateAll((items) =>
    items
      .filter((item) => item.getBoundingClientRect().width > 0)
      .map((item) => {
        const rect = item.getBoundingClientRect()
        return {
          label: item.getAttribute('aria-label') || item.textContent.trim(),
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          inViewport:
            rect.left >= 0 &&
            rect.right <= innerWidth &&
            rect.top >= 0 &&
            rect.bottom <= innerHeight,
        }
      }),
  )
  expect(
    controls.every((item) => item.inViewport),
    `Core controls fit ${width}x${height}`,
  ).toBe(true)
  report.sizes.push({ width, height, controls })
}

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  watched(page)
  await page.goto(base + '/?product=typewriter-study')
  await expect(page.locator('.workbench')).toHaveAttribute('data-status', 'ready', {
    timeout: 90000,
  })
  await expect(page.locator('canvas')).toHaveCount(1)
  await expect(page.locator('.workbench')).toHaveClass(/wb-floating/)
  await expect(page.locator('.wb-rail button[data-product]')).toHaveCount(catalog.length)
  await expect(rail(page, 'typewriter-study')).toHaveAttribute('aria-pressed', 'true')
  await bridge(page, true)
  const initial = await snap(page)
  expect(initial.slug).toBe('typewriter-study')
  expect(initial.adapter).toBe('typewriter-v1')
  expect(initial.source).toBe('glb')
  expect(initial.pose).toHaveLength(572)
  await capture(page, 'initial-1440')

  await open(page, '外观')
  await page.locator('.wb-finishes button').nth(1).click()
  const changed = await snap(page)
  await close(page)
  expect((await snap(page)).finishId).toBe(changed.finishId)
  await open(page, '结构与动作')
  await command(page, '分层展开').click()
  await command(page, '暂停').click()
  const paused = await snap(page)
  await close(page)
  await open(page, '细节')
  expect((await snap(page)).pose).toEqual(paused.pose)
  expect((await snap(page)).finishId).toBe(changed.finishId)
  await page.getByLabel('查找部件', { exact: true }).fill('A')
  await expect(page.locator('.wb-part-list button')).toHaveCount(2)
  await page.locator('.wb-part-list button').first().click()
  await expect(page.locator('.wb-part-copy')).toBeVisible()
  await capture(page, 'detail-1440')
  await command(page, '返回全景').click()
  await close(page)
  await expect.poll(async () => (await snap(page)).pose).toEqual(initial.pose)
  report.checks.push(
    'Appearance and paused structure survive panel changes; semantic search/focus/overview',
  )

  // Rapid alternating commands must leave a single operable inspector and retain
  // one renderer, instead of waiting for every animation to finish first.
  for (let i = 0; i < 12; i++) {
    await command(page, i % 2 ? '细节' : '外观').click()
    await expect(inspector(page)).toHaveCount(1)
  }
  await expect(inspector(page)).toHaveCSS('opacity', '1')
  await command(page, '外观').click()
  await command(page, '外观').click()
  await expect(inspector(page)).toHaveCount(0)
  expect((await snap(page)).sameCanvas).toBe(true)
  expect((await snap(page)).sameRenderer).toBe(true)
  report.checks.push('Rapid panel switches and same-entry toggle settle; one Canvas/renderer')

  await open(page, '细节')
  const detailButton = command(page, '细节')
  await page.keyboard.press('Escape')
  await expect(inspector(page)).toHaveCount(0)
  await expect(detailButton).toBeFocused()
  const stage = page.getByRole('group', { name: '商品展示区', exact: true })
  await stage.focus()
  const beforeKey = await snap(page)
  await page.keyboard.press('ArrowLeft')
  await expect.poll(async () => (await snap(page)).camera).not.toEqual(beforeKey.camera)
  expect((await snap(page)).pose).toEqual(beforeKey.pose)
  await page.keyboard.press('Home')
  await expect(page.getByLabel('观察视角', { exact: true })).toHaveValue('perspective')
  report.checks.push(
    'Escape restores opener; keyboard orbit changes camera only; Home restores named view',
  )

  await open(page, '导览')
  await command(page, '开始导览').click()
  await stage.focus()
  await page.keyboard.press('ArrowRight')
  await expect(command(page, '开始导览')).toBeVisible()
  await page.waitForTimeout(300)
  const beforeCanvasWheel = await snap(page)
  const point = await inputPoint(page)
  await page.mouse.move(point.x, point.y)
  await page.mouse.wheel(0, 90)
  await expect.poll(async () => (await snap(page)).camera).not.toEqual(beforeCanvasWheel.camera)
  await page.waitForTimeout(300)
  const beforePanelWheel = await snap(page)
  await inspector(page).hover()
  await page.mouse.wheel(0, 200)
  await page.waitForTimeout(300)
  expect((await snap(page)).camera).toEqual(beforePanelWheel.camera)
  await close(page)
  report.checks.push(
    'Keyboard exits guide; actual Canvas wheel works; inspector wheel does not zoom',
  )

  for (const [width, height] of [
    [1280, 720],
    [1440, 1000],
    [1920, 1080],
    [390, 844],
    [320, 844],
  ]) {
    await fit(page, width, height)
    await capture(page, `overview-${width}`)
    await open(page, '结构与动作')
    await command(page, '合拢整机').click()
    await capture(page, `inspector-${width}`)
    await close(page)
  }
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await open(page, '结构与动作')
  await command(page, '平铺部件').click()
  await expect(command(page, '平铺部件')).toHaveAttribute('aria-pressed', 'true')
  await close(page)
  await open(page, '外观')
  await page.keyboard.press('Escape')
  await expect(inspector(page)).toHaveCount(0)
  report.checks.push('Five viewport layouts and reduced-motion operation retain working controls')
  await page.close()

  const fallback = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  watched(fallback)
  const requests = []
  fallback.on('request', (request) => requests.push(request.url()))
  await fallback.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      return /^(webgl|experimental-webgl)/.test(type) ? null : original.call(this, type, ...args)
    }
  })
  await fallback.goto(base + '/?product=typewriter-study')
  await expect(fallback.locator('.workbench')).toHaveAttribute('data-status', 'content')
  await expect(fallback.locator('.wb-rail button[data-product]')).toHaveCount(catalog.length)
  for (const product of catalog) {
    await command(fallback, '商品目录').click()
    await expect(fallback.locator('.wb-catalog-list button')).toHaveCount(catalog.length)
    const escaped = product.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    await fallback
      .locator('.wb-catalog-list')
      .getByRole('button', { name: new RegExp(escaped) })
      .click()
    await expect(fallback.locator('.workbench')).toHaveAttribute('data-slug', product.slug)
    await expect(fallback.locator('.workbench')).toHaveAttribute('data-status', 'content')
    await expect(fallback.locator('h1')).toHaveText(product.name)
    await expect(rail(fallback, product.slug)).toHaveAttribute('aria-pressed', 'true')
  }
  await fallback.goBack()
  await expect(fallback.locator('.workbench')).toHaveAttribute('data-slug', catalog.at(-2).slug)
  await expect(fallback.locator('canvas')).toHaveCount(0)
  await command(fallback, '商品目录').click()
  await fallback.getByRole('textbox', { name: '搜索商品' }).fill('不存在的商品')
  await expect(fallback.getByText('没有找到对应商品，试试其他关键词。')).toBeVisible()
  await expect(fallback.locator('.wb-rail button[data-product]')).toHaveCount(catalog.length)
  await fallback.keyboard.press('Escape')
  await expect(fallback.locator('.wb-catalog-trigger')).toBeFocused()
  await expect(fallback.locator('.wb-rail button[data-product]')).toHaveCount(catalog.length)
  await command(fallback, '商品目录').click()
  await expect(fallback.getByRole('textbox', { name: '搜索商品' })).toHaveValue('不存在的商品')
  await fallback.getByRole('textbox', { name: '搜索商品' }).fill('')
  await expect(fallback.locator('.wb-catalog-list button')).toHaveCount(catalog.length)
  await command(fallback, '关闭目录').click()
  // Catalog filtering must never remove direct product choices. Rapid selection
  // also checks that an older genuine HTTP response cannot replace the final item.
  await fallback.route('**/api/v1/products/typewriter-study', async (route) => {
    const response = await route.fetch()
    await new Promise((resolve) => setTimeout(resolve, 650))
    await route.fulfill({ response })
  })
  for (const slug of ['typewriter-study', 'reventon', 'piano-cfx'])
    await rail(fallback, slug).click()
  await expect(fallback.locator('.workbench')).toHaveAttribute('data-slug', 'piano-cfx')
  await expect(fallback.locator('.workbench')).toHaveAttribute('data-status', 'content')
  await fallback.waitForTimeout(900)
  await expect(fallback.locator('.workbench')).toHaveAttribute('data-slug', 'piano-cfx')
  await expect(fallback.locator('h1')).toHaveText(
    catalog.find((item) => item.slug === 'piano-cfx').name,
  )
  await expect(rail(fallback, 'piano-cfx')).toHaveAttribute('aria-pressed', 'true')
  await expect(fallback.locator('.wb-panel')).toHaveCount(0)
  await fallback.unroute('**/api/v1/products/typewriter-study')
  report.checks.push(
    'Persistent rail stays independent of catalog filters; rapid selections reject late responses',
  )
  expect(requests.some((url) => /\.(glb|hdr|exr|mp4)(\?|$)/.test(url))).toBe(false)
  expect(
    requests
      .filter((url) => /^https?:/.test(url))
      .every((url) => new URL(url).origin === new URL(base).origin),
  ).toBe(true)
  report.checks.push(
    'Real three-product fallback catalog, history, persistent search and same-origin/no 3D assets',
  )
  await fallback.close()
  expect(report.errors).toEqual([])
  report.passed = true
} finally {
  await browser.close()
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2) + '\n')
}
console.log(JSON.stringify(report, null, 2))

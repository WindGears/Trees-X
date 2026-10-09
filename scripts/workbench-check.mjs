/* global URL, setTimeout, fetch */
import { chromium, expect } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'

const base = process.env.CHECK_URL || 'http://127.0.0.1:5181'
const current = await (await fetch(base + '/api/v1/products/typewriter-study')).json()
if (current.presentation?.source.adapter === 'typewriter-v1') {
  await import('./typewriter-check.mjs')
  await import('./typewriter-lifecycle-check.mjs')
  process.exit(0)
}
const output = '.impeccable/review/workbench'
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const report = {
  api: 'Spring Boot / MySQL (real requests)',
  errors: [],
  identities: [],
  checks: [],
  captures: [],
}
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const requests = []
  page.on('pageerror', (e) =>
    report.errors.push({ message: e.message, stack: e.stack, url: page.url() }),
  )
  page.on('request', (r) => requests.push(r.url()))
  const ready = async (slug) => {
    await expect(page.locator('.workbench')).toHaveAttribute('data-slug', slug)
    await expect(page.locator('.workbench')).toHaveAttribute('data-status', 'ready', {
      timeout: 30000,
    })
    await expect(page.locator('canvas')).toHaveCount(1)
    await page.evaluate(() => {
      let component = document.querySelector('canvas').__vueParentComponent
      while (component) {
        const context =
          component.exposed?.context ??
          Reflect.ownKeys(component.provides ?? {})
            .map((k) => component.provides[k])
            .find((v) => v?.scene?.value?.isScene)
        if (context) {
          window.__wb = context
          return
        }
        component = component.parent
      }
      throw new Error('No real Three context found')
    })
    const identity = await page.evaluate(() => {
      const roots = window.__wb.scene.value.children.filter((o) => o.userData.workbenchProduct)
      const nodes = []
      roots[0]?.traverse((o) => {
        if (o.name) nodes.push(o.name)
      })
      return { slugs: roots.map((o) => o.userData.workbenchProduct), nodes }
    })
    expect(identity.slugs).toEqual([slug])
    expect(identity.nodes.length).toBeGreaterThan(3)
    return identity
  }
  const state = () =>
    page.evaluate(() => {
      const c = window.__wb,
        root = c.scene.value.children.find((o) => o.userData.workbenchProduct)
      const nodes = {}
      root?.traverse((o) => {
        if (o.name)
          nodes[o.name] = {
            position: o.position.toArray(),
            rotation: [o.rotation.x, o.rotation.y, o.rotation.z],
          }
      })
      return { camera: c.camera.activeCamera.value.position.toArray(), nodes }
    })
  const capture = async (name) => {
    await page.waitForTimeout(300)
    await page.screenshot({ path: `${output}/${name}.png` })
    report.captures.push(name)
  }
  const choose = async (name) => {
    await page.getByRole('button', { name: '商品目录', exact: true }).click()
    await page
      .locator('.wb-catalog-list')
      .getByRole('button', { name: new RegExp(name) })
      .click()
  }
  const expand = async () => {
    const progress = page.locator('.wb-progress')
    if (await progress.count()) {
      const slug = await page.locator('.workbench').getAttribute('data-slug')
      if (slug === 'form-01')
        await progress.getByRole('button', { name: '展开', exact: true }).click()
      else await page.getByRole('button', { name: '展开部件', exact: true }).click()
    } else await page.getByRole('button', { name: '展开部件', exact: true }).click()
  }
  await page.goto(base + '/?product=form-01')
  report.identities.push(await ready('form-01'))
  await page.evaluate(() => {
    window.__wbCanvas = document.querySelector('canvas')
    window.__wbRenderer = window.__wb.renderer.instance
  })
  const initial = await state()
  await capture('speaker-1440')
  await page.getByRole('button', { name: '外观', exact: true }).click()
  await page.locator('.wb-finishes button').nth(1).click()
  await page.getByRole('button', { name: '收起面板' }).click()
  expect((await state()).camera).toEqual(initial.camera)
  await page.getByRole('button', { name: '结构与动作', exact: true }).click()
  await page.locator('.wb-action-list button').first().click()
  await expand()
  await page.waitForTimeout(700)
  const exploded = await state()
  expect(exploded.nodes.knob.rotation).not.toEqual(initial.nodes.knob.rotation)
  expect(exploded.nodes.front.position).not.toEqual(initial.nodes.front.position)
  await page.getByRole('button', { name: '复位视角', exact: true }).click()
  const paused = await state()
  await page.waitForTimeout(700)
  expect((await state()).nodes.front.position).toEqual(paused.nodes.front.position)
  await page.getByRole('button', { name: '还原商品', exact: true }).click()
  await page.waitForTimeout(700)
  expect((await state()).nodes.front).toEqual(initial.nodes.front)
  await page.getByRole('button', { name: '细节', exact: true }).click()
  await page.locator('.wb-part-list button').first().click()
  await page.waitForTimeout(700)
  expect((await state()).camera).not.toEqual(initial.camera)
  await capture('speaker-detail-1440')
  await page.getByRole('button', { name: '导览', exact: true }).click()
  await page.getByRole('button', { name: '开始导览' }).click()
  await page.getByRole('button', { name: '下一步' }).click()
  await page.getByRole('button', { name: '退出导览，保留当前观察' }).click()
  const exitPose = (await state()).camera
  await page.waitForTimeout(750)
  expect((await state()).camera).toEqual(exitPose)
  await page.getByRole('button', { name: '开始导览' }).click()
  await page.getByRole('button', { name: '下一步' }).click()
  const bounds = await page.locator('canvas').boundingBox()
  await page.mouse.move(bounds.x + bounds.width * 0.8, bounds.y + bounds.height * 0.45)
  await page.mouse.down()
  await page.mouse.move(bounds.x + bounds.width * 0.64, bounds.y + bounds.height * 0.45, {
    steps: 10,
  })
  await page.mouse.up()
  await expect(page.getByRole('button', { name: '开始导览' })).toBeVisible()
  const dragged = (await state()).camera
  await page.waitForTimeout(750)
  expect((await state()).camera).toEqual(dragged)
  await page.mouse.wheel(0, 240)
  expect((await state()).camera).not.toEqual(dragged)
  const wheelPose = (await state()).camera
  await page.locator('.wb-panel').hover()
  await page.mouse.wheel(0, 240)
  expect((await state()).camera).toEqual(wheelPose)
  report.checks.push(
    'actual geometry identity; appearance; independent camera/product resets; guide exit, drag and wheel takeover; panel wheel isolation',
  )
  for (const [slug, name, node] of [
    ['typewriter-study', '机械打字机', 'lever'],
    ['reventon', '汽车样板', 'door-left'],
    ['form-01', '桌面音箱', 'knob'],
  ]) {
    await choose(name)
    report.identities.push(await ready(slug))
    await page.getByRole('button', { name: '结构与动作', exact: true }).click()
    const before = await state()
    if (slug === 'typewriter-study') {
      await page.evaluate(() => {
        window.__pulseRotations = []
        const off = window.__wb.renderer.onRender(() =>
          window.__pulseRotations.push(window.__wb.scene.value.getObjectByName('lever').rotation.x),
        )
        window.__pulseOff = off.off
      })
      await page.locator('.wb-action-list button').first().click()
      await page.waitForTimeout(550)
      expect(
        await page.evaluate(() => {
          window.__pulseOff()
          return Math.min(...window.__pulseRotations)
        }),
      ).toBeLessThan(-0.2)
      expect((await state()).nodes[node]).toEqual(before.nodes[node])
    } else {
      await page.locator('.wb-action-list button').first().click()
      await page.waitForTimeout(650)
      expect((await state()).nodes[node].rotation).not.toEqual(before.nodes[node].rotation)
    }
    await expand()
    await page.waitForTimeout(650)
    await capture(`${slug}-actions-1440`)
    await page.getByRole('button', { name: '导览', exact: true }).click()
    await page.getByRole('button', { name: '开始导览' }).click()
    for (let i = 0; i < 3; i++) await page.getByRole('button', { name: '下一步' }).click()
    await page.getByRole('button', { name: '完成导览', exact: true }).click()
    await page.waitForTimeout(700)
    expect((await state()).nodes).toEqual(before.nodes)
    expect(
      await page.evaluate(
        () =>
          document.querySelector('canvas') === window.__wbCanvas &&
          window.__wb.renderer.instance === window.__wbRenderer,
      ),
    ).toBe(true)
  }
  report.checks.push('all 3 actions and 4-step guides; one persistent Canvas and renderer')
  await page.goBack()
  await ready('reventon')
  await page.goForward()
  await ready('form-01')
  await page.route('**/api/v1/products/typewriter-study', async (route) => {
    const response = await route.fetch()
    await new Promise((r) => setTimeout(r, 800))
    await route.fulfill({ response })
  })
  await choose('机械打字机')
  await choose('汽车样板')
  await ready('reventon')
  await page.waitForTimeout(1000)
  await ready('reventon')
  await page.unroute('**/api/v1/products/typewriter-study')
  let fail = true
  await page.route('**/api/v1/products/form-01', (route) =>
    fail ? route.fulfill({ status: 503, body: 'unavailable' }) : route.continue(),
  )
  await choose('桌面音箱')
  await expect(page.locator('.workbench')).toHaveAttribute('data-status', 'error')
  expect(
    await page.evaluate(
      () => window.__wb.scene.value.children.filter((o) => o.userData.workbenchProduct).length,
    ),
  ).toBe(0)
  fail = false
  await page.getByRole('button', { name: '重新加载', exact: true }).click()
  await ready('form-01')
  await page.unroute('**/api/v1/products/form-01')
  await page.route('**/api/v1/products/typewriter-study', async (route) => {
    const response = await route.fetch(),
      json = await response.json()
    json.presentation.hotspots[0].node = 'missing-node'
    await route.fulfill({ json })
  })
  await choose('机械打字机')
  await expect(page.locator('.workbench')).toHaveAttribute('data-status', 'error')
  await page.unroute('**/api/v1/products/typewriter-study')
  await page.getByRole('button', { name: '重新加载', exact: true }).click()
  await ready('typewriter-study')
  await page.evaluate(() => {
    const gl = document.querySelector('canvas').getContext('webgl2')
    window.__lose = gl.getExtension('WEBGL_lose_context')
    window.__lose.loseContext()
  })
  await expect(page.locator('.workbench')).toHaveAttribute('data-status', 'error')
  await page.waitForTimeout(250)
  await page.evaluate(() => window.__lose.restoreContext())
  await ready('typewriter-study')
  expect(
    await page.evaluate(
      () =>
        document.querySelector('canvas') === window.__wbCanvas &&
        window.__wb.renderer.instance === window.__wbRenderer,
    ),
  ).toBe(true)
  report.checks.push(
    'back/forward; delayed rapid selection; API failure retry; missing model-node retry; WebGL loss/recovery preserves renderer',
  )
  // Capture the complete initial review matrix in one batch.
  for (const [slug, name] of [
    ['form-01', '桌面音箱'],
    ['typewriter-study', '机械打字机'],
    ['reventon', '汽车样板'],
  ]) {
    await choose(name)
    await ready(slug)
    for (const [width, height] of [
      [1280, 720],
      [1440, 1000],
      [1920, 1080],
    ]) {
      await page.setViewportSize({ width, height })
      await page.waitForTimeout(250)
      await capture(`${slug}-${width}`)
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.getByRole('button', { name: '商品目录', exact: true }).click()
  await capture('catalog-1440')
  await page.getByRole('textbox', { name: '搜索商品' }).fill('不存在')
  await expect(page.getByText('没有找到对应商品，试试其他关键词。')).toBeVisible()
  await page.getByRole('textbox', { name: '搜索商品' }).fill('')
  await expect(page.locator('.wb-catalog-list button')).toHaveCount(3)
  await page.getByLabel('商品分类', { exact: true }).selectOption('机械')
  await expect(page.locator('.wb-catalog-list button')).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: '商品目录', exact: true })).toBeFocused()
  report.checks.push('catalog search/category/empty states and keyboard close')
  expect(requests.some((url) => /\.(glb|hdr|exr|mp4)(\?|$)|\/gesture\//.test(url))).toBe(false)
  const localOrigin = new URL(base).origin
  expect(requests.every((url) => new URL(url).origin === localOrigin)).toBe(true)
  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
    reducedMotion: 'reduce',
  })
  mobile.on('pageerror', (e) =>
    report.errors.push({ message: e.message, stack: e.stack, url: mobile.url() }),
  )
  await mobile.goto(`${base}/?product=typewriter-study`)
  await expect(mobile.locator('.workbench')).toHaveAttribute('data-status', 'ready', {
    timeout: 30000,
  })
  for (const width of [390, 320]) {
    await mobile.setViewportSize({ width, height: 844 })
    await mobile.screenshot({ path: `${output}/mobile-${width}.png` })
    report.captures.push(`mobile-${width}`)
    await mobile.getByRole('button', { name: '结构与动作', exact: true }).click()
    await mobile.getByRole('button', { name: '展开部件', exact: true }).click()
    await mobile.screenshot({ path: `${output}/mobile-${width}-panel.png` })
    report.captures.push(`mobile-${width}-panel`)
    expect(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    )
    await mobile.getByRole('button', { name: '还原商品', exact: true }).click()
    await mobile.getByRole('button', { name: '收起面板' }).click()
  }
  await mobile.close()
  await page.goto(`${base}/?product=missing-sample`)
  await expect(page.getByText('未找到该商品，请从目录重新选择。')).toBeVisible()
  await page.goto(`${base}/?legacy=1&product=form-01`)
  await expect(page.locator('.product-viewer')).toBeVisible({ timeout: 30000 })
  await expect(page.locator('.workbench')).toHaveCount(0)
  await page.goto(`${base}/?product=potted-plant`)
  await expect(page.locator('.product-viewer')).toBeVisible({ timeout: 30000 })
  await expect(page.locator('.workbench')).toHaveCount(0)
  report.checks.push(
    '390px/320px/reduced-motion; unknown deep link; legacy explicit and old-id routing; new workbench never requests high-resolution legacy assets',
  )
  expect(report.errors).toEqual([])
  report.passed = true
} finally {
  await writeFile(`${output}/results.json`, JSON.stringify(report, null, 2))
  await browser.close()
}
console.log(JSON.stringify(report, null, 2))

/* global setTimeout, fetch, URL, AbortSignal */
import { chromium, expect } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
const base = process.env.CHECK_URL || 'http://127.0.0.1:5181'
const output = process.env.TYPEWRITER_LIFECYCLE_OUTPUT || 'artifacts/typewriter-migration/lifecycle'
await mkdir(output, { recursive: true })
const catalogResponse = await fetch(new URL('/api/v1/products', base), {
  signal: AbortSignal.timeout(60000),
})
expect(catalogResponse.ok, 'Real product catalog is available').toBe(true)
const catalog = await catalogResponse.json()
const productNames = new Map(catalog.map((product) => [product.slug, product.name]))
for (const slug of ['typewriter-study', 'piano-cfx', 'reventon'])
  expect(productNames.get(slug), `Published catalog includes ${slug}`).toBeTruthy()
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const report = {
  passed: false,
  checks: [],
  memory: [],
  pianoMemory: [],
  errors: [],
  picking: null,
}
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.on('pageerror', (error) => report.errors.push(error.message))
  const ready = async (slug) => {
    console.log(`Waiting for actual ${slug}`)
    await expect(page.locator('.workbench')).toHaveAttribute('data-slug', slug)
    await expect(page.locator('.workbench')).toHaveAttribute('data-status', 'ready', {
      timeout: 90000,
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
      // Production Vue omits the DOM component backlink, but retains the real VNode tree.
      // Inspect that tree without enabling devtools or creating a replacement scene.
      const seen = new Set()
      const visit = (vnode) => {
        if (!vnode || typeof vnode !== 'object' || seen.has(vnode)) return false
        seen.add(vnode)
        const current = vnode.component
        if (current) {
          const context =
            current.exposed?.context ??
            Reflect.ownKeys(current.provides ?? {})
              .map((key) => current.provides[key])
              .find((value) => value?.scene?.value?.isScene)
          if (context?.scene?.value?.isScene) {
            window.__wb = context
            return true
          }
          if (visit(current.subTree)) return true
        }
        if (Array.isArray(vnode.children) && vnode.children.some(visit)) return true
        return visit(vnode.suspense?.activeBranch)
      }
      if (visit(document.querySelector('#app')?._vnode)) return
      throw new Error('No actual Three scene')
    })
    const identity = await page.evaluate(() =>
      window.__wb.scene.value.children
        .filter((n) => n.userData.workbenchProduct)
        .map((n) => n.userData.workbenchProduct),
    )
    expect(identity).toEqual([slug])
    console.log(`Ready: ${slug}`)
  }
  const pose = () =>
    page.evaluate(() => {
      const root = window.__wb.scene.value.children.find((n) => n.userData.workbenchProduct)
      const parts = []
      root.traverse((n) => {
        if (Number.isInteger(n.userData.partId))
          parts.push([n.name, ...n.position.toArray(), ...n.quaternion.toArray()])
      })
      return parts
    })
  const stable = async () => {
    await expect(page.getByRole('button', { name: '继续', exact: true })).toBeVisible()
    const value = await pose()
    await page.waitForTimeout(250)
    expect(await pose()).toEqual(value)
    return value
  }
  const choose = async (slug) => {
    const name = productNames.get(slug)
    expect(name, `Catalog name for ${slug}`).toBeTruthy()
    await page.getByRole('button', { name: '商品目录', exact: true }).click()
    await page
      .locator('.wb-catalog-list')
      .getByRole('button', { name: new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) })
      .click()
  }
  const studioMemory = () =>
    page.evaluate(() => {
      const scene = window.__wb.scene.value,
        renderer = window.__wb.renderer.instance,
        studios = [],
        reflections = []
      scene.traverse((node) => {
        if (node.name === 'Trees X / product studio') studios.push(node.uuid)
        if (node.name === 'Trees X / studio reflection') reflections.push(node.uuid)
      })
      return {
        ...renderer.info.memory,
        programs: renderer.info.programs.length,
        studios: studios.length,
        reflections: reflections.length,
        sameCanvas: document.querySelector('canvas') === window.__initialCanvas,
        sameRenderer: renderer === window.__initialRenderer,
      }
    })
  await page.goto(base)
  await ready('typewriter-study')
  await page.evaluate(() => {
    window.__initialCanvas = document.querySelector('canvas')
    window.__initialRenderer = window.__wb.renderer.instance
  })
  const initial = await pose()
  await page.getByRole('button', { name: '商品目录', exact: true }).click()
  await expect(page.locator('.wb-catalog-list')).not.toContainText('桌面音箱')
  await page.getByRole('button', { name: '关闭目录', exact: true }).click()
  await page.getByRole('button', { name: '结构与动作', exact: true }).click()
  const play = async () => {
    await page.getByRole('button', { name: '复原动作', exact: true }).click()
    await page.getByRole('button', { name: '平铺部件', exact: true }).click()
    await page.waitForTimeout(120)
    await expect(page.getByRole('button', { name: '暂停', exact: true })).toBeVisible()
  }
  await play()
  const bounds = await page.locator('canvas').boundingBox()
  await page.mouse.move(bounds.x + bounds.width * 0.75, bounds.y + bounds.height * 0.55)
  await page.mouse.wheel(0, 80)
  await stable()
  await play()
  await page.mouse.down()
  await page.mouse.move(bounds.x + bounds.width * 0.69, bounds.y + bounds.height * 0.5, {
    steps: 5,
  })
  await page.mouse.up()
  await stable()
  await play()
  await page.getByRole('group', { name: '商品展示区', exact: true }).focus()
  await page.keyboard.press('ArrowLeft')
  await stable()
  await play()
  await page.getByLabel('观察视角', { exact: true }).selectOption('front')
  await stable()
  await play()
  await page.getByRole('button', { name: '细节', exact: true }).click()
  await page.getByLabel('查找部件', { exact: true }).fill('part-070')
  await page.locator('.wb-part-list button').first().click()
  await page.getByRole('button', { name: '结构与动作', exact: true }).click()
  await stable()
  report.checks.push(
    'Wheel, drag, keyboard, named view and focus pause structure; input retains current pose',
  )
  await play()
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  const hidden = await stable()
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  expect(await stable()).toEqual(hidden)
  await page.evaluate(() => {
    window.__loss = window.__wb.renderer.instance.getContext().getExtension('WEBGL_lose_context')
    if (!window.__loss) throw new Error('Actual context-loss extension unavailable')
    window.__loss.loseContext()
  })
  await expect(page.locator('.workbench')).toHaveAttribute('data-status', 'error')
  await page.waitForTimeout(200)
  await page.evaluate(() => window.__loss.restoreContext())
  await ready('typewriter-study')
  expect(await stable()).toEqual(hidden)
  report.checks.push(
    'Synthetic visibility pause; actual WebGL loss/recovery retains all 572 poses, stays paused',
  )
  await page.getByRole('button', { name: '平铺部件', exact: true }).click()
  await expect(page.getByRole('button', { name: '平铺部件', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
    { timeout: 10000 },
  )
  await page.getByRole('button', { name: '平铺俯视', exact: true }).first().click()
  await page.getByRole('button', { name: '收起面板', exact: true }).click()
  await page.waitForTimeout(850)
  await page.addStyleTag({ content: '.wb-hotspots { pointer-events: none !important; }' })
  const click = await page.evaluate(() => {
    const root = window.__wb.scene.value.children.find((n) => n.userData.workbenchProduct)
    const node = root.getObjectByName('part-070'),
      camera = window.__wb.camera.activeCamera.value
    const point = node.getWorldPosition(camera.position.clone()).project(camera)
    const rect = document.querySelector('canvas').getBoundingClientRect()
    return {
      x: rect.left + (point.x * 0.5 + 0.5) * rect.width,
      y: rect.top + (-point.y * 0.5 + 0.5) * rect.height,
    }
  })
  await page.mouse.click(click.x, click.y)
  await expect(page.locator('.wb-part-copy h3')).toHaveText('按键 · 24 · A')
  report.picking = click
  report.checks.push(
    'Actual instance raycast selects stable part-070, with hotspot pointer overlay disabled',
  )
  await page.getByRole('button', { name: '返回全景', exact: true }).click()
  await page.getByRole('button', { name: '外观', exact: true }).click()
  const color = () =>
    page.evaluate(() => {
      const root = window.__wb.scene.value.children.find((n) => n.userData.workbenchProduct)
      let result
      root.traverse((n) => {
        if (n.material?.name === 'enamel') result = n.material.color.getHexString()
      })
      return result
    })
  const black = await color()
  await page.getByRole('button', { name: '象牙白漆面', exact: true }).click()
  await expect.poll(color).not.toBe(black)
  await page.getByRole('button', { name: '还原商品', exact: true }).click()
  await expect.poll(color).toBe(black)
  await page.getByRole('button', { name: '导览', exact: true }).click()
  await page.getByRole('button', { name: '开始导览', exact: true }).click()
  await page.getByRole('group', { name: '商品展示区', exact: true }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('button', { name: '开始导览', exact: true })).toBeVisible()
  report.checks.push(
    'Real finish changes material; restore returns finish; user observation exits guide',
  )
  report.beforePiano = await studioMemory()
  for (let i = 0; i < 3; i++) {
    await choose('piano-cfx')
    await ready('piano-cfx')
    const piano = await studioMemory()
    expect(piano.studios).toBe(0)
    expect(piano.reflections).toBe(0)
    expect(piano.sameCanvas && piano.sameRenderer).toBe(true)
    await choose('typewriter-study')
    await ready('typewriter-study')
    expect(await pose()).toEqual(initial)
    const memory = await studioMemory()
    expect(memory.studios).toBe(1)
    expect(memory.reflections).toBe(1)
    expect(memory.sameCanvas && memory.sameRenderer).toBe(true)
    report.pianoMemory.push(memory)
  }
  expect(report.pianoMemory[2]).toEqual(report.pianoMemory[1])
  report.checks.push(
    'Three actual piano/typewriter cycles remove and recreate one studio; memory stable after warmup',
  )
  for (let i = 0; i < 3; i++) {
    await choose('reventon')
    await ready('reventon')
    await choose('typewriter-study')
    await ready('typewriter-study')
    expect(await pose()).toEqual(initial)
    report.memory.push(
      await page.evaluate(() => ({
        ...window.__wb.renderer.instance.info.memory,
        programs: window.__wb.renderer.instance.info.programs.length,
      })),
    )
  }
  expect(report.memory[2]).toEqual(report.memory[1])
  await page.goBack()
  await ready('reventon')
  await page.goForward()
  await ready('typewriter-study')
  await page.route('**/api/v1/products/reventon', async (route) => {
    const response = await route.fetch()
    await new Promise((resolve) => setTimeout(resolve, 700))
    await route.fulfill({ response }).catch(() => {})
  })
  await choose('reventon')
  await choose('typewriter-study')
  await ready('typewriter-study')
  await page.waitForTimeout(800)
  await ready('typewriter-study')
  await page.unroute('**/api/v1/products/reventon')
  report.checks.push(
    'Three real car/typewriter cycles, late selection, browser back/forward; memory stable after warmup',
  )
  await choose('reventon')
  await ready('reventon')
  await page.route('**/models/bundles/kimi-typewriter/v1/model.glb', (route) =>
    route.abort('failed'),
  )
  await choose('typewriter-study')
  await expect(page.locator('.workbench')).toHaveAttribute('data-status', 'error', {
    timeout: 30000,
  })
  expect(
    await page.evaluate(
      () => window.__wb.scene.value.children.filter((n) => n.userData.workbenchProduct).length,
    ),
  ).toBe(0)
  await page.unroute('**/models/bundles/kimi-typewriter/v1/model.glb')
  await page.getByRole('button', { name: '重新加载', exact: true }).click()
  await ready('typewriter-study')
  expect(await pose()).toEqual(initial)
  expect(
    await page.evaluate(
      () =>
        document.querySelector('canvas') === window.__initialCanvas &&
        window.__wb.renderer.instance === window.__initialRenderer,
    ),
  ).toBe(true)
  report.checks.push(
    'GLB download failure clears old model; retry recovers; same Canvas and renderer throughout',
  )
  expect(report.errors).toEqual([])
  report.passed = true
} catch (error) {
  report.failure = String(error)
  throw error
} finally {
  await browser.close()
  await writeFile(output + '/report.json', JSON.stringify(report, null, 2) + '\n')
}
console.log(JSON.stringify(report))

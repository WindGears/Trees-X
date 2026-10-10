/* global URL, setTimeout, structuredClone, performance */
import { chromium, expect } from '@playwright/test'
import { readFile, mkdir, writeFile } from 'node:fs/promises'

const base = process.env.CHECK_URL || 'http://127.0.0.1:5181'
const output = '.impeccable/review/asset-ingestion'
await mkdir(output, { recursive: true })
const fixture = JSON.parse(
  await readFile('server/src/test/resources/fixtures/speaker-glb-v2.json', 'utf8'),
)
const samples = JSON.parse(
  await readFile('server/src/main/resources/samples/products.json', 'utf8'),
)
const procedural = samples.find((p) => p.slug === 'typewriter-study')
const car = samples.find((p) => p.slug === 'reventon')
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const report = {
  scope: 'real GLB + real Three; controlled v1/v2 API fixtures, formal catalog remains unchanged',
  errors: [],
  checks: [],
  captures: [],
  external: [],
  memories: [],
}
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  await page.route('**/api/v1/products/typewriter-study', (route) =>
    route.fulfill({ json: procedural }),
  )
  await page.route('**/api/v1/products/reventon', (route) => route.fulfill({ json: car }))
  await page.route('**/api/v1/products?*', (route) =>
    route.fulfill({ json: [fixture, procedural, car] }),
  )
  page.on('pageerror', (e) => report.errors.push(e.message))
  page.on('request', (r) => {
    if (/^https?:/.test(r.url()) && new URL(r.url()).origin !== new URL(base).origin)
      report.external.push(r.url())
  })
  let broken = false,
    customStage = false
  await page.route('**/api/v1/products/form-01', (route) => {
    const value = structuredClone(fixture)
    if (broken) value.presentation.hotspots[0].node = 'missing-node'
    if (customStage) {
      value.presentation.stage.key.position = [6, 8, 2]
      value.presentation.stage.rim.position = [-6, 4, -3]
      value.presentation.stage.groundY = -0.1
      value.presentation.stage.background = '#18251f'
    }
    return route.fulfill({ json: value })
  })
  const host = page.locator('.workbench')
  async function ready(slug = 'form-01') {
    await expect(host).toHaveAttribute('data-slug', slug)
    await expect(host).toHaveAttribute('data-status', 'ready', { timeout: 45000 })
    await expect(page.locator('canvas')).toHaveCount(1)
    return page.evaluate(() => {
      let c = document.querySelector('canvas').__vueParentComponent
      while (c) {
        const context =
          c.exposed?.context ??
          Reflect.ownKeys(c.provides ?? {})
            .map((k) => c.provides[k])
            .find((v) => v?.scene?.value?.isScene)
        if (context) {
          window.__assetContext = context
          const roots = context.scene.value.children.filter((o) => o.userData.workbenchProduct)
          return roots.map((r) => ({ ...r.userData, nodes: r.children.length }))
        }
        c = c.parent
      }
      throw new Error('Missing actual Three context')
    })
  }
  async function select(name) {
    await page.getByRole('button', { name: '商品目录', exact: true }).click()
    await page.locator('.wb-catalog-list button').filter({ hasText: name }).click()
  }
  async function capture(name) {
    await page.waitForTimeout(250)
    await page.screenshot({ path: `${output}/${name}.png` })
    report.captures.push(name)
  }
  const start = performance.now()
  await page.goto(base + '/?product=form-01')
  const identity = await ready()
  report.coldLoadMs = performance.now() - start
  expect(identity).toHaveLength(1)
  expect(identity[0].assetBundle).toBe('speaker-engineering@1')
  expect(identity[0].triangles).toBe(15924)
  await page.evaluate(() => {
    window.__assetCanvas = document.querySelector('canvas')
    window.__assetRenderer = window.__assetContext.renderer.instance
  })
  await capture('speaker-glb-overview')
  await page.getByRole('button', { name: '结构与动作', exact: true }).click()
  const pose = () =>
    page.evaluate(() => {
      const root = window.__assetContext.scene.value.children.find(
        (n) => n.userData.workbenchProduct,
      )
      return {
        knob: root.getObjectByName('Volume_Dial').quaternion.toArray(),
        front: root.getObjectByName('Front_Baffle').position.toArray(),
      }
    })
  const initial = await pose()
  await page.getByRole('button', { name: /转动旋钮/ }).click()
  await page.getByRole('button', { name: '展开部件', exact: true }).click()
  await page.waitForTimeout(700)
  expect((await pose()).knob).not.toEqual(initial.knob)
  expect((await pose()).front).not.toEqual(initial.front)
  await capture('speaker-glb-action')
  await page.getByRole('button', { name: '收起面板', exact: true }).click()
  await page.getByRole('button', { name: '细节', exact: true }).click()
  await page.locator('.wb-part-list button').first().click()
  await page.waitForTimeout(700)
  await capture('speaker-glb-detail')
  await page.getByRole('button', { name: '返回全景', exact: true }).click()
  await page.waitForTimeout(700)
  expect(await pose()).toEqual(initial)
  report.checks.push(
    'real GLB identity, 15,924 triangles, named hotspot, knob, explosion, reset without drift',
  )
  for (let i = 0; i < 3; i++) {
    await select('机械打字机')
    expect((await ready('typewriter-study'))[0].sourceKind).toBe('procedural')
    await select('桌面音箱')
    expect((await ready())[0].sourceKind).toBe('glb')
    report.memories.push(await page.evaluate(() => ({ ...window.__assetRenderer.info.memory })))
  }
  expect(report.memories[2]).toEqual(report.memories[0])
  expect(
    await page.evaluate(
      () =>
        document.querySelector('canvas') === window.__assetCanvas &&
        window.__assetContext.renderer.instance === window.__assetRenderer,
    ),
  ).toBe(true)
  report.checks.push(
    'v1/v2 switching reuses renderer; stable geometry/texture counts after three cycles',
  )
  await select('机械打字机')
  await ready('typewriter-study')
  customStage = true
  await select('桌面音箱')
  await ready()
  const stage = await page.evaluate(() => {
    const scene = window.__assetContext.scene.value,
      group = scene.getObjectByName('workbench-lighting')
    return {
      lights: group.children
        .filter((node) => node.isDirectionalLight)
        .map((node) => node.position.toArray()),
      groundY: group.children.find((node) => node.isMesh).position.y,
      background: scene.background.getHexString(),
      fog: scene.fog.color.getHexString(),
    }
  })
  expect(stage).toEqual({
    lights: [
      [6, 8, 2],
      [-6, 4, -3],
    ],
    groundY: -0.1,
    background: '18251f',
    fog: '18251f',
  })
  customStage = false
  report.checks.push(
    'product stage updates actual light/ground positions and matched background/fog',
  )
  await select('汽车样板')
  await ready('reventon')
  broken = true
  await select('桌面音箱')
  await expect(host).toHaveAttribute('data-status', 'error')
  await expect(page.getByRole('alert')).toContainText('missing-node')
  broken = false
  await page.getByRole('button', { name: '重新加载', exact: true }).click()
  await ready()
  report.checks.push('failed node binding releases loaded GLB; retry succeeds')
  await select('汽车样板')
  await ready('reventon')
  let started
  const requested = new Promise((r) => {
    started = r
  })
  await page.route('**/models/bundles/speaker-engineering/v1/model.glb', async (route) => {
    started()
    await new Promise((r) => setTimeout(r, 900))
    await route.continue().catch(() => {})
  })
  await select('桌面音箱')
  await requested
  await expect(host).toHaveAttribute('data-status', 'loading')
  await expect(page.locator('.wb-hotspots')).toHaveCount(0)
  await select('机械打字机')
  await ready('typewriter-study')
  await page.waitForTimeout(1100)
  expect((await ready('typewriter-study'))[0].workbenchProduct).toBe('typewriter-study')
  await page.unroute('**/models/bundles/speaker-engineering/v1/model.glb')
  report.checks.push(
    'cancel during real GLB download: old result cannot replace selection; no early controls/hotspots',
  )
  await select('桌面音箱')
  await ready()
  await page.evaluate(() => {
    const extension = window.__assetRenderer.getContext().getExtension('WEBGL_lose_context')
    extension.loseContext()
    setTimeout(() => extension.restoreContext(), 150)
  })
  await expect(host).toHaveAttribute('data-status', 'error')
  await ready()
  expect(
    await page.evaluate(() => window.__assetRenderer === window.__assetContext.renderer.instance),
  ).toBe(true)
  report.checks.push('GLB context recovery keeps one renderer')
  for (const width of [1280, 1920, 390, 320]) {
    await page.setViewportSize({ width, height: width < 500 ? 844 : width === 1280 ? 720 : 1080 })
    await capture('speaker-glb-' + width)
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
  }
  expect(report.errors).toEqual([])
  expect(report.external).toEqual([])
  report.passed = true
} catch (error) {
  report.failure = String(error)
  throw error
} finally {
  await writeFile(output + '/browser.json', JSON.stringify(report, null, 2))
  await browser.close()
}
console.log(JSON.stringify(report, null, 2))

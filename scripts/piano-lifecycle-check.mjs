/* global fetch, setTimeout */
import { chromium, expect } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'

const base = process.env.CHECK_URL || 'http://127.0.0.1:5181'
const output = process.env.PIANO_LIFECYCLE_OUTPUT || 'artifacts/piano-migration/lifecycle'
const report = {
  passed: false,
  fixture: false,
  checks: [],
  errors: [],
  memory: [],
  failedRequests: [],
}
await mkdir(output, { recursive: true })
const catalogResponse = await fetch(base + '/api/v1/products')
expect(catalogResponse.status).toBe(200)
const catalog = await catalogResponse.json()
expect(catalog.map((product) => product.slug).sort()).toEqual([
  'piano-cfx',
  'reventon',
  'typewriter-study',
])
const browser = await chromium.launch({ channel: 'msedge', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.on('pageerror', (error) => report.errors.push(error.message))
  page.on('requestfailed', (request) =>
    report.failedRequests.push({ url: request.url(), reason: request.failure()?.errorText }),
  )
  const scene = async () => {
    await page.evaluate(() => {
      let component = document.querySelector('canvas').__vueParentComponent
      while (component) {
        const context =
          component.exposed?.context ??
          Reflect.ownKeys(component.provides ?? {})
            .map((key) => component.provides[key])
            .find((value) => value?.scene?.value?.isScene)
        if (context) {
          window.__pianoLifecycleScene = context
          return
        }
        component = component.parent
      }
      throw new Error('Actual Three scene unavailable')
    })
  }
  const identity = () =>
    page.evaluate(() => ({
      products: window.__pianoLifecycleScene.scene.value.children
        .filter((node) => node.userData.workbenchProduct)
        .map((node) => node.userData.workbenchProduct),
      sameCanvas: document.querySelector('canvas') === window.__pianoLifecycleCanvas,
      sameRenderer:
        window.__pianoLifecycleScene.renderer.instance === window.__pianoLifecycleRenderer,
    }))
  const ready = async (slug) => {
    await expect(page.locator('.workbench')).toHaveAttribute('data-slug', slug)
    await expect(page.locator('.workbench')).toHaveAttribute('data-status', 'ready', {
      timeout: 120000,
    })
    await expect(page.locator('canvas')).toHaveCount(1)
    await scene()
    expect((await identity()).products).toEqual([slug])
  }
  const retained = async (slug) => {
    const current = await identity()
    expect(current).toEqual({ products: [slug], sameCanvas: true, sameRenderer: true })
  }
  const choose = async (slug, wait = true) => {
    const product = catalog.find((entry) => entry.slug === slug)
    await page.getByRole('button', { name: '商品目录', exact: true }).click()
    await page
      .locator('.wb-catalog-list')
      .getByRole('button', { name: new RegExp(product.name) })
      .click()
    if (wait) {
      await ready(slug)
      await retained(slug)
    }
  }
  const memory = async (cycle, slug) => {
    await page.waitForTimeout(250)
    const counts = await page.evaluate(() => {
      const renderer = window.__pianoLifecycleScene.renderer.instance
      const root = renderer.info
      return {
        geometries: root.memory.geometries,
        textures: root.memory.textures,
        programs: root.programs.length,
      }
    })
    report.memory.push({ cycle, slug, ...counts })
    return counts
  }
  const restingPiano = async () => {
    const result = await page.evaluate(() => {
      const root = window.__pianoLifecycleScene.scene.value.children.find(
        (node) => node.userData.workbenchProduct,
      )
      let parts = 0,
        morphs = 0,
        activeMorphs = 0
      root.traverse((node) => {
        if (/^piano-part-\d{3}$/.test(node.name)) parts++
        if (node.morphTargetInfluences?.length) {
          morphs++
          if (node.morphTargetInfluences.some((value) => value !== 0)) activeMorphs++
        }
      })
      return { adapter: root.userData.adapter, parts, morphs, activeMorphs }
    })
    expect(result.adapter).toBe('piano-v1')
    expect(result.parts).toBe(823)
    expect(result.morphs).toBeGreaterThan(0)
    expect(result.activeMorphs).toBe(0)
    return result
  }

  await page.goto(base + '/?product=piano-cfx', { waitUntil: 'domcontentloaded', timeout: 90000 })
  await ready('piano-cfx')
  await page.evaluate(() => {
    window.__pianoLifecycleCanvas = document.querySelector('canvas')
    window.__pianoLifecycleRenderer = window.__pianoLifecycleScene.renderer.instance
  })
  report.initial = await restingPiano()
  await memory(0, 'piano-cfx')
  for (let cycle = 1; cycle <= 3; cycle++) {
    for (const slug of ['typewriter-study', 'reventon', 'piano-cfx']) {
      await choose(slug)
      await memory(cycle, slug)
      if (slug === 'piano-cfx') expect(await restingPiano()).toEqual(report.initial)
    }
  }
  for (const slug of ['typewriter-study', 'reventon', 'piano-cfx']) {
    const second = report.memory.find((sample) => sample.cycle === 2 && sample.slug === slug)
    const third = report.memory.find((sample) => sample.cycle === 3 && sample.slug === slug)
    expect({ ...third, cycle: 2 }).toEqual(second)
  }
  report.checks.push(
    'Three live piano → typewriter → car → piano cycles retain one Canvas and renderer; all 823 parts return at rest; renderer geometry/texture/program counts match after warmup',
  )

  await choose('typewriter-study')
  await choose('piano-cfx')
  await page.goBack()
  await ready('typewriter-study')
  await retained('typewriter-study')
  await page.goForward()
  await ready('piano-cfx')
  await retained('piano-cfx')
  report.checks.push(
    'Browser back/forward restores the requested real product and keeps the existing Canvas and renderer',
  )

  await choose('reventon')
  await choose('piano-cfx', false)
  await choose('typewriter-study', false)
  await choose('reventon', false)
  await ready('reventon')
  await page.waitForTimeout(800)
  await ready('reventon')
  await retained('reventon')
  report.checks.push(
    'Rapid piano/typewriter/car selection retains only the latest car identity after pending loads finish',
  )

  await choose('typewriter-study')
  let started, completed
  const delayedStarted = new Promise((resolve) => {
    started = resolve
  })
  const delayedCompleted = new Promise((resolve) => {
    completed = resolve
  })
  await page.route('**/api/v1/products/piano-cfx', async (route) => {
    started()
    try {
      const response = await route.fetch()
      await new Promise((resolve) => setTimeout(resolve, 1200))
      await route.fulfill({ response }).catch(() => {})
    } finally {
      completed()
    }
  })
  await choose('piano-cfx', false)
  await delayedStarted
  await choose('reventon', false)
  await ready('reventon')
  await delayedCompleted
  await page.waitForTimeout(300)
  await ready('reventon')
  await retained('reventon')
  await page.unroute('**/api/v1/products/piano-cfx')
  report.checks.push(
    'A real piano detail response delayed by 1200ms cannot replace the newer car selection or leave a piano root behind',
  )

  await page.route('**/models/bundles/kimi-piano/v1/model.glb', (route) => route.abort('failed'))
  await choose('piano-cfx', false)
  await expect(page.locator('.workbench')).toHaveAttribute('data-status', 'error', {
    timeout: 30000,
  })
  await expect(page.locator('.wb-stage-status')).toContainText('暂时无法展示')
  await expect(page.getByRole('button', { name: '重新加载', exact: true })).toBeVisible()
  await expect(page.locator('canvas')).toHaveCount(1)
  expect(await identity()).toEqual({ products: [], sameCanvas: true, sameRenderer: true })
  expect(
    report.failedRequests.some((request) => request.url.endsWith('/kimi-piano/v1/model.glb')),
  ).toBe(true)
  await page.unroute('**/models/bundles/kimi-piano/v1/model.glb')
  await page.getByRole('button', { name: '重新加载', exact: true }).click()
  await ready('piano-cfx')
  await retained('piano-cfx')
  expect(await restingPiano()).toEqual(report.initial)
  await memory('retry', 'piano-cfx')
  report.checks.push(
    'Actual piano GLB download failure explicitly clears the previous model; in-place retry restores all 823 parts on the same Canvas and renderer without refreshing',
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

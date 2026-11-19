/* global AbortSignal, performance, requestAnimationFrame, fetch, URL */
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { chromium, expect } from '@playwright/test'
import { bridge, slugs, viewport } from './demo/browser-check.mjs'
import { localAuditOrigin } from './reventon-performance/audit-origin.mjs'

const base = localAuditOrigin(process.env.CHECK_URL ?? 'http://127.0.0.1:5181')
const output = resolve(process.env.EXHIBITION_OUTPUT ?? 'artifacts/showcase/exhibition-flow')
assert.ok(output.startsWith(resolve('artifacts') + sep), 'Output must be under artifacts')
const onlyTypewriter = process.argv.includes('--typewriter')
const home = `${base}/`
const timeout = 150000
const sizes = [viewport, { width: 1280, height: 720 }, { width: 1920, height: 1080 }]
const main = '.workbench.wb-exhibition'
const panel = '#wb-inspector'
const typewriter = slugs[0]
const report = {
  base,
  onlyTypewriter,
  passed: false,
  overview: {},
  layouts: [],
  products: [],
  history: [],
  fault: null,
  compatibility: null,
  errors: [],
  external: [],
}

await mkdir(output, { recursive: true })
const catalogResponse = await fetch(`${base}/api/v1/products`, {
  signal: AbortSignal.timeout(timeout),
})
assert.equal(catalogResponse.ok, true, 'The real catalog API must be running')
const catalog = await catalogResponse.json()
assert.ok(
  slugs.every((slug) =>
    catalog.some((item) => item.slug === slug && item.displayStatus === 'formal'),
  ),
)
const nameOf = (slug) => catalog.find((item) => item.slug === slug).name
const button = (root, name) => root.getByRole('button', { name, exact: true })
const canvasFrame = (page) =>
  page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  )

async function snapshot(page, filename) {
  await canvasFrame(page)
  await page.screenshot({
    path: resolve(output, `${filename}.png`),
    animations: 'disabled',
    timeout,
  })
}

async function verifyFit(page, selector) {
  await expect(page.locator(selector)).toBeVisible({ timeout })
  const width = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth])
  expect(width[0]).toBeLessThanOrEqual(width[1])
}

async function decoded(images) {
  await expect
    .poll(
      () =>
        images.evaluateAll((values) =>
          values.map((image) => image.complete && image.naturalWidth > 0),
        ),
      {
        timeout,
      },
    )
    .toEqual(Array.from({ length: await images.count() }, () => true))
}

async function verifyOverview(page, requests) {
  const hero = page.locator('.exhibition-plate')
  const links = page.locator('.exhibition-index-list > li > a')
  const since = requests.length
  await page.goto(home, { waitUntil: 'domcontentloaded', timeout })
  await expect(page.locator('#exhibition-title')).toHaveText('看见机械如何运作')
  await expect(links).toHaveCount(slugs.length, { timeout })
  await expect(hero.locator('img')).toHaveCount(2)
  if (onlyTypewriter) {
    await decoded(hero.locator('img'))
    await expect(links.first().locator('img')).toHaveCount(1)
    await decoded(links.first().locator('img'))
  } else {
    await expect(links.locator('img')).toHaveCount(slugs.length)
    await decoded(page.locator('.exhibition img'))
  }
  const hrefs = await links.evaluateAll((elements) =>
    elements.map((item) => new URL(item.href).searchParams.get('product')),
  )
  expect(hrefs).toEqual(slugs)
  await expect(button(hero, '分层')).toHaveAttribute('aria-pressed', 'true')
  await button(hero, '整机').press('Enter')
  await expect(button(hero, '整机')).toHaveAttribute('aria-pressed', 'true')
  await expect(hero.locator('img.is-visible')).toHaveAttribute('src', /typewriter-whole\.webp$/)
  await snapshot(page, 'overview-whole-1440')
  await button(hero, '分层').press('Space')
  await expect(button(hero, '分层')).toHaveAttribute('aria-pressed', 'true')
  await expect(hero.locator('img.is-visible')).toHaveAttribute('src', /typewriter-layers\.webp$/)
  for (const size of sizes) {
    await page.setViewportSize(size)
    await verifyFit(page, '.exhibition-hero')
    await expect(page.locator('canvas')).toHaveCount(0)
    await snapshot(page, `overview-layers-${size.width}`)
  }
  const paths = requests.slice(since)
  const modelRequests = paths.filter(
    (path) =>
      /^\/(models|studio|decoders)\//.test(path) || /\.(?:glb|gltf|ktx2|exr|hdr|wasm)$/.test(path),
  )
  expect(modelRequests).toEqual([])
  expect(paths).toContain('/api/v1/products')
  report.overview = { noCanvas: true, modelRequests, paths, slugs: hrefs }
  await page.setViewportSize(viewport)
}

async function attach(page, slug, remember = false) {
  const shell = page.locator(main)
  await expect(shell).toHaveAttribute('data-slug', slug, { timeout })
  await page.waitForFunction(
    (selector) =>
      ['ready', 'error', 'content'].includes(document.querySelector(selector)?.dataset.status),
    main,
    { timeout },
  )
  const status = await shell.getAttribute('data-status')
  if (status !== 'ready') throw new Error(`${slug}: ${status}: ${await shell.innerText()}`)
  await expect(
    page.getByRole('heading', { level: 1, name: nameOf(slug), exact: true }),
  ).toBeVisible()
  await expect(page.locator('canvas')).toHaveCount(1)
  await bridge(page, remember)
  const identity = await page.evaluate(() => {
    const { scene, canvas, renderer: reference } = window.__demo
    const renderer = scene.renderer.instance
    const roots = scene.scene.value.children.filter((node) => node.userData.workbenchProduct)
    return {
      roots: roots.map((node) => node.userData.workbenchProduct),
      sha256: roots[0]?.userData.bundleSha256,
      sameRenderer: renderer === reference,
      sameCanvas: renderer.domElement === canvas,
      backend: renderer.backend?.isWebGPUBackend ? 'webgpu' : 'other',
      drawingBuffer: [renderer.domElement.width, renderer.domElement.height],
    }
  })
  expect(identity.roots).toEqual([slug])
  expect(identity.sha256).toBeTruthy()
  expect(identity.sameRenderer).toBe(true)
  expect(identity.sameCanvas).toBe(true)
  expect(identity.backend).toBe('webgpu')
  return identity
}

async function verifyDesktopWorkbench(page) {
  for (const size of sizes) {
    await page.setViewportSize(size)
    await verifyFit(page, main)
    await expect(page.getByRole('combobox', { name: '切换展品' })).toBeVisible()
    await expect(button(page, '探索结构')).toBeVisible()
    await expect(button(page, '复位视角')).toBeVisible()
    await snapshot(page, `typewriter-whole-${size.width}`)
    report.layouts.push(size)
  }
  await page.setViewportSize(viewport)
}

async function playStep(page, label, { pause = false } = {}) {
  const step = button(page.locator(panel), label)
  const group = step.locator('xpath=ancestor::section[@data-motion-id]')
  const id = await group.getAttribute('data-motion-id')
  await step.click()
  let paused = null
  if (pause) {
    await page.waitForFunction((key) => {
      const state = window.__demo.motion.snapshot()[key]
      return state?.playing && state.progress > 0
    }, id)
    const pauseButton = group.getByRole('button', { name: /暂停$/ })
    await pauseButton.press('Space')
    await expect(group.getByRole('status')).toHaveText(/已暂停/)
    paused = await page.evaluate((key) => window.__demo.motion.snapshot()[key], id)
    expect(paused.playing).toBe(false)
    expect(paused.progress).toBeGreaterThan(0)
    expect(paused.progress).toBeLessThan(paused.target)
    await group.getByRole('button', { name: /继续$/ }).press('Space')
  }
  await expect(step).toHaveAttribute('aria-pressed', 'true', { timeout })
  const state = await page.evaluate((key) => window.__demo.motion.snapshot()[key], id)
  expect(state.playing).toBe(false)
  expect(state.progress).toBeCloseTo(state.target)
  return { id, label, state, paused }
}

async function framing(page, label) {
  const target = await page.evaluate(
    (name) => window.__demo.store.presentation.views.find((view) => view.label === name)?.position,
    label,
  )
  assert.equal(target?.length, 3, `Missing view: ${label}`)
  await button(page.locator(panel), label).click()
  await page.waitForFunction(
    (position) =>
      window.__demo.scene.camera.activeCamera.value.position
        .toArray()
        .every((value, index) => Math.abs(value - position[index]) < 0.004),
    target,
    { timeout },
  )
}

async function observePart(page, motionId) {
  await button(page, '部件').click()
  const part = page.locator(`${panel} .wb-part-list button`).first()
  const selected = (await part.innerText()).trim()
  const pose = await page.evaluate(() =>
    window.__demo.scene.camera.activeCamera.value.position.toArray(),
  )
  await part.click()
  await expect(part).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator(`${panel} .wb-part-copy h3`)).toHaveText(selected)
  expect(
    (await page.locator(`${panel} .wb-part-copy p`).innerText()).trim().length,
  ).toBeGreaterThan(0)
  await page.waitForFunction((previous) => {
    const camera = window.__demo.scene.camera.activeCamera.value
    return camera.position
      .toArray()
      .some((value, index) => Math.abs(value - previous[index]) > 0.01)
  }, pose)
  await snapshot(page, 'typewriter-part-1440')
  await button(page.locator(panel), '返回全景').click()
  await page.waitForFunction((id) => window.__demo.motion.snapshot()[id]?.progress === 0, motionId)
  return selected
}

async function switchExhibit(page, slug) {
  await page.getByRole('combobox', { name: '切换展品' }).selectOption(slug)
  await expect(page.locator(main)).toHaveAttribute('data-slug', slug, { timeout })
}

async function retryFailedSelection(page, slug, select, intentionalFailures, remember) {
  const path = `/api/v1/products/${slug}`
  const url = base + path
  const fail = (route) => route.abort('failed')
  intentionalFailures.add(url)
  await page.route(url, fail)
  try {
    await select()
    const status = page.locator('.wb-stage-status')
    await expect(status.getByRole('heading')).toHaveText(nameOf(slug), { timeout })
    await expect(page.locator(main)).toHaveAttribute('data-status', 'error', { timeout })
    await expect(status.getByRole('link', { name: '返回展厅' })).toBeVisible()
    await snapshot(page, `${slug}-failed-load-1440`)
  } finally {
    await page.unroute(url, fail)
  }
  await button(page.locator('.wb-stage-status'), '重新加载').click()
  const state = await attach(page, slug, remember)
  report.fault = { slug, deliberateRequestFailure: path, recovery: state }
  return state
}

async function verifyReducedMotionFallback(browser) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
  })
  try {
    const page = await context.newPage()
    await page.addInitScript(() =>
      Object.defineProperty(window.navigator, 'gpu', { value: undefined }),
    )
    await page.goto(`${home}?renderPipeline=showcase&product=${typewriter}`, {
      waitUntil: 'domcontentloaded',
      timeout,
    })
    await expect(page.locator(main)).toHaveAttribute('data-status', 'ready', { timeout })
    await expect(page.locator('.wb-stage')).toHaveAttribute('data-render-backend', 'webgl')
    await expect(page.locator('canvas')).toHaveCount(1)
    await button(page, '探索结构').press('Enter')
    await bridge(page, true)
    const layers = await playStep(page, '分层展开')
    report.compatibility = { backend: 'webgl', reducedMotion: true, layers }
  } finally {
    await context.close()
  }
}

const browser = await chromium.launch({ channel: 'msedge', headless: true })
try {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    serviceWorkers: 'block',
  })
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (['http:', 'https:'].includes(url.protocol) && url.origin !== base) {
      report.external.push(url.href)
      await route.abort('blockedbyclient')
    } else await route.continue()
  })
  const page = await context.newPage()
  page.setDefaultTimeout(30000)
  const requests = []
  const intentionalFailures = new Set()
  page.on('request', (request) => requests.push(new URL(request.url()).pathname))
  page.on('pageerror', (error) => report.errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    if (intentionalFailures.has(message.location().url) && /net::ERR_FAILED/.test(message.text()))
      return
    report.errors.push(message.text())
  })

  await verifyOverview(page, requests)
  const started = await page.evaluate(() => performance.now())
  await page.getByRole('link', { name: '探索打字机', exact: true }).click()
  const typewriterState = await attach(page, typewriter, true)
  const readyMs = await page.evaluate((start) => performance.now() - start, started)
  await verifyDesktopWorkbench(page)
  await button(page, '探索结构').click()
  const layers = await playStep(page, '分层展开', { pause: true })
  await framing(page, '展开全景')
  await snapshot(page, 'typewriter-structure-1440')
  const part = await observePart(page, layers.id)
  report.products.push({ slug: typewriter, identity: typewriterState, readyMs, layers, part })

  if (onlyTypewriter) {
    await page.goBack({ timeout })
    await expect(page.locator('#exhibition-title')).toBeVisible({ timeout })
    await expect(page.locator('canvas')).toHaveCount(0)
    report.history.push('workbench → overview')
    await retryFailedSelection(
      page,
      typewriter,
      () => page.goForward({ timeout }),
      intentionalFailures,
      true,
    )
    report.history.push('overview → workbench')
  } else {
    const piano = slugs[1]
    const car = slugs[2]
    await switchExhibit(page, piano)
    const pianoState = await attach(page, piano)
    await button(page, '探索结构').click()
    const mechanism = await playStep(page, '击弦机构')
    await framing(page, '击弦机构取景')
    await snapshot(page, 'piano-mechanism-1440')
    report.products.push({ slug: piano, identity: pianoState, mechanism })

    await page.goBack({ timeout })
    await attach(page, typewriter)
    report.history.push('piano → typewriter, same host')
    await page.goForward({ timeout })
    await attach(page, piano)
    report.history.push('typewriter → piano, same host')

    const carState = await retryFailedSelection(
      page,
      car,
      () => switchExhibit(page, car),
      intentionalFailures,
      false,
    )
    await button(page, '外观').click()
    await expect(button(page.locator(panel), '亮银金属')).toHaveAttribute('aria-pressed', 'true')
    await button(page, '探索结构').click()
    const doors = await playStep(page, '打开双门')
    await framing(page, '座舱观察')
    await snapshot(page, 'reventon-cabin-1440')
    const separation = await playStep(page, '展开部件')
    expect(
      await page.evaluate((id) => window.__demo.motion.snapshot()[id].progress, doors.id),
    ).toBe(1)
    await framing(page, '结构全景')
    await snapshot(page, 'reventon-separation-1440')
    report.products.push({ slug: car, identity: carState, doors, separation })
    await page.getByRole('link', { name: '展厅总览', exact: true }).click()
    await expect(page.locator('#exhibition-title')).toBeVisible({ timeout })
    await expect(page.locator('canvas')).toHaveCount(0)
  }

  expect(report.errors).toEqual([])
  expect(report.external).toEqual([])
  if (!onlyTypewriter) {
    await context.close()
    await verifyReducedMotionFallback(browser)
  }
  report.passed = true
} catch (error) {
  report.failure = error instanceof Error ? error.stack : String(error)
  throw error
} finally {
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2))
  await browser.close()
}
console.log(`Exhibition flow passed: ${resolve(output, 'report.json')}`)

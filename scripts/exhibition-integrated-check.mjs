/* global AbortSignal, fetch, performance, requestAnimationFrame, URL */
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { chromium, expect } from '@playwright/test'
import { bridge, slugs, viewport } from './demo/browser-check.mjs'
import { localAuditOrigin } from './reventon-performance/audit-origin.mjs'

const base = localAuditOrigin(process.env.CHECK_URL ?? 'http://127.0.0.1:5183')
const output = resolve(process.env.EXHIBITION_OUTPUT ?? 'artifacts/exhibition-integrated')
assert.ok(output.startsWith(resolve('artifacts') + sep), 'Output must be under artifacts')
const typewriterOnly = process.argv.includes('--typewriter')
const record = process.env.EXHIBITION_RECORD === '1'
const timeout = 180000
const [typewriter, piano, car] = slugs
const sizes = [viewport, { width: 1280, height: 720 }, { width: 1920, height: 1080 }]
const layoutAction = 'explore-layout'
const gallery = '.exhibit-gallery'
const report = {
  base,
  typewriterOnly,
  passed: false,
  preview: [],
  layouts: [],
  exhibits: [],
  errors: [],
  failedRequests: [],
}

await mkdir(output, { recursive: true })
const catalogResponse = await fetch(`${base}/api/v1/products`, {
  signal: AbortSignal.timeout(10000),
})
assert.ok(catalogResponse.ok, `Real catalog API returned ${catalogResponse.status}`)
const catalog = await catalogResponse.json()
const names = Object.fromEntries(
  slugs.map((slug) => {
    const item = catalog.find(
      (product) => product.slug === slug && product.displayStatus === 'formal',
    )
    assert.ok(item, `Missing formal catalog exhibit: ${slug}`)
    return [slug, item.name]
  }),
)

const button = (root, name) => root.getByRole('button', { name, exact: true })
const title = (page, slug) =>
  page.getByRole('heading', { level: 1, name: names[slug], exact: true })
const prohibitedPreviewRequest =
  /^\/(models|studio|decoders)\/|\.(glb|gltf|ktx2|exr|hdr|wasm)(?:\?|$)/i
const routeDetail = (slug) => `${base}/api/v1/products/${slug}`

async function capture(page, name) {
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  )
  await page.screenshot({ path: resolve(output, `${name}.png`), animations: 'disabled', timeout })
}

async function selectExhibit(page, slug) {
  const selection = button(page.locator(gallery), names[slug])
  await selection.click()
  await expect(selection).toHaveAttribute('aria-current', 'true')
  await expect(title(page, slug)).toBeVisible()
}

async function posterSrc(page) {
  return page
    .locator('.exhibit-poster-image')
    .evaluate((image) => (image.complete && image.naturalWidth > 0 ? image.currentSrc : ''))
}

async function previewGallery(page, requests) {
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout })
  await expect(page.locator(gallery)).toBeVisible()
  const posters = new Set()
  for (const slug of slugs) {
    await selectExhibit(page, slug)
    await expect(button(page, '开始互动')).toBeEnabled()
    await expect(page.locator('canvas')).toHaveCount(0)
    await expect
      .poll(
        async () => {
          const src = await posterSrc(page)
          return Boolean(src && !posters.has(src))
        },
        { timeout: 10000 },
      )
      .toBe(true)
    const src = await posterSrc(page)
    posters.add(src)
    report.preview.push({ slug, name: names[slug], poster: src })
    await capture(page, `cover-${slug}-1440`)
  }
  expect(requests.filter((path) => prohibitedPreviewRequest.test(path))).toEqual([])
  expect(requests.filter((path) => /^\/api\/v1\/products\//.test(path))).toEqual([])
  await selectExhibit(page, typewriter)
}

async function attach(page, slug, remember = false) {
  await expect(title(page, slug)).toBeVisible()
  const stage = page.locator('.wb-stage')
  await expect(stage).toHaveAttribute('data-product', slug, { timeout })
  await expect(stage).toHaveAttribute('data-scene-status', 'ready', { timeout })
  await expect(page.locator('canvas')).toHaveCount(1)
  await bridge(page, remember)
  const identity = await page.evaluate(() => {
    const { scene, canvas, renderer: original } = window.__demo
    const renderer = scene.renderer.instance
    const roots = scene.scene.value.children.filter((node) => node.userData.workbenchProduct)
    return {
      roots: roots.map((node) => node.userData.workbenchProduct),
      sha256: roots[0]?.userData.bundleSha256,
      sameRenderer: renderer === original,
      sameCanvas: renderer.domElement === canvas,
      backend: renderer.backend?.isWebGPUBackend ? 'webgpu' : 'other',
      drawingBuffer: [renderer.domElement.width, renderer.domElement.height],
      viewport: [window.innerWidth, window.innerHeight],
    }
  })
  expect(identity.roots).toEqual([slug])
  expect(identity.sha256).toBeTruthy()
  expect(identity.sameCanvas).toBe(true)
  expect(identity.sameRenderer).toBe(true)
  expect(identity.backend).toBe('webgpu')
  expect(identity.drawingBuffer.every((value) => value > 0)).toBe(true)
  return identity
}

async function startInteractive(page) {
  const start = button(page, '开始互动')
  await start.evaluate((element) => {
    window.__exhibitReadyAt = new Promise((resolveReady) => {
      element.addEventListener(
        'click',
        () => {
          const started = performance.now()
          const observer = new window.MutationObserver(() => {
            if (!document.querySelector('.wb-stage[data-scene-status="ready"]')) return
            observer.disconnect()
            resolveReady(performance.now() - started)
          })
          observer.observe(document.querySelector('.exhibit-bay'), {
            attributes: true,
            attributeFilter: ['data-scene-status'],
            childList: true,
            subtree: true,
          })
        },
        { capture: true, once: true },
      )
    })
  })
  await start.click()
  const identity = await attach(page, typewriter, true)
  const firstFrameMs = await page.evaluate(() => window.__exhibitReadyAt)
  expect(firstFrameMs).toBeGreaterThan(0)
  return { identity, firstFrameMs }
}

async function desktopLayouts(page) {
  for (const size of sizes) {
    await page.setViewportSize(size)
    await expect(button(page, '查看封面')).toBeVisible()
    await expect(button(page, '分层展开')).toBeVisible()
    const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth)
    expect(documentWidth).toBeLessThanOrEqual(size.width)
    await capture(page, `typewriter-live-${size.width}`)
    report.layouts.push(size)
  }
  await page.setViewportSize(viewport)
}

const motion = (page, id) => page.evaluate((key) => window.__demo.motion.snapshot()[key], id)
const camera = (page) =>
  page.evaluate(() => window.__demo.scene.camera.activeCamera.value.position.toArray())

async function settled(page, id, value) {
  await page.waitForFunction(
    ({ id, value }) => {
      const state = window.__demo.motion.snapshot()[id]
      return state && !state.playing && Math.abs(state.progress - value) < 0.0001
    },
    { id, value },
    { timeout },
  )
  return motion(page, id)
}

async function play(page, label, id, value) {
  await button(page.getByRole('region', { name: '展品操作' }), label).click()
  return settled(page, id, value)
}

async function typewriterActions(page) {
  await expect(page.locator('#wb-inspector')).toHaveCount(0)
  await expect(button(page, '继续')).toHaveCount(0)
  await expect(page.locator('.wb-hotspot:visible')).toHaveCount(0)
  const layers = await play(page, '分层展开', layoutAction, 0.6)
  expect(await page.locator('.wb-hotspot:visible').count()).toBeLessThanOrEqual(5)
  await capture(page, 'typewriter-layers-1440')
  const pulse = await page.evaluate(() => window.__demo.store.pulse.revision)
  await button(page, '敲击 A 键').click()
  await expect
    .poll(() => page.evaluate(() => window.__demo.store.pulse.revision))
    .toBeGreaterThan(pulse)
  await settled(page, layoutAction, 0.6)
  const part = await observePart(page)
  const flat = await play(page, '平铺部件', layoutAction, 1)
  await capture(page, 'typewriter-flat-1440')
  const beforeReset = await camera(page)
  const finish = await page.evaluate(() => window.__demo.store.finishId)
  await button(page, '复原结构').click()
  const reverted = await settled(page, layoutAction, 0)
  const afterReset = await camera(page)
  expect(afterReset.every((value, index) => Math.abs(value - beforeReset[index]) < 0.005)).toBe(
    true,
  )
  expect(await page.evaluate(() => window.__demo.store.finishId)).toBe(finish)
  await button(page, '观察工具').click()
  await page.getByRole('searchbox', { name: '查找部件' }).fill('字杆')
  await page
    .locator('.exhibit-tool-list')
    .getByRole('button', { name: /^字杆\s*·\s*01$/ })
    .click()
  await expect.poll(() => page.evaluate(() => window.__demo.store.selectedPart)).toBe('')
  await settled(page, layoutAction, 0)
  await button(page, '展开后查看').click()
  await settled(page, layoutAction, 0.6)
  await expect(button(page, '回到本段')).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.__demo.store.selectedPart)).toBe(part)
  await button(page, '回到本段').click()
  await button(page, '观察工具').click()
  await button(page.getByRole('dialog', { name: '观察工具' }), '复原结构').click()
  await settled(page, layoutAction, 0)
  return { layers, flat, part, reverted, inspectedAfterReveal: true }
}

async function observePart(page) {
  const before = await camera(page)
  await button(page, '查看字杆').click()
  const detail = page.locator('.exhibit-part-detail')
  await expect(detail.getByRole('heading', { name: /字杆/ })).toBeVisible()
  expect((await detail.locator('p').innerText()).trim()).not.toBe('')
  await expect(button(page, '回到本段')).toBeVisible()
  const part = await page.evaluate(() => window.__demo.store.selectedPart)
  expect(part).toBeTruthy()
  await page.waitForFunction(
    (position) =>
      window.__demo.scene.camera.activeCamera.value.position
        .toArray()
        .some((value, index) => Math.abs(value - position[index]) > 0.01),
    before,
  )
  await page.waitForFunction(async () => {
    const position = window.__demo.scene.camera.activeCamera.value.position
    const before = position.toArray()
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))
    return position.toArray().every((value, index) => Math.abs(value - before[index]) < 0.0001)
  })
  await settled(page, layoutAction, 0.6)
  await capture(page, 'typewriter-part-1440')
  await button(page, '回到本段').click()
  await settled(page, layoutAction, 0.6)
  await expect.poll(() => page.evaluate(() => window.__demo.store.selectedPart)).toBe('')
  await expect(detail).toBeHidden()
  return part
}

async function keyboardReducedMotion(page) {
  const tools = button(page, '观察工具')
  const sheet = page.getByRole('dialog', { name: '观察工具', exact: true })
  await tools.press('Enter')
  await expect(sheet).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(sheet).toBeHidden()
  await expect(tools).toBeFocused()

  await page.emulateMedia({ reducedMotion: 'reduce' })
  try {
    const unfold = button(page, '分层展开')
    await unfold.evaluate((element, id) => {
      window.__exhibitAfterInput = new Promise((resolvePose) => {
        element.addEventListener(
          'click',
          () => requestAnimationFrame(() => resolvePose(window.__demo.motion.snapshot()[id])),
          { once: true },
        )
      })
    }, layoutAction)
    await unfold.press('Space')
    const nextFrame = await page.evaluate(() => window.__exhibitAfterInput)
    expect(nextFrame.playing).toBe(false)
    expect(nextFrame.progress).toBeCloseTo(0.6)
    await capture(page, 'reduced-motion-1440')
    await tools.press('Enter')
    await button(sheet, '复原结构').press('Enter')
    await settled(page, layoutAction, 0)
    report.keyboard = { menuFocusRestored: true, reducedMotion: nextFrame }
  } finally {
    await page.emulateMedia({ reducedMotion: 'no-preference' })
  }
}

async function faultAndRetry(page) {
  const url = routeDetail(car)
  const abort = (route) => route.abort('failed')
  await page.route(url, abort)
  try {
    await selectExhibit(page, car)
    const error = page.locator('.wb-stage-status').getByRole('alert')
    await expect(error).toBeVisible({ timeout })
    await capture(page, 'car-request-failed-1440')
  } finally {
    await page.unroute(url, abort)
  }
  await button(page, '重新加载').click()
  return attach(page, car)
}

async function laterExhibits(page) {
  await selectExhibit(page, piano)
  const pianoIdentity = await attach(page, piano)
  await play(page, '剖切', 'sound-path', 1 / 7)
  await play(page, '键盘', 'sound-path', 2 / 7)
  const action = await play(page, '击弦机构', 'sound-path', 3 / 7)
  await capture(page, 'piano-action-1440')
  report.exhibits.push({ slug: piano, identity: pianoIdentity, action })
  const carIdentity = await faultAndRetry(page)
  const doors = await play(page, '打开双门', 'open-doors', 1)
  await button(page, '观察座舱').click()
  const cabin = await page.evaluate(
    () => window.__demo.store.presentation.views.find((view) => view.id === 'car-cabin')?.position,
  )
  expect(cabin).toHaveLength(3)
  await expect
    .poll(async () => {
      const position = await camera(page)
      return Math.max(...position.map((value, index) => Math.abs(value - cabin[index])))
    })
    .toBeLessThan(0.004)
  await capture(page, 'car-doors-1440')
  const separation = await play(page, '分离部件', 'explore-parts', 1)
  await settled(page, 'open-doors', 1)
  await capture(page, 'car-separated-1440')
  report.exhibits.push({ slug: car, identity: carIdentity, doors, separation })
  await rapidSwitchAndHistory(page)
}

async function rapidSwitchAndHistory(page) {
  const url = routeDetail(typewriter)
  let held
  let releaseError
  const gate = (route) => {
    held = route
  }
  await page.route(url, gate)
  try {
    await selectExhibit(page, typewriter)
    await expect.poll(() => Boolean(held)).toBe(true)
    await expect(page.locator(`.wb-stage-status[data-exhibit="${typewriter}"]`)).toBeVisible()
    await selectExhibit(page, piano)
  } finally {
    await page.unroute(url, gate)
    if (held) {
      try {
        await held.continue()
      } catch (error) {
        if (!held.request().failure() && !/Route is already handled/.test(String(error)))
          releaseError = error
      }
    }
  }
  if (releaseError) throw releaseError
  await attach(page, piano)
  await expect(page.locator(`.wb-stage-status[data-exhibit="${typewriter}"]`)).toBeHidden()
  await page.goBack()
  const back = await attach(page, typewriter)
  await page.goForward()
  const forward = await attach(page, piano)
  report.history = { late: typewriter, latest: piano, back, forward }
}

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const context = await browser.newContext({
  viewport,
  deviceScaleFactor: 1,
  serviceWorkers: 'block',
  ...(record ? { recordVideo: { dir: resolve(output, 'video'), size: viewport } } : {}),
})
const page = await context.newPage()
const recording = page.video()
const requests = []
page.setDefaultTimeout(20000)
page.on('request', (request) => requests.push(new URL(request.url()).pathname))
page.on('pageerror', (error) => report.errors.push(error.message))
page.on('requestfailed', (request) => {
  const reason = request.failure()?.errorText ?? ''
  if (reason !== 'net::ERR_ABORTED')
    report.failedRequests.push({ path: new URL(request.url()).pathname, reason })
})

try {
  await previewGallery(page, requests)
  const { identity, firstFrameMs } = await startInteractive(page)
  await desktopLayouts(page)
  report.exhibits.push({
    slug: typewriter,
    identity,
    firstFrameMs,
    actions: await typewriterActions(page),
  })
  if (!typewriterOnly) {
    await keyboardReducedMotion(page)
    await laterExhibits(page)
  }
  await button(page, '查看封面').click()
  await expect(button(page, '开始互动')).toBeEnabled()
  await expect(page.locator('canvas')).toHaveCount(0)
  await capture(page, 'back-to-cover-1440')
  expect(report.errors).toEqual([])
  expect(report.failedRequests).toEqual(
    typewriterOnly ? [] : [{ path: '/api/v1/products/reventon', reason: 'net::ERR_FAILED' }],
  )
  report.passed = true
} catch (error) {
  report.failure = error instanceof Error ? error.stack : String(error)
  throw error
} finally {
  await context.close()
  if (recording) {
    await recording.saveAs(resolve(output, 'visitor-walkthrough.webm'))
    report.recording = 'visitor-walkthrough.webm'
  }
  await browser.close()
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2))
}
console.log(`Integrated exhibition passed: ${resolve(output, 'report.json')}`)

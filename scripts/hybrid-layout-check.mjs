/* global URL, getComputedStyle, innerHeight, matchMedia, performance, requestAnimationFrame, cancelAnimationFrame */
import { chromium, expect } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { bridge, readProducts } from './demo/browser-check.mjs'

const base = process.env.CHECK_URL || 'http://127.0.0.1:5183'
const output = process.env.HYBRID_LAYOUT_OUTPUT || 'artifacts/hybrid-workbench/layout'
const timeout = Number(process.env.HYBRID_LAYOUT_TIMEOUT || 480000)
if (!Number.isFinite(timeout) || timeout < 1000) throw new Error('Invalid HYBRID_LAYOUT_TIMEOUT')
await mkdir(output, { recursive: true })
const { products } = await readProducts(base)
const product = products.find((item) => item.product.slug === 'typewriter-study')
if (!product) throw new Error('Published typewriter absent')
const report = {
  passed: false,
  checks: [],
  captures: [],
  states: {},
  layoutIssues: [],
  errors: [],
  requests: [],
  failedRequests: [],
}
const browser = await chromium.launch({ channel: 'msedge', headless: true })
let page
function observe(target) {
  target.on('pageerror', (error) =>
    report.errors.push({ url: target.url(), message: error.message }),
  )
  target.on('console', (entry) => {
    if (entry.type() === 'error') report.errors.push({ url: target.url(), message: entry.text() })
  })
  target.on('request', (request) => {
    if (/^https?:/.test(request.url())) report.requests.push(request.url())
  })
  target.on('requestfailed', (request) =>
    report.failedRequests.push({
      url: request.url(),
      reason: request.failure()?.errorText,
    }),
  )
}
function progress(name, evidence) {
  console.log(`[hybrid-layout] ${name}`, evidence ?? '')
}
async function ready(remember = false) {
  let lastLog = 0
  await expect
    .poll(
      async () => {
        const state = await page.evaluate(() => ({
          slug: document.querySelector('.workbench')?.dataset.slug,
          status: document.querySelector('.workbench')?.dataset.status,
          backend: document.querySelector('.wb-stage')?.dataset.renderBackend,
          loader: document.querySelector('.wb-stage-status')?.textContent?.trim(),
        }))
        if (Date.now() - lastLog >= 10000) {
          lastLog = Date.now()
          progress('Waiting for real raster-ready', state)
        }
        if (state.status === 'error' || state.status === 'content')
          throw new Error(`Actual scene failed: ${state.status}: ${state.loader}`)
        return { slug: state.slug, status: state.status }
      },
      { timeout, intervals: [500, 1000] },
    )
    .toEqual({ slug: product.product.slug, status: 'ready' })
  await expect(page.locator('canvas')).toHaveCount(1)
  await bridge(page, remember)
}
async function attachHybrid() {
  await page.evaluate(() => {
    const seen = new Set()
    const visit = (vnode) => {
      if (!vnode || typeof vnode !== 'object' || seen.has(vnode)) return undefined
      seen.add(vnode)
      const current = vnode.component
      if (current) {
        const exposed = current.exposed?.hybrid
        const hybrid = exposed?.value ?? exposed
        if (hybrid?.snapshot) return hybrid
        const found = visit(current.subTree)
        if (found) return found
      }
      if (Array.isArray(vnode.children)) {
        for (const child of vnode.children) {
          const found = visit(child)
          if (found) return found
        }
      }
      return visit(vnode.suspense?.activeBranch)
    }
    const hybrid = visit(document.querySelector('#app')?._vnode)
    if (!hybrid) throw new Error('Real component refinement bridge absent')
    window.__layoutHybrid = hybrid
  })
  await expect.poll(() => refinement(), { timeout: 10000 }).not.toBeUndefined()
}
function refinement() {
  return page.evaluate(() => window.__layoutHybrid?.snapshot())
}
function actual() {
  return page.evaluate(() => {
    const context = window.__demo.scene
    const scene = context.scene.value,
      renderer = context.renderer.instance
    const root = scene.children.find((node) => node.userData.workbenchProduct)
    if (!root) throw new Error('Actual product root absent')
    let parts = 0,
      instances = 0
    root.traverse((node) => {
      if (Number.isInteger(node.userData.partId)) parts++
      if (node.isInstancedMesh) instances += node.count
    })
    return {
      roots: scene.children
        .filter((node) => node.userData.workbenchProduct)
        .map((node) => node.userData.workbenchProduct),
      source: root.userData.sourceKind,
      adapter: root.userData.adapter,
      bundle: root.userData.assetBundle,
      parts,
      instances,
      webgpu: Boolean(
        renderer.isWebGPURenderer &&
        renderer.backend?.isWebGPUBackend &&
        renderer.backend.device?.queue,
      ),
      sameCanvas: document.querySelector('canvas') === window.__demo.canvas,
      sameRenderer: renderer === window.__demo.renderer,
      drawingBuffer: [renderer.domElement.width, renderer.domElement.height],
      canvasCount: document.querySelectorAll('canvas').length,
      camera: context.camera.activeCamera.value.position.toArray(),
      memory: renderer.info.memory,
    }
  })
}
function layout() {
  return page.evaluate(() => {
    const rectangle = (element) => {
      const rect = element.getBoundingClientRect()
      return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      }
    }
    const intersects = (a, b) =>
      a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
    const bar = document.querySelector('.wb-refinement')
    if (!bar) throw new Error('Actual refinement or compatibility notice absent')
    const bounds = rectangle(bar),
      style = getComputedStyle(bar)
    const title = document.querySelector('#wb-product-title')
    if (!title) throw new Error('Visible product title absent')
    const titleBounds = rectangle(title)
    const coreButtons = [
      ...document.querySelectorAll(
        '.wb-catalog-trigger, .wb-camera-tools button, .wb-camera-tools select, ' +
          '.wb-feature-tools button, .wb-rail-list button',
      ),
    ]
      .map((button) => {
        const rect = rectangle(button)
        if (!rect.width || !rect.height || getComputedStyle(button).visibility === 'hidden')
          return null
        const hit = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
        )
        return {
          name: button.getAttribute('aria-label') || button.textContent.trim(),
          bounds: rect,
          overlapsNotice: intersects(rect, bounds),
          centerReachable: hit === button || button.contains(hit),
          noticeInterceptsCenter: hit === bar || bar.contains(hit),
        }
      })
      .filter(Boolean)
    return {
      viewport: [innerWidth, innerHeight],
      documentWidth: document.documentElement.scrollWidth,
      notice: { bounds, bottom: style.bottom, text: bar.textContent.trim() },
      title: { bounds: titleBounds, overlapsNotice: intersects(titleBounds, bounds) },
      coreButtons,
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
    }
  })
}
function checkIdentity(state, webgpu) {
  expect(state.roots).toEqual(['typewriter-study'])
  expect(state.source).toBe('glb')
  expect(state.adapter).toBe('typewriter-v1')
  expect(state.bundle).toBe(`${product.manifest.id}@${product.manifest.version}`)
  expect(state.parts).toBe(572)
  expect(state.instances).toBeGreaterThan(0)
  expect(state.canvasCount).toBe(1)
  expect(state.webgpu).toBe(webgpu)
  expect(state.sameCanvas && state.sameRenderer).toBe(true)
}
async function capture(name) {
  await page.evaluate(() => document.fonts.ready)
  await expect(page.locator('#wb-product-title')).toBeVisible()
  const state = { scene: await actual(), layout: await layout(), refinement: await refinement() }
  report.states[name] = state
  await page.screenshot({ path: `${output}/${name}.png`, fullPage: true })
  report.captures.push(name)
  return state
}
function collectLayoutIssues(name, evidence, mobile = false) {
  const issues = []
  if (evidence.documentWidth > evidence.viewport[0]) issues.push('Horizontal document overflow')
  if (evidence.notice.bounds.left < 0 || evidence.notice.bounds.right > evidence.viewport[0])
    issues.push('Notice extends beyond viewport')
  if (evidence.title.overlapsNotice) issues.push('Notice overlaps product title')
  for (const button of evidence.coreButtons) {
    if (button.overlapsNotice || button.noticeInterceptsCenter)
      issues.push(`Notice overlaps core control: ${button.name}`)
  }
  if (mobile) {
    if (evidence.notice.bounds.height >= 100)
      issues.push('Compatibility notice height is at least 100px')
  }
  if (issues.length) report.layoutIssues.push({ name, issues })
}
try {
  progress('Three desktop sizes; single real WebGPU renderer')
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  observe(page)
  await page.goto(new URL('/?product=typewriter-study&renderPipeline=hybrid', base).href)
  await ready(true)
  await attachHybrid()
  await expect(page.locator('.wb-stage')).toHaveAttribute('data-render-backend', 'webgpu')
  await page.getByRole('button', { name: '仅实时展示', exact: true }).click()
  await expect.poll(async () => (await refinement())?.realtime).toBe(true)
  const initial = await actual()
  for (const [width, height] of [
    [1440, 1000],
    [1280, 720],
    [1920, 1080],
  ]) {
    progress(`Desktop ${width}×${height}`)
    await page.setViewportSize({ width, height })
    await expect
      .poll(async () => (await actual()).drawingBuffer, { timeout: 15000 })
      .toEqual([width, height])
    await ready()
    const state = await capture(`desktop-${width}x${height}`)
    checkIdentity(state.scene, true)
    expect(state.scene.instances).toBe(initial.instances)
    expect(state.refinement.realtime).toBe(true)
    collectLayoutIssues(`desktop-${width}x${height}`, state.layout)
  }
  report.checks.push(
    'Three desktop dimensions reuse one genuine WebGPU renderer and preserve real instanced product identity',
  )
  await page.close()
  page = undefined

  for (const [width, height] of [
    [390, 844],
    [320, 800],
  ]) {
    progress(`Fresh mobile ${width}×${height}; explicit hybrid compatibility`)
    page = await browser.newPage({ viewport: { width, height } })
    observe(page)
    const requestStart = report.requests.length
    await page.goto(new URL('/?product=typewriter-study&renderPipeline=hybrid', base).href)
    await ready(true)
    await expect(page.locator('.wb-stage')).toHaveAttribute('data-render-backend', 'webgl')
    await expect(page.locator('.wb-refinement')).toContainText('WebGL 兼容模式')
    const state = await capture(`mobile-${width}`)
    checkIdentity(state.scene, false)
    collectLayoutIssues(`mobile-${width}`, state.layout, true)
    expect(
      report.requests
        .slice(requestStart)
        .some((url) => /oidn|three[._]webgpu|rt_hdr_alb_nrm\.tza/.test(url)),
    ).toBe(false)
    await page.close()
    page = undefined
  }
  report.checks.push(
    'Fresh 390px and 320px pages choose actual WebGL compatibility without GPU or denoise downloads',
  )
  expect(
    report.layoutIssues,
    'Notice, product title and core controls must remain unobscured',
  ).toEqual([])

  progress('Reduced motion: genuine guided 128 spp without visible blend frames')
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })
  observe(page)
  await page.goto(new URL('/?product=typewriter-study&renderPipeline=hybrid', base).href)
  await ready(true)
  await attachHybrid()
  checkIdentity(await actual(), true)
  await page.evaluate(() => {
    window.__layoutPhaseMonitor = { raf: 0, transitions: [], blendingFrames: 0 }
    const monitor = window.__layoutPhaseMonitor
    const tick = () => {
      const snapshot = window.__layoutHybrid.snapshot()
      if (snapshot) {
        if (snapshot.phase === 'blending') monitor.blendingFrames++
        if (snapshot.phase !== monitor.transitions.at(-1)?.phase)
          monitor.transitions.push({
            phase: snapshot.phase,
            atMs: performance.now(),
            min: snapshot.samples?.min,
          })
      }
      monitor.raf = requestAnimationFrame(tick)
    }
    tick()
  })
  let lastLog = 0
  await expect
    .poll(
      async () => {
        const status = await refinement()
        if (Date.now() - lastLog >= 10000) {
          lastLog = Date.now()
          progress('Reduced-motion actual progress', {
            phase: status?.phase,
            min: status?.samples?.min,
            error: status?.error,
          })
        }
        if (status?.phase === 'error') throw new Error(status.error)
        return status?.phase
      },
      { timeout, intervals: [500, 1000] },
    )
    .toBe('ready')
  const completed = await refinement()
  expect(completed.target).toBe(128)
  expect(completed.samples.min).toBeGreaterThanOrEqual(128)
  expect(completed.denoiseMs).toBeGreaterThan(0)
  const phases = await page.evaluate(() => {
    cancelAnimationFrame(window.__layoutPhaseMonitor.raf)
    return {
      transitions: window.__layoutPhaseMonitor.transitions,
      blendingFrames: window.__layoutPhaseMonitor.blendingFrames,
    }
  })
  expect(phases.blendingFrames).toBe(0)
  expect(phases.transitions.some((entry) => entry.phase === 'denoising')).toBe(true)
  const state = await capture('reduced-motion-guided-128')
  expect(state.layout.reducedMotion).toBe(true)
  checkIdentity(state.scene, true)
  const parked = await refinement()
  await page.waitForTimeout(1200)
  const idle = await refinement()
  expect(idle.phase).toBe('ready')
  expect(idle.sampleFrames).toBe(completed.sampleFrames)
  expect(idle.rasterFrames).toBe(completed.rasterFrames)
  expect(idle.presentations).toBe(parked.presentations)
  report.states.reducedMotionPhases = phases
  report.states.reducedMotionIdle = { completed, afterCapture: parked, idle }
  report.checks.push(
    'Reduced motion completes actual 128 spp guided denoise with no blend display frames and stops sampling/presentation',
  )
  expect([...new Set(report.requests.map((url) => new URL(url).origin))]).toEqual([
    new URL(base).origin,
  ])
  expect(report.errors).toEqual([])
  report.passed = true
} catch (error) {
  report.failure = error.stack || String(error)
  if (page && !page.isClosed())
    await page.screenshot({ path: `${output}/failure.png`, fullPage: true }).catch(() => {})
} finally {
  await browser.close()
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2) + '\n')
}
console.log(
  JSON.stringify(
    {
      passed: report.passed,
      checks: report.checks.length,
      output,
      layoutIssues: report.layoutIssues,
      failure: report.failure,
    },
    null,
    2,
  ),
)
if (!report.passed) process.exitCode = 1

import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { chromium, expect } from '@playwright/test'
import { bridge } from './demo/browser-check.mjs'
import { candidateIdentity } from './reventon-clean-stress/model.mjs'
import { localAuditOrigin } from './reventon-performance/audit-origin.mjs'
import { boundedAuditAttempt, withAuditDeadline } from './reventon-performance/audit-deadline.mjs'
import { decodeSignal } from './realtime-probe/pixels.mjs'
import { studioUrl } from './reventon-studio/model.mjs'
import { installCarRayContractProbe } from './reventon-studio/ray-contract-browser.mjs'
import { rayContractCases, verifyRayContract } from './reventon-studio/ray-contract.mjs'

const base = localAuditOrigin(process.env.CHECK_URL ?? 'http://127.0.0.1:5181'),
  output = resolve(process.env.CAR_STUDIO_RAYS_OUTPUT ?? 'artifacts/car-studio/ray-contract'),
  timeout = 240000,
  report = {
    passed: false,
    syntheticSignalTest: true,
    visualQualityValidated: false,
    presentedFrameBudgetValidated: false,
    startedAt: new Date().toISOString(),
    viewport: { width: 1440, height: 1000 },
    cases: [],
    errors: [],
    gpuErrors: [],
    limitations: [
      'Synthetic SSR signal diagnostics in the real published car workbench, not visitor images or visual acceptance.',
      'The two actual native SSR nodes execute first; test-only GPU clears then provide labelled per-ray RGB and hit/miss lengths.',
      'One bounded native baseSpecular/rawDelta crop is copied per case at a successful existing complete-frame boundary.',
      'Two matching synthetic SSR crops verify their GPU clear values; CPU expectations are not substituted for GPU output.',
      'RGBA16F rounding permits scaled absolute error <= 0.003; this is not a frame-rate or displayed-timing test.',
      'Headless background test only; no fronting, focus command, added renderer, rendering clock or API write.',
    ],
  }
assert.ok(output.startsWith(resolve('artifacts') + sep), 'Output must stay inside artifacts/')
await mkdir(output, { recursive: true })
let browser, context, page
try {
  browser = await chromium.launch({
    channel: process.env.REVENTON_BROWSER_CHANNEL ?? 'msedge',
    headless: true,
  })
  context = await browser.newContext({ viewport: report.viewport, deviceScaleFactor: 1 })
  page = await context.newPage()
  page.on('pageerror', (error) => report.errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') report.errors.push(message.text())
  })
  page.setDefaultTimeout(timeout)
  report.url = studioUrl(base, 'studio')
  await page.goto(report.url, { waitUntil: 'domcontentloaded' })
  await expect(page.locator('.workbench')).toHaveAttribute('data-status', 'ready', { timeout })
  await bridge(page, true)
  await page.evaluate(() => {
    const seen = new Set()
    const find = (vnode) => {
      if (!vnode || typeof vnode !== 'object' || seen.has(vnode)) return
      seen.add(vnode)
      const component = vnode.component,
        exposed = component?.exposed?.realLighting,
        value = exposed?.value ?? exposed
      if (value?.snapshot && value?.setSignals) return value
      const child = find(component?.subTree)
      if (child) return child
      for (const entry of Array.isArray(vnode.children) ? vnode.children : []) {
        const found = find(entry)
        if (found) return found
      }
      return find(vnode.suspense?.activeBranch)
    }
    window.__carLighting = find(document.querySelector('#app')?._vnode)
    if (!window.__carLighting) throw new Error('Real scene-local realtime coordinator absent')
    window.__carRayGpuErrors = []
    window.__carRayGpuListener = (event) =>
      window.__carRayGpuErrors.push(event.error?.message ?? 'Unknown GPU error')
    window.__demo.scene.renderer.instance.backend.device.addEventListener(
      'uncapturederror',
      window.__carRayGpuListener,
    )
  })
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const value = window.__carLighting.snapshot()
          if (value.error || value.indirectLighting.error)
            throw new Error(value.error || value.indirectLighting.error)
          return value.phase === 'ready' && value.indirectLighting.actual === 'ddgi'
        }),
      { timeout },
    )
    .toBe(true)
  report.identity = await page.evaluate(() => {
    const renderer = window.__demo.scene.renderer.instance,
      roots = window.__demo.scene.scene.value.children.filter(
        (node) => node.userData.workbenchProduct,
      )
    return {
      roots: roots.map((node) => ({
        slug: node.userData.workbenchProduct,
        sha256: node.userData.bundleSha256,
        quality: node.userData.carStudioQuality,
      })),
      nativeWebgpu: Boolean(renderer.backend.isWebGPUBackend),
      output: [renderer.domElement.width, renderer.domElement.height],
      canvases: document.querySelectorAll('canvas').length,
      sameRenderer: renderer === window.__demo.renderer,
      sameCanvas: renderer.domElement === window.__demo.canvas,
      rays: window.__carLighting.snapshot().signals.reflectionRays,
    }
  })
  assert.deepEqual(report.identity.roots, [
    { slug: 'reventon', sha256: candidateIdentity.sha256, quality: 'studio' },
  ])
  assert.equal(report.identity.nativeWebgpu, true)
  assert.equal(report.identity.canvases, 1)
  assert.equal(report.identity.sameRenderer && report.identity.sameCanvas, true)
  assert.deepEqual(report.identity.output, [1440, 1000])
  assert.equal(report.identity.rays.actual, 2)
  assert.equal(report.identity.rays.error, null)
  await page.evaluate(installCarRayContractProbe)
  for (const item of rayContractCases) {
    const capture = await withAuditDeadline(
        'Capture actual dual SSR ' + item.id,
        () => page.evaluate((test) => window.__carRayContract.capture(test), item),
        30000,
      ),
      signals = Object.fromEntries(
        capture.signals.map((signal) => [signal.name, decodeSignal(signal)]),
      )
    assert.ok(capture.completedFrame > capture.armedFrame)
    assert.equal(new Set(capture.rays.map((ray) => ray.uuid)).size, 2)
    assert.equal(new Set(capture.rays.map((ray) => ray.targetUuid)).size, 2)
    const noiseDifference = Math.abs(capture.rays[0].noiseIndex - capture.rays[1].noiseIndex)
    assert.ok(noiseDifference === 104729 || noiseDifference === 2147483647 - 104729)
    for (const [index, ray] of item.rays.entries()) {
      const pixels = signals['ray-' + index].rgba
      for (let offset = 0; offset < pixels.length; offset++)
        assert.ok(
          Math.abs(pixels[offset] - ray[offset % 4]) <=
            0.003 * Math.max(1, Math.abs(ray[offset % 4])),
          'The actual SSR target must contain its labelled GPU clear',
        )
    }
    const numerical = verifyRayContract(signals.native.rgba, signals.rawDelta.rgba, item.rays)
    const { signals: payload, ...metadata } = capture
    report.cases.push({
      ...metadata,
      inputs: item.rays,
      ...numerical,
      signals: payload.map(({ base64, ...signal }) => ({
        ...signal,
        capturedBytes: Buffer.from(base64, 'base64').length,
      })),
    })
    console.log(JSON.stringify({ event: 'car-studio-ray-contract', id: item.id, ...numerical }))
  }
  assert.equal(await page.evaluate(() => window.__carRayContract.restore()), true)
  report.hooksRestored = true
  report.gpuErrors = await page.evaluate(() => [...window.__carRayGpuErrors])
  assert.deepEqual(report.errors, [])
  assert.deepEqual(report.gpuErrors, [])
  report.passed = true
} catch (error) {
  report.failure = { message: error.message, stack: error.stack }
} finally {
  if (page) {
    await page
      .evaluate(() => {
        window.__carRayContract?.restore()
        const device = window.__demo?.scene.renderer.instance.backend.device
        if (device && window.__carRayGpuListener)
          device.removeEventListener('uncapturederror', window.__carRayGpuListener)
      })
      .catch((error) => {
        report.hookCleanupError = error.message
      })
  }
  await context?.close().catch((error) => {
    report.contextCleanupError = error.message
  })
  const cleanup = await boundedAuditAttempt(
    'Close owned SSR contract browser',
    () => browser?.close(),
    5000,
  )
  report.cleanup = { status: cleanup.status, confirmed: cleanup.status === 'completed' }
  if (!report.cleanup.confirmed || report.hookCleanupError || report.contextCleanupError)
    report.passed = false
  report.completedAt = new Date().toISOString()
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
}
console.log(JSON.stringify({ passed: report.passed, output, failure: report.failure?.message }))
if (!report.passed) process.exitCode = 1

/* global window, document, URL */
import { chromium, expect } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { bridge, readProducts, productEvidence } from './demo/browser-check.mjs'
import { installProbe } from './realtime-probe/browser-hook.mjs'
import { decodeSignal } from './realtime-probe/pixels.mjs'
import { analyzeReflectionProbe } from './realtime-probe/metrics.mjs'

const base = process.env.CHECK_URL || 'http://127.0.0.1:5181',
  output = process.env.REALTIME_PROBE_OUTPUT || 'artifacts/typewriter-quality-node1/ssr-probe',
  viewport = { width: 1440, height: 1000 },
  report = {
    analysisOnly: true,
    visualAcceptance: 'not evaluated',
    passed: false,
    viewport,
    captures: [],
    errors: [],
    startedAt: new Date().toISOString(),
    method:
      'Published real typewriter, one production Canvas/renderer. Existing SSR, native baseSpecular MRT, replacement and raw RTT targets copied at one successful complete existing render frame. PNG screenshots are taken later at the same fixed pose, not that exact GPU submission. No extra rendering clock or per-frame CPU readback. A labelled forced-all-miss signal run tests fallback, not scene quality. Temporal difference is same-pixel numeric change, not a perceived noise score or GPU time. HDR contract assertions check component format and miss-sentinel preservation, not image quality.',
  }
let browser, page
await mkdir(output, { recursive: true })
try {
  const { products } = await readProducts(base),
    metadata = products.find((entry) => entry.product.slug === 'typewriter-study')
  if (!metadata) throw new Error('Real published typewriter absent')
  report.product = productEvidence(metadata)
  browser = await chromium.launch({ channel: 'msedge', headless: true })
  page = await browser.newPage({ viewport, deviceScaleFactor: 1 })
  page.on('pageerror', (error) => report.errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') report.errors.push(message.text())
  })
  await page.goto(new URL('/?product=typewriter-study&renderPipeline=realtime', base).href)
  await expect
    .poll(
      async () => {
        const status = await page.locator('.workbench').getAttribute('data-status')
        if (status === 'error' || status === 'content')
          throw new Error(`Real scene failed: ${status}`)
        return status
      },
      { timeout: 240000 },
    )
    .toBe('ready')
  await expect(page.locator('.workbench')).toHaveAttribute('data-slug', metadata.product.slug)
  await expect(page.locator('canvas')).toHaveCount(1)
  await bridge(page, true)
  report.identity = await page.evaluate(() => {
    const renderer = window.__demo.scene.renderer.instance,
      roots = window.__demo.scene.scene.value.children.filter(
        (node) => node.userData.workbenchProduct,
      )
    if (roots.length !== 1) throw new Error('Unique actual product root absent')
    const root = roots[0]
    let semanticParts = 0,
      instances = 0
    root.traverse((node) => {
      if (Number.isInteger(node.userData.partId)) semanticParts++
      if (node.isInstancedMesh) instances += node.count
    })
    return {
      slug: root.userData.workbenchProduct,
      bundle: root.userData.assetBundle,
      nativeWebgpu: Boolean(renderer.backend.isWebGPUBackend),
      semanticParts,
      instances,
    }
  })
  expect(report.identity).toEqual({
    slug: 'typewriter-study',
    bundle: 'kimi-typewriter@1',
    nativeWebgpu: true,
    semanticParts: 572,
    instances: 2257,
  })
  await page.evaluate(() => {
    const seen = new Set()
    const visit = (node) => {
      if (!node || typeof node !== 'object' || seen.has(node)) return
      seen.add(node)
      const component = node.component,
        exposed = component?.exposed?.realLighting,
        value = exposed?.value ?? exposed
      if (value?.snapshot && value?.setSignals) return value
      const nested = visit(component?.subTree)
      if (nested) return nested
      for (const child of Array.isArray(node.children) ? node.children : []) {
        const found = visit(child)
        if (found) return found
      }
      return visit(node.suspense?.activeBranch)
    }
    window.__reflectionLighting = visit(document.querySelector('#app')._vnode)
    if (!window.__reflectionLighting) throw new Error('Real scene-local coordinator absent')
  })
  await page.evaluate(installProbe)
  const frames = () => page.evaluate(() => window.__reflectionLighting.snapshot().frames)
  for (const item of [
    { id: 'whole', view: 'perspective' },
    { id: 'paint', part: 'part-095' },
    { id: 'all-miss-paint', part: 'part-095', forceMiss: true },
  ]) {
    console.log(`[SSR probe] ${item.id}`)
    await page.evaluate((item) => {
      window.__demo.store.restore()
      window.__demo.store.panel = null
      window.__reflectionProbe.forceMiss(Boolean(item.forceMiss))
      const lighting = window.__reflectionLighting
      lighting.setSignals(false, false, true)
      lighting.setSignals(true, true, true)
    }, item)
    await page.waitForTimeout(1000)
    if (item.part) {
      const hotspot = metadata.product.presentation.hotspots.find(
        (entry) => entry.id === item.part || entry.node === item.part,
      )
      await page.evaluate((id) => window.__demo.store.focus(id), hotspot.id)
    } else await page.evaluate((id) => window.__demo.store.view(id), item.view)
    await page.waitForTimeout(1000)
    const previousFrame = await frames()
    await expect
      .poll(frames, { timeout: 60000, intervals: [100] })
      .toBeGreaterThan(previousFrame + 48)
    let previousReplacement
    for (let repeat = 0; repeat < 2; repeat++) {
      const capture = await page.evaluate(() => window.__reflectionProbe.capture()),
        decoded = {}
      const metadata = []
      for (const signal of capture.signals) {
        const { bytes, rgba } = decodeSignal(signal)
        decoded[signal.name] = rgba
        const file = `${item.id}-${repeat}-${signal.name}.bin`
        await writeFile(join(output, file), bytes)
        const { base64: _base64, ...details } = signal
        void _base64
        metadata.push({
          ...details,
          file,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        })
      }
      const { width, height } = capture.signals[0],
        support = Float32Array.from({ length: width * height }, (_, i) => decoded.native[i * 4 + 3])
      const analysis = analyzeReflectionProbe({
        width,
        height,
        ...decoded,
        support,
        previousReplacement,
      })
      let rawMaxRgb = -Infinity,
        rawMaxAlpha = -Infinity,
        rawMissSentinels = 0,
        ssrMissSentinels = 0
      for (let i = 0; i < width * height; i++) {
        const offset = i * 4
        rawMaxRgb = Math.max(
          rawMaxRgb,
          decoded.raw[offset],
          decoded.raw[offset + 1],
          decoded.raw[offset + 2],
        )
        rawMaxAlpha = Math.max(rawMaxAlpha, decoded.raw[offset + 3])
        if (decoded.raw[offset + 3] >= 9999) rawMissSentinels++
        if (decoded.ssr[offset + 3] >= 9999) ssrMissSentinels++
      }
      previousReplacement = decoded.replacement
      report.captures.push({
        case: item.id,
        repeat,
        capturedFrame: capture.capturedFrame,
        forceMiss: capture.forceMiss,
        signals: metadata,
        analysis,
        rawContract: { rawMaxRgb, rawMaxAlpha, rawMissSentinels, ssrMissSentinels },
      })
      for (const signal of metadata) {
        expect(signal.gpuFormat, `${item.id}: ${signal.name} HDR format`).toBe('rgba16float')
        expect([signal.width, signal.height]).toEqual([viewport.width, viewport.height])
      }
      for (const [name, values] of Object.entries(decoded))
        expect(values.every(Number.isFinite), `${item.id}: ${name} non-finite input`).toBe(true)
      expect(analysis.invalidPixels, `${item.id}: non-finite GPU input`).toBe(0)
      expect(rawMaxAlpha, `${item.id}: raw miss sentinel`).toBe(10000)
      expect(rawMissSentinels, `${item.id}: unclipped raw miss count`).toBe(ssrMissSentinels)
      if (item.forceMiss) expect(ssrMissSentinels).toBe(width * height)
      await page.locator('canvas').screenshot({ path: join(output, `${item.id}-${repeat}.png`) })
    }
  }
  report.hooksRestored = await page.evaluate(() => window.__reflectionProbe.restore())
  expect(report.hooksRestored).toBe(true)
  expect(await page.locator('canvas').count()).toBe(1)
  expect(
    await page.evaluate(() => window.__demo.scene.renderer.instance === window.__demo.renderer),
  ).toBe(true)
  expect(report.errors).toEqual([])
  report.passed = true
} catch (error) {
  report.failure = error.stack ?? String(error)
  process.exitCode = 1
} finally {
  if (page) await page.evaluate(() => window.__reflectionProbe?.restore()).catch(() => {})
  await browser?.close()
  report.finishedAt = new Date().toISOString()
  await writeFile(join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
  console.log(
    `[SSR probe] ${report.passed ? 'capture complete' : 'failed'}: ${join(output, 'report.json')}`,
  )
}

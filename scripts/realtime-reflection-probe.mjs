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
      'Published real typewriter, one production Canvas/renderer. At one successful complete render frame, signed mode copies five existing GPU targets: SSR, native baseSpecular MRT, rawDelta, spatialDelta and filteredDelta. Legacy mode copies four existing targets including replacement/raw. In signed mode native+delta is reconstructed only on CPU for the legacy numeric reducer; it is not an actual GPU replacement target. Delta alpha means raw ray length, spatial support or temporal frame count respectively. PNG screenshots are later fixed-pose frames, not that exact submission. Labelled forced-all-miss and true-black-hit runs are synthetic signal diagnostics, not scene-quality images. No extra render clock or per-frame CPU readback. Numeric contracts and temporal differences are not visual acceptance or GPU/presentation timing.',
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
    { id: 'all-miss-paint', part: 'part-095', forceMiss: true, keepHistory: true },
    { id: 'black-hit-paint', part: 'part-095', forceBlackHit: true, keepHistory: true },
  ]) {
    console.log(`[SSR probe] ${item.id}`)
    await page.evaluate((item) => {
      if (item.keepHistory) return
      window.__demo.store.restore()
      window.__demo.store.panel = null
      window.__reflectionProbe.forceMiss(Boolean(item.forceMiss))
      const lighting = window.__reflectionLighting
      lighting.setSignals(false, false, true)
      lighting.setSignals(true, true, true)
    }, item)
    if (!item.keepHistory) await page.waitForTimeout(1000)
    if (item.part && !item.keepHistory) {
      const hotspot = metadata.product.presentation.hotspots.find(
        (entry) => entry.id === item.part || entry.node === item.part,
      )
      await page.evaluate((id) => window.__demo.store.focus(id), hotspot.id)
    } else if (item.view) await page.evaluate((id) => window.__demo.store.view(id), item.view)
    if (!item.keepHistory) await page.waitForTimeout(1000)
    const previousFrame = await frames()
    if (!item.keepHistory)
      await expect
        .poll(frames, { timeout: 60000, intervals: [100] })
        .toBeGreaterThan(previousFrame + 48)
    let previousReplacement
    for (let repeat = 0; repeat < 2; repeat++) {
      const capture = await page.evaluate(
          (override) => {
            if (override === 'miss') window.__reflectionProbe.forceMiss(true)
            if (override === 'black') window.__reflectionProbe.forceBlackHit(true)
            return window.__reflectionProbe.capture()
          },
          item.forceBlackHit ? 'black' : item.forceMiss ? 'miss' : null,
        ),
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
      let signedContract
      if (capture.signed) {
        const { verifySignedContract } = await import('./realtime-probe/signed-contract.mjs')
        const { width, height } = capture.signals[0]
        signedContract = verifySignedContract({
          width,
          height,
          ssr: decoded.ssr,
          native: decoded.native,
          rawDelta: decoded.rawDelta,
          filteredDelta: decoded.filteredDelta,
          forcedAllMiss: Boolean(item.forceMiss),
        })
        expect(signedContract.passed, JSON.stringify(signedContract.errors)).toBe(true)
        if (item.forceBlackHit) {
          expect(signedContract.minFiltered, 'True black hits lost signed correction').toBeLessThan(
            0,
          )
          expect(signedContract.maxFiltered).toBeLessThanOrEqual(0)
        }
        if (item.keepHistory && repeat === 0)
          expect(
            capture.capturedFrame,
            'Override must be captured on the next armed complete frame',
          ).toBe(capture.armedFrame + 1)
        // Diagnostic arithmetic only: the actual sampled texture is signed Δ.
        // N+Δ below is a CPU reconstruction for the legacy numeric reducer,
        // not an additional render or an actual GPU replacement target.
        decoded.raw = decoded.rawDelta
        decoded.replacement = new Float32Array(decoded.filteredDelta)
        for (let i = 0; i < decoded.replacement.length; i += 4)
          for (let channel = 0; channel < 3; channel++)
            decoded.replacement[i + channel] += decoded.native[i + channel]
        if (item.forceMiss) {
          for (const name of ['rawDelta', 'spatialDelta', 'filteredDelta'])
            expect(
              decoded[name].findIndex((value, index) => index % 4 !== 3 && value !== 0),
              `${name}: forced miss changed native IBL`,
            ).toBe(-1)
        }
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
        armedFrame: capture.armedFrame,
        forceMiss: capture.forceMiss,
        forceBlackHit: capture.forceBlackHit,
        retainedPriorHistory: Boolean(item.keepHistory),
        beforeForceFrame: item.keepHistory && repeat === 0 ? previousFrame : undefined,
        signed: capture.signed,
        signedContract,
        replacementSemantics: capture.signed
          ? 'CPU native+actual signed delta; not a GPU target'
          : 'actual GPU replacement target',
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
      expect(rawMaxAlpha, `${item.id}: raw ray length`).toBe(item.forceBlackHit ? 2 : 10000)
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

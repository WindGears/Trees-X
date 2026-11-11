/* global URL, performance, MutationObserver, requestAnimationFrame */
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium, expect } from '@playwright/test'
import {
  bridge,
  choose,
  inputPoint,
  observeWithMouse,
  positiveInteger,
  readProducts,
  viewport,
} from './demo/browser-check.mjs'
import { localAuditOrigin } from './reventon-performance/audit-origin.mjs'
import {
  installCompletedFrameTiming,
  installGpuSampler,
} from './reventon-performance/browser-timing.mjs'
import {
  distribution,
  gpuSummary,
  intervals,
  presentationEvidence,
} from './reventon-performance/metrics.mjs'
import { readTraceStream } from './reventon-performance/trace-stream.mjs'

const base = localAuditOrigin(process.env.CHECK_URL ?? 'http://127.0.0.1:5181')
const output = resolve(process.env.SHOWCASE_OUTPUT ?? 'artifacts/showcase/verification')
assert.ok(output.startsWith(resolve('artifacts') + sep))
const rounds = positiveInteger('SHOWCASE_COLD_ROUNDS', 3)
const timeout = 150000
const { products } = await readProducts(base)
const expected = { 'typewriter-study': 2, 'piano-cfx': 1, reventon: 2 }
const report = {
  base,
  viewport,
  rounds,
  passed: false,
  products: {},
  switches: [],
  errors: [],
  external: [],
}
await mkdir(output, { recursive: true })

function observeStartup(observeGpu) {
  performance.setResourceTimingBufferSize(500)
  const startup = (window.__showcaseLoad = { ready: null, phases: [] })
  const queuePrototype = observeGpu ? globalThis.GPUQueue?.prototype : undefined
  const submit = queuePrototype?.submit
  const firstFrame = { queue: null }
  if (submit) {
    queuePrototype.submit = function (commands) {
      firstFrame.queue = this
      return submit.call(this, commands)
    }
  }
  const observer = new MutationObserver(() => {
    const host = document.querySelector('.workbench')
    if (!host) return
    const phase = document.querySelector('.wb-stage-status p')?.textContent ?? host.dataset.status
    if (startup.phases.at(-1)?.phase !== phase)
      startup.phases.push({ phase, atMs: performance.now() })
    if (host.dataset.status === 'ready') {
      startup.ready = performance.now()
      observer.disconnect()
      if (submit) queuePrototype.submit = submit
      if (observeGpu) {
        // Fence the commands queued at first ready, before the next frame submits.
        const { queue } = firstFrame
        if (!queue) startup.gpuError = 'First ready frame has no WebGPU queue'
        else
          queue.onSubmittedWorkDone().then(
            () => (startup.gpuComplete = performance.now()),
            (error) => (startup.gpuError = String(error)),
          )
      }
    }
  })
  observer.observe(document, { subtree: true, childList: true, attributes: true })
}

async function attach(page, slug, remember = true) {
  await page.waitForFunction(
    () =>
      ['ready', 'error', 'content'].includes(document.querySelector('.workbench')?.dataset.status),
    null,
    { timeout },
  )
  await expect(page.locator('.workbench')).toHaveAttribute('data-status', 'ready')
  await bridge(page, remember)
  const state = await page.evaluate(() => {
    const { scene, canvas, renderer: original } = window.__demo
    const renderer = scene.renderer.instance
    const roots = scene.scene.value.children.filter((node) => node.userData.workbenchProduct)
    const root = roots[0]
    const seen = new Set()
    function visit(vnode) {
      if (!vnode || seen.has(vnode)) return
      seen.add(vnode)
      const component = vnode.component
      const lighting = component?.exposed?.realLighting
      if (lighting?.snapshot) return lighting
      const nested = visit(component?.subTree) ?? visit(vnode.suspense?.activeBranch)
      if (nested) return nested
      for (const child of Array.isArray(vnode.children) ? vnode.children : []) {
        const found = visit(child)
        if (found) return found
      }
    }
    window.__carLighting = visit(document.querySelector('#app')?._vnode)
    return {
      slug: root?.userData.workbenchProduct,
      version: root?.userData.bundleVersion,
      adapter: root?.userData.adapter,
      sha256: root?.userData.bundleSha256,
      roots: roots.length,
      canvasCount: document.querySelectorAll('canvas').length,
      backend: renderer.backend?.isWebGPUBackend ? 'webgpu' : 'other',
      sameHost: renderer === original && renderer.domElement === canvas,
      resolution: [renderer.domElement.width, renderer.domElement.height],
      lighting: window.__carLighting?.snapshot(),
      paint: root?.userData.carStudioPaint,
      showroom: root?.userData.carShowroom,
      bay: scene.scene.value.children.find((child) => child.userData.showcaseBay)?.userData
        .showcaseBay,
    }
  })
  assert.equal(state.slug, slug)
  assert.equal(state.version, expected[slug])
  assert.ok(state.sha256)
  assert.equal(state.roots, 1)
  assert.equal(state.canvasCount, 1)
  assert.equal(state.backend, 'webgpu')
  assert.equal(state.sameHost, true)
  assert.deepEqual(state.resolution, [1440, 1000])
  if (slug === 'reventon') {
    assert.equal(state.showroom?.probe?.source, 'cycles-r18')
    assert.equal(state.paint, 'silver')
  } else {
    assert.equal(state.bay, slug === 'piano-cfx' ? 'piano' : 'typewriter')
    if (slug === 'piano-cfx') assert.equal(state.lighting?.mode, 'pbr')
  }
  return state
}

async function enhanced(page) {
  await page.waitForFunction(
    () => {
      const value = window.__carLighting.snapshot()
      const error = value.error ?? value.indirectLighting?.error ?? value.keyShadow?.error
      if (error) throw new Error(error)
      return (
        value.indirectLighting?.actual === 'ddgi' &&
        value.keyShadow?.phase === 'ready' &&
        value.signals?.reflectionRays?.actual === 2
      )
    },
    null,
    { timeout, polling: 250 },
  )
  return page.evaluate(() => performance.now())
}

async function inspectAction(page, slug) {
  const labels =
    slug === 'piano-cfx'
      ? ['剖切', '键盘', '击弦机构', '弦列与铁板', '音板与弦桥', '制音器与踏板', '全部平铺', '整机']
      : slug === 'reventon'
        ? ['打开双门', '展开部件']
        : ['分层展开']
  await page.getByRole('button', { name: '结构与动作', exact: true }).click()
  const controls =
    slug === 'piano-cfx' ? page.locator('.wb-piano-chapters') : page.locator('.wb-panel')
  for (const name of labels) {
    const button = controls.getByRole('button', { name, exact: true })
    await button.click()
    await page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    )
    if (slug === 'piano-cfx') await expect(button).toHaveAttribute('aria-pressed', 'true')
    if (slug !== 'piano-cfx' || ['剖切', '全部平铺'].includes(name))
      await page.screenshot({ path: resolve(output, `${slug}-${name}.png`) })
  }
  await page.getByRole('button', { name: '还原商品', exact: true }).click()
  await page.getByRole('button', { name: '细节', exact: true }).click()
  await page.locator('.wb-part-list button').first().click()
  await expect(page.getByRole('button', { name: '返回全景', exact: true })).toBeVisible()
  await page.screenshot({ path: resolve(output, `${slug}-detail.png`) })
  await page.getByRole('button', { name: '返回全景', exact: true }).click()
  return labels
}

async function verifyPianoShadow(page) {
  await page.evaluate(() => {
    const { scene } = window.__demo
    const renderer = scene.renderer.instance
    const light = scene.scene.value
      .getObjectByName('workbench-lighting')
      .children.find((node) => node.isDirectionalLight && node.castShadow)
    if (!light?.shadow.map || light.shadow.autoUpdate)
      throw new Error('Piano does not have an initialized pose-driven shadow map')
    const render = renderer.render
    const probe = {
      count: 0,
      stop: () => {
        renderer.render = render
      },
    }
    renderer.render = function (world, camera) {
      if (camera === light.shadow.camera) probe.count++
      return render.call(this, world, camera)
    }
    window.__pianoShadowProbe = probe
  })
  try {
    await observeWithMouse(page)
    const cameraDraws = await page.evaluate(() => window.__pianoShadowProbe.count)
    await page.getByRole('button', { name: '结构与动作', exact: true }).click()
    const chapters = page.locator('.wb-piano-chapters')
    await chapters.getByRole('button', { name: '剖切', exact: true }).click()
    await page.waitForFunction(() => window.__pianoShadowProbe.count > 0)
    const poseDraws = await page.evaluate(() => window.__pianoShadowProbe.count)
    assert.equal(cameraDraws, 0)
    await chapters.getByRole('button', { name: '整机', exact: true }).click()
    await page.getByRole('button', { name: '结构与动作', exact: true }).click()
    return { cameraDraws, poseDraws }
  } finally {
    await page.evaluate(() => window.__pianoShadowProbe.stop())
  }
}

async function interaction(page, session, slug) {
  await page.evaluate(installCompletedFrameTiming)
  await page.evaluate(() => {
    const backend = window.__demo.scene.renderer.instance.backend
    backend.trackTimestamp = backend.device.features.has('timestamp-query')
  })
  await page.evaluate(installGpuSampler)
  const id = (await session.send('Page.getFrameTree')).frameTree.frame.id
  await session.send('Tracing.start', {
    transferMode: 'ReturnAsStream',
    categories: 'viz,cc,benchmark,disabled-by-default-devtools.timeline.frame',
  })
  const point = await inputPoint(page)
  await page.evaluate(() => {
    window.__carFrameTiming.segment('orbit')
    window.__carGpuTiming.segment('orbit')
  })
  const began = performance.now()
  await page.mouse.move(point.x, point.y)
  await page.mouse.down()
  try {
    while (performance.now() - began < 7000) {
      const at = (performance.now() - began) / 1000
      await page.mouse.move(point.x + 88 * Math.sin(at * 2), point.y + 18 * Math.sin(at), {
        steps: 3,
      })
      await delay(16)
    }
  } finally {
    await page.mouse.up()
  }
  const js = await page.evaluate(() => window.__carFrameTiming.stop())
  const gpu = await page.evaluate(() => window.__carGpuTiming.stop())
  const complete = new Promise((done) => session.once('Tracing.tracingComplete', done))
  await session.send('Tracing.end')
  const { stream } = await complete
  const { trace, metadata } = await readTraceStream(session, stream, {
    outputPath: resolve(output, `${slug}-trace.json`),
  })
  return {
    js: distribution(
      intervals(
        js.completions.filter((frame) => frame.segment === 'orbit').map((frame) => frame.atMs),
      ),
    ),
    gpu: {
      supported: gpu.supported,
      errors: gpu.errors,
      groups: gpuSummary(gpu.samples.filter((sample) => sample.segment === 'orbit')),
    },
    presentation: trace ? presentationEvidence(trace.traceEvents, id, 6000) : null,
    trace: metadata,
  }
}

const browser = await chromium.launch({ channel: 'msedge', headless: true })
try {
  for (const metadata of products) {
    const slug = metadata.product.slug
    const evidence = (report.products[slug] = { loads: [] })
    for (let sample = 0; sample < rounds; sample++) {
      const context = await browser.newContext({
        viewport,
        deviceScaleFactor: 1,
        reducedMotion: 'reduce',
        serviceWorkers: 'block',
      })
      try {
        await context.route('**/*', async (route) => {
          const url = new URL(route.request().url())
          if (['http:', 'https:'].includes(url.protocol) && url.origin !== base) {
            report.external.push(url.origin)
            await route.abort('blockedbyclient')
          } else await route.continue()
        })
        const page = await context.newPage()
        page.setDefaultTimeout(45000)
        page.on('pageerror', (error) => report.errors.push(error.message))
        page.on('console', (message) => {
          if (message.type() === 'error') report.errors.push(message.text())
        })
        await page.addInitScript(observeStartup, slug === 'reventon')
        const session = await context.newCDPSession(page)
        const url = `${base}/?product=${slug}&renderPipeline=showcase`
        await page.goto(url, { waitUntil: 'domcontentloaded' })
        const state = await attach(page, slug)
        const load = await page.evaluate(() => window.__showcaseLoad)
        assert.ok(load.ready > 0)
        if (slug === 'reventon') {
          load.enhanced = await enhanced(page)
          await page.waitForFunction(
            () => window.__showcaseLoad.gpuComplete || window.__showcaseLoad.gpuError,
            null,
            { timeout },
          )
          const gpu = await page.evaluate(() => window.__showcaseLoad)
          assert.equal(gpu.gpuError, undefined)
          load.gpuComplete = gpu.gpuComplete
        }
        evidence.loads.push(load)
        if (!sample) {
          evidence.identity = state
          if (slug === 'reventon') evidence.enhancedMs = load.enhanced
          if (slug === 'typewriter-study')
            await page.waitForFunction(
              () => window.__carLighting?.snapshot().signals?.ssr === true,
              null,
              { timeout },
            )
          await page.screenshot({ path: resolve(output, `${slug}-whole.png`) })
          evidence.actions = await inspectAction(page, slug)
          if (slug === 'piano-cfx') evidence.shadowRefresh = await verifyPianoShadow(page)
          evidence.interaction = await interaction(page, session, slug)
          if (slug === 'piano-cfx') {
            // Switch within this actual page to prove the native/SSR profiles share the host.
            const target = products.find((value) => value.product.slug === 'typewriter-study')
            await choose(page, target)
            report.switches.push(await attach(page, target.product.slug, false))
          }
        }
      } finally {
        await context.close()
      }
      console.log(`${slug} ${sample + 1}/${rounds} ${Math.round(evidence.loads.at(-1).ready)}ms`)
    }
    evidence.coldLoad = distribution(evidence.loads.map((row) => row.ready))
    if (slug === 'reventon') {
      evidence.coldEnhanced = distribution(evidence.loads.map((row) => row.enhanced))
      evidence.firstGpuCompleted = distribution(evidence.loads.map((row) => row.gpuComplete))
    }
  }
  assert.deepEqual(report.errors, [])
  assert.deepEqual(report.external, [])
  report.passed = true
} catch (error) {
  report.failure = String(error)
  throw error
} finally {
  await browser.close()
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
}

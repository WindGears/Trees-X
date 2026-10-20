/* global fetch, URL */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium, expect } from '@playwright/test'
import { bridge } from './demo/browser-check.mjs'

const base = process.env.CHECK_URL || 'http://127.0.0.1:5181',
  asset = process.env.REVENTON_ASSET || 'original',
  output = process.env.REVENTON_NOISE_OUTPUT || 'artifacts/reventon-noise',
  viewport = { width: 1440, height: 1000 },
  modes = [
    { id: 'native-physical', ssr: false, ssgi: false },
    { id: 'ssr-only', ssr: true, ssgi: false },
    { id: 'ddgi-only', ssr: false, ssgi: true },
    { id: 'complete', ssr: true, ssgi: true },
  ],
  report = {
    passed: false,
    visualQualityValidated: false,
    performanceValidated: false,
    method:
      'One real API/GLB, WebGPU renderer and fixed camera/pose/light setup. Four signal modes each wait for 40 completed coordinator frames. Screenshots support owner diagnosis; no image difference or timing establishes visual quality or performance.',
    startedAt: new Date().toISOString(),
    base,
    asset,
    viewport,
    deviceScaleFactor: 1,
    captures: [],
    errors: [],
    failedRequests: [],
    requests: [],
  }
let browser,
  context,
  page,
  stage = 'preflight'
await mkdir(output, { recursive: true })
const save = (name, value) =>
  writeFile(`${output}/${name}.json`, JSON.stringify(value, null, 2) + '\n')
const healthy = (value) => {
  assert.equal(report.errors.length, 0, 'Browser/validation error; see report.errors')
  assert.equal(report.failedRequests.length, 0, 'Request failed; see report.failedRequests')
  assert(value && !value.error && value.phase !== 'error', value?.error || 'Lighting unavailable')
  assert.equal(value.indirectLighting?.error, null, 'DDGI failed; no fallback comparison')
  return value
}
const lighting = async () => healthy(await page.evaluate(() => window.__noiseLighting.snapshot()))
async function waitFor(predicate, label, timeout = 90000) {
  const deadline = Date.now() + timeout
  do {
    const value = await lighting()
    if (predicate(value)) return value
    await delay(250)
  } while (Date.now() < deadline)
  throw new Error(
    `${label}: timed out after ${timeout}ms; last snapshot ${JSON.stringify(await lighting())}`,
  )
}
async function attach() {
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
      const nested = find(component?.subTree)
      if (nested) return nested
      for (const child of Array.isArray(vnode.children) ? vnode.children : []) {
        const found = find(child)
        if (found) return found
      }
      return find(vnode.suspense?.activeBranch)
    }
    window.__noiseLighting = find(document.querySelector('#app')?._vnode)
    if (!window.__noiseLighting?.snapshot())
      throw new Error('Real WorkbenchScene coordinator unavailable')
    window.__noiseCamera = window.__demo.scene.camera.activeCamera.value
    const renderer = window.__demo.scene.renderer.instance,
      original = renderer.copyTextureToTexture
    window.__noiseTargets = new Map()
    renderer.copyTextureToTexture = function (source, target, ...args) {
      if (target.name?.startsWith('TreesSignedHistory.'))
        window.__noiseTargets.set(target.name, target)
      return original.call(this, source, target, ...args)
    }
    window.__restoreNoiseCopy = () => (renderer.copyTextureToTexture = original)
  })
}
async function historyPixels() {
  return page.evaluate(async () => {
    const renderer = window.__demo.scene.renderer.instance,
      signal = window.__noiseTargets.get('TreesSignedHistory.previous'),
      statistics = window.__noiseTargets.get('TreesSignedHistory.statistics')
    if (!signal?.renderTarget || !statistics?.renderTarget)
      throw new Error('Actual reflection history attachments unavailable')
    const half = (v) => {
      const sign = v & 0x8000 ? -1 : 1,
        exp = (v >> 10) & 31,
        fraction = v & 1023
      return exp === 31
        ? fraction
          ? NaN
          : sign * Infinity
        : sign * (exp === 0 ? fraction * 2 ** -24 : (1 + fraction / 1024) * 2 ** (exp - 15))
    }
    const regions = [
        { id: 'side-door', x: 730, y: 540, width: 150, height: 80 },
        { id: 'front-body', x: 550, y: 570, width: 120, height: 70 },
      ],
      results = []
    for (const region of regions) {
      const payload = await renderer.readRenderTargetPixelsAsync(
          signal.renderTarget,
          region.x,
          region.y,
          region.width,
          region.height,
          0,
        ),
        guides = await renderer.readRenderTargetPixelsAsync(
          statistics.renderTarget,
          region.x,
          region.y,
          region.width,
          region.height,
          1,
        ),
        counts = [],
        coverage = [],
        distances = []
      for (let i = 0; i < payload.length; i += 4) {
        const count = half(payload[i + 3])
        if (count <= 0) continue
        counts.push(count)
        coverage.push(half(guides[i + 3]))
        distances.push(half(guides[i + 2]))
      }
      counts.sort((a, b) => a - b)
      const quantile = (q) => counts[Math.floor((counts.length - 1) * q)] ?? null
      results.push({
        ...region,
        supportedPixels: counts.length,
        historyCount: {
          median: quantile(0.5),
          p95: quantile(0.95),
          below3: counts.filter((n) => n < 3).length,
          at32: counts.filter((n) => n >= 31.9).length,
        },
        zeroCoverage: coverage.filter((n) => n === 0).length,
        minDistance: Math.min(...distances),
        maxDistance: Math.max(...distances),
        finite: [...counts, ...coverage, ...distances].every(Number.isFinite),
      })
    }
    return results
  })
}
async function snapshot() {
  return page.evaluate(() => {
    const scalar = (object) =>
      Object.fromEntries(
        Object.entries(object).filter(([, value]) =>
          ['number', 'string', 'boolean'].includes(typeof value),
        ),
      )
    const arrays = (object, keys) =>
      Object.fromEntries(keys.map((key) => [key, object[key]?.toArray()]))
    const transforms = ['position', 'quaternion', 'scale', 'matrixWorld']
    const test = window.__demo,
      renderer = test.scene.renderer.instance,
      scene = test.scene.scene.value,
      camera = test.scene.camera.activeCamera.value,
      roots = scene.children.filter((node) => node.userData.workbenchProduct),
      root = roots[0],
      poses = [],
      lights = []
    if (roots.length !== 1 || !root) throw new Error('Exactly one actual product root is required')
    scene.updateMatrixWorld(true)
    root.traverse((node) =>
      poses.push([
        node.uuid,
        node.visible,
        ...transforms.flatMap((key) => node[key].toArray()),
        ...(node.morphTargetInfluences ?? []),
      ]),
    )
    scene.traverse((node) => {
      if (!node.isLight) return
      node.target?.updateMatrixWorld(true)
      lights.push({
        values: scalar(node),
        ...arrays(node, ['color', 'groundColor', ...transforms]),
        layers: node.layers.mask,
        target: node.target?.matrixWorld.toArray(),
        shadow: node.shadow
          ? {
              bias: node.shadow.bias,
              normalBias: node.shadow.normalBias,
              radius: node.shadow.radius,
              intensity: node.shadow.intensity,
              mapSize: node.shadow.mapSize.toArray(),
              camera: {
                ...scalar(node.shadow.camera),
                ...arrays(node.shadow.camera, ['projectionMatrix']),
              },
            }
          : null,
      })
    })
    return {
      product: {
        slug: root.userData.workbenchProduct,
        adapter: root.userData.adapter,
        source: root.userData.sourceKind,
        version: root.userData.bundleVersion,
        sha256: root.userData.bundleSha256,
      },
      fixed: {
        camera: {
          ...scalar(camera),
          ...arrays(camera, [...transforms, 'projectionMatrix', 'projectionMatrixInverse']),
        },
        exposure: renderer.toneMappingExposure,
        toneMapping: renderer.toneMapping,
        lights,
        poses,
        environment: {
          id: scene.environment?.uuid,
          version: scene.environment?.version,
          intensity: scene.environmentIntensity,
          rotation: scene.environmentRotation.toArray(),
        },
        motion: test.motion.states.value,
        finish: test.store.finishId,
      },
      identity: {
        canvases: document.querySelectorAll('canvas').length,
        sameCanvas: renderer.domElement === test.canvas,
        sameRenderer: renderer === test.renderer,
        sameCamera: camera === window.__noiseCamera,
        webgpu: renderer.backend?.isWebGPUBackend === true,
      },
      output: {
        width: renderer.domElement.width,
        height: renderer.domElement.height,
        dpr: window.devicePixelRatio,
        pixelRatio: renderer.getPixelRatio(),
      },
      lighting: window.__noiseLighting.snapshot(),
    }
  })
}
function verify(value, baseline) {
  healthy(value.lighting)
  assert.deepEqual(value.identity, {
    canvases: 1,
    sameCanvas: true,
    sameRenderer: true,
    sameCamera: true,
    webgpu: true,
  })
  assert.deepEqual(value.output, { ...viewport, dpr: 1, pixelRatio: 1 })
  assert.equal(value.lighting.productProfile, 'reventon-v1')
  assert.equal(value.lighting.indirectLighting.actual, 'ddgi')
  assert.equal(
    value.lighting.indirectLighting.details.scheduling.policy,
    'event-driven-fixed-settling',
  )
  assert.equal(value.lighting.indirectLighting.details.scheduling.cached, true)
  assert.ok(
    Object.values(value.fixed.motion).every((motion) => !motion.playing),
    'Actual motion must be stopped',
  )
  if (baseline) {
    assert.deepEqual(value.product, baseline.product)
    assert.ok(
      JSON.stringify(value.fixed) === JSON.stringify(baseline.fixed),
      'Actual camera/projection, exposure, lights, pose or motion changed',
    )
  }
}
try {
  assert.ok(
    ['original', 'runtime-v2'].includes(asset),
    'REVENTON_ASSET must be original or runtime-v2',
  )
  let candidate
  if (asset === 'runtime-v2') {
    try {
      candidate = JSON.parse(await readFile('src/lib/workbench/reventonRuntimeBundle.json', 'utf8'))
      assert.deepEqual(
        candidate,
        JSON.parse(
          await readFile('public/models/reventon-runtime-v2/bundle-reference.json', 'utf8'),
        ),
      )
      const manifestPath = 'public/models/reventon-runtime-v2/workbench-manifest.json',
        bytes = await readFile(manifestPath),
        manifest = JSON.parse(bytes)
      assert.equal(createHash('sha256').update(bytes).digest('hex'), candidate.sha256)
      for (const file of manifest.files) await access(resolve(dirname(manifestPath), file.path))
    } catch (cause) {
      throw new Error(
        'runtime-v2 is not completely generated/registered locally; no candidate URL requested',
        { cause },
      )
    }
  }
  const response = await fetch(new URL('/api/v1/products/reventon', base))
  assert.equal(response.status, 200, 'Actual Reventon API')
  const product = await response.json(),
    source = product.presentation.source,
    bundle = candidate ?? source.bundle
  assert.equal(source.kind, 'glb')
  assert.equal(source.adapter, 'reventon-v1')
  report.source = source
  report.bundle = bundle
  const manifestResponse = await fetch(new URL(bundle.manifest, base))
  assert.equal(manifestResponse.status, 200, 'Actual selected manifest')
  const manifestBytes = Buffer.from(await manifestResponse.arrayBuffer()),
    manifest = JSON.parse(manifestBytes)
  assert.equal(createHash('sha256').update(manifestBytes).digest('hex'), bundle.sha256)
  assert.ok(
    manifest.files.some(
      (file) => file.path === manifest.entry && file.role === 'model' && /\.glb$/i.test(file.path),
    ),
  )
  const url = new URL('/?product=reventon&renderPipeline=realtime&indirectLighting=ddgi', base)
  if (candidate) url.searchParams.set('reventonAsset', 'runtime-v2')
  report.url = url.href
  browser = await chromium.launch({ channel: 'msedge', headless: true })
  context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    reducedMotion: 'no-preference',
  })
  page = await context.newPage()
  page.on('pageerror', (error) => report.errors.push({ type: 'pageerror', message: error.message }))
  page.on('console', (message) => {
    if (message.type() === 'error') report.errors.push({ type: 'console', message: message.text() })
  })
  page.on('request', (request) => report.requests.push(request.url()))
  page.on('requestfailed', (request) =>
    report.failedRequests.push({ url: request.url(), reason: request.failure()?.errorText }),
  )
  stage = 'load'
  await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 90000 })
  await page.waitForFunction(
    () =>
      ['ready', 'error', 'content'].includes(document.querySelector('.workbench')?.dataset.status),
    null,
    { timeout: 300000 },
  )
  await expect(page.locator('.workbench')).toHaveAttribute('data-status', 'ready')
  await attach()
  stage = 'ddgi-cache'
  await waitFor(
    (value) =>
      value.indirectLighting.actual === 'ddgi' &&
      value.indirectLighting.details?.scheduling?.cached &&
      !value.indirectLighting.details.inFlight,
    'DDGI ready/cached',
    180000,
  )
  report.baseline = await snapshot()
  verify(report.baseline)
  assert.deepEqual(report.baseline.product, {
    slug: 'reventon',
    adapter: 'reventon-v1',
    source: 'glb',
    version: bundle.version,
    sha256: bundle.sha256,
  })
  await save('baseline', report.baseline)
  for (const mode of modes) {
    stage = mode.id
    console.log(JSON.stringify({ event: 'reventon-noise-mode', mode: mode.id }))
    const before = await page.evaluate(({ ssr, ssgi }) => {
      const lighting = window.__noiseLighting
      lighting.setSignals(ssr, ssgi, true)
      return lighting.snapshot()
    }, mode)
    await waitFor((value) => value.frames >= before.frames + 40, `${mode.id}: 40 completed frames`)
    const after = await snapshot()
    await save(mode.id, { mode, before, after })
    verify(after, report.baseline)
    assert.deepEqual(after.lighting.signals, { ssr: mode.ssr, ssgi: mode.ssgi, denoise: true })
    if (mode.ssr) {
      assert.ok(
        after.lighting.reflectionKernel.frames >= before.reflectionKernel.frames + 40,
        'SSR prepare/commit did not advance with completed frames',
      )
      assert.equal(after.lighting.reflectionKernel.prepared, false)
      assert.equal(after.lighting.reflectionHistory.valid, true)
      await save(`${mode.id}-history-pixels`, await historyPixels())
    }
    const capture = `${output}/${mode.id}.png`
    await page.screenshot({ path: capture, fullPage: false, timeout: 30000 })
    report.captures.push({
      id: mode.id,
      capture,
      frames: after.lighting.frames - before.frames,
      snapshot: `${mode.id}.json`,
    })
  }
  report.final = await snapshot()
  await save('final', report.final)
  verify(report.final, report.baseline)
  assert.ok(
    report.requests.some(
      (url) => url === new URL(manifest.entry, new URL(bundle.manifest, base)).href,
    ),
    'Real selected GLB was not requested',
  )
  report.passed = true
} catch (cause) {
  report.failure = {
    stage,
    message: cause.message,
    stack: cause.stack,
    cause: String(cause.cause ?? ''),
  }
  if (page && !page.isClosed()) {
    report.failureSnapshot = await snapshot().catch((error) => ({ error: String(error) }))
    await page.screenshot({ path: `${output}/failure.png`, timeout: 10000 }).catch(() => {})
  }
  process.exitCode = 1
} finally {
  if (page && !page.isClosed())
    await page.evaluate(() => window.__restoreNoiseCopy?.()).catch(() => {})
  for (const resource of [page, context, browser]) {
    try {
      await resource?.close()
    } catch (error) {
      report.errors.push({ type: 'cleanup', message: String(error) })
      report.passed = false
      process.exitCode = 1
    }
  }
  report.finishedAt = new Date().toISOString()
  await save('report', report)
  console.log(
    JSON.stringify({
      passed: report.passed,
      stage,
      captures: report.captures.length,
      report: `${output}/report.json`,
      visualQualityValidated: false,
      performanceValidated: false,
    }),
  )
}

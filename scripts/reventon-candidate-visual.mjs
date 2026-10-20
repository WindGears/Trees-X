/* global URL, fetch, AbortSignal, window, document, innerWidth, innerHeight, requestAnimationFrame */
import assert from 'node:assert/strict'
import { chromium, expect } from '@playwright/test'
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { digest } from './asset-package.mjs'
import { bridge } from './demo/browser-check.mjs'
import {
  reviewedSourceIdentity,
  verifyRuntime,
} from './reventon-runtime-v2/build-runtime-verify.mjs'

const options = {
  base: process.env.CHECK_URL || 'http://127.0.0.1:5181',
  asset: process.env.REVENTON_ASSET || 'original',
  pipeline: process.env.REVENTON_PIPELINE || 'webgl',
  indirect: process.env.REVENTON_INDIRECT || 'ddgi',
  loading: process.env.REVENTON_LOADING || 'legacy',
  channel: process.env.REVENTON_BROWSER_CHANNEL || 'msedge',
  headless: process.env.REVENTON_HEADED !== '1' && process.env.REVENTON_HEADLESS !== '0',
}
for (const [key, values] of Object.entries({
  asset: ['original', 'runtime-v2'],
  pipeline: ['webgl', 'realtime'],
  indirect: ['ssgi', 'ddgi'],
  loading: ['legacy', 'streaming'],
}))
  assert.ok(values.includes(options[key]), `Invalid REVENTON_${key.toUpperCase()}`)
const output = resolve(
  process.env.REVENTON_VISUAL_OUTPUT ||
    `artifacts/car-runtime-v2/${options.asset}-${options.pipeline}-visual`,
)
const url = new URL('/', options.base)
url.searchParams.set('product', 'reventon')
url.searchParams.set('renderPipeline', options.pipeline)
if (options.pipeline === 'realtime') url.searchParams.set('indirectLighting', options.indirect)
if (options.loading === 'streaming') url.searchParams.set('assetLoading', 'streaming')
if (options.asset === 'runtime-v2') url.searchParams.set('reventonAsset', 'runtime-v2')
const timeout = 240000
const report = {
  schemaVersion: 1,
  passed: false,
  passedMeaning:
    'The real frontend capture and interaction checks completed; images need human review.',
  fixture: false,
  visualQualityValidated: false,
  presentedFrameBudgetValidated: false,
  startedAt: new Date().toISOString(),
  options,
  url: url.href,
  output,
  stage: 'preflight',
  captures: [],
  requests: [],
  failedRequests: [],
  httpErrors: [],
  errors: [],
  gpuErrors: [],
  requestOrigins: [],
  sameOrigin: false,
  checks: [],
}
let browser, page, product, bundle
await mkdir(output, { recursive: true })

async function unlocked() {
  try {
    await lstat('public/models/reventon-runtime-v2/.trace-finalize.lock')
  } catch (error) {
    if (error.code === 'ENOENT') return
    throw error
  }
  throw new Error('Runtime package is still trace-finalizing; visual preflight is blocked')
}

async function responseBytes(resource) {
  const address = new URL(resource, url)
  assert.equal(address.origin, url.origin, 'Preflight resources must be same-origin')
  const response = await fetch(address, { signal: AbortSignal.timeout(90000) })
  assert.ok(response.ok, `HTTP ${response.status}: ${address.href}`)
  assert.equal(new URL(response.url).origin, url.origin, 'No cross-origin resource redirects')
  return Buffer.from(await response.arrayBuffer())
}

async function preflight() {
  product = JSON.parse(await responseBytes('/api/v1/products/reventon'))
  const presentation = product.presentation
  assert.equal(product.slug, 'reventon')
  assert.equal(presentation.version, 3)
  assert.equal(presentation.source.kind, 'glb')
  assert.equal(presentation.source.adapter, 'reventon-v1')
  assert.equal(presentation.source.bundle.id, 'reventon-workbench')
  assert.equal(presentation.source.bundle.version, 1, 'Use the audited original API source')
  assert.equal(presentation.source.bundle.manifest, '/models/reventon/workbench-manifest.json')
  assert.equal(presentation.source.bundle.sha256, reviewedSourceIdentity.sourceManifestSha256)
  for (const [id, count, type] of [
    ['open-doors', 2, 'rotate'],
    ['explore-parts', 7, 'translate'],
  ]) {
    const action = presentation.actions.find((entry) => entry.id === id)
    assert.equal(action?.motion?.tracks?.length, count, 'Authored car motion tracks: ' + id)
    assert.ok(action.motion.tracks.every((track) => track.type === type))
  }
  bundle = presentation.source.bundle
  if (options.asset === 'runtime-v2') {
    await unlocked()
    const descriptor = JSON.parse(await readFile('src/lib/workbench/reventonRuntimeBundle.json'))
    const reference = JSON.parse(
      await readFile('public/models/reventon-runtime-v2/bundle-reference.json'),
    )
    assert.deepEqual(
      descriptor,
      reference,
      'Registered and produced candidate references must agree',
    )
    // This mode performs no finalization, report write, metadata write or registration.
    const checked = await verifyRuntime(process.cwd(), { writeReport: false })
    assert.equal(checked.passed, true)
    assert.equal(checked.traceFinalized, true)
    assert.deepEqual(descriptor, checked.bundle, 'Only a complete verified candidate can be viewed')
    await unlocked()
    bundle = descriptor
    report.candidatePreflight = {
      passed: true,
      readOnly: true,
      bundle,
      ktxTextures: checked.textures.length,
      traceTextures: checked.traceTextures.length,
      traceFinalized: checked.traceFinalized,
      bytes: checked.bytes,
    }
  }
  const manifestBytes = await responseBytes(bundle.manifest)
  assert.equal(
    digest(manifestBytes),
    bundle.sha256,
    'Served manifest matches the selected descriptor',
  )
  const manifest = JSON.parse(manifestBytes)
  assert.equal(manifest.id, bundle.id)
  assert.equal(manifest.version, bundle.version)
  report.bundle = { ...bundle, files: manifest.files.length, bytes: manifest.budget.maxBytes }
  report.product = {
    slug: product.slug,
    name: product.name,
    presentationVersion: presentation.version,
  }
  report.checks.push('Real API and selected served manifest match the audited bundle identity')
}

async function attach() {
  await bridge(page, true)
  await page.evaluate(
    (names) => {
      const context = window.__demo.scene
      const root = context.scene.value.children.find((node) => node.userData.workbenchProduct)
      if (!root) throw new Error('Actual product root is missing')
      const seen = new Set()
      const lighting = (vnode) => {
        if (!vnode || typeof vnode !== 'object' || seen.has(vnode)) return
        seen.add(vnode)
        const current = vnode.component
        if (current) {
          for (const exposed of [current.exposed, current.refs?.sceneHost]) {
            const host = exposed?.value ?? exposed
            const value = host?.realLighting?.value ?? host?.realLighting
            if (value?.snapshot) return value
          }
          const child = lighting(current.subTree)
          if (child) return child
        }
        if (Array.isArray(vnode.children))
          for (const child of vnode.children) {
            const found = lighting(child)
            if (found) return found
          }
        return lighting(vnode.suspense?.activeBranch)
      }
      const renderer = context.renderer.instance
      window.__carVisual = {
        root,
        renderer,
        canvas: renderer.domElement,
        nodes: names.map((name) => {
          const node = root.getObjectByName(name)
          if (!node) throw new Error('Required actual motion node is missing: ' + name)
          return node
        }),
        lighting: lighting(document.querySelector('#app')?._vnode),
        gpuErrors: [],
      }
      renderer.backend?.device?.addEventListener('uncapturederror', (event) => {
        window.__carVisual.gpuErrors.push(event.error?.message ?? 'Unknown WebGPU error')
      })
    },
    [
      ...new Set(
        product.presentation.actions.flatMap((action) =>
          (action.motion?.tracks ?? []).map((track) => track.node),
        ),
      ),
    ],
  )
}

async function state() {
  return page.evaluate(() => {
    const scene = window.__demo.scene
    const camera = scene.camera.activeCamera.value
    const test = window.__carVisual
    const canvas = document.querySelector('canvas')
    const rect = canvas.getBoundingClientRect()
    const renderer = scene.renderer.instance
    return {
      slug: test.root.userData.workbenchProduct,
      source: test.root.userData.sourceKind,
      adapter: test.root.userData.adapter,
      bundleVersion: test.root.userData.bundleVersion,
      bundleSha256: test.root.userData.bundleSha256,
      sourceTriangles: test.root.userData.triangles,
      canvases: document.querySelectorAll('canvas').length,
      sameCanvas: canvas === test.canvas,
      sameRenderer: renderer === test.renderer,
      sameRoot:
        scene.scene.value.children.filter((node) => node.userData.workbenchProduct).length === 1 &&
        scene.scene.value.children.includes(test.root),
      backend: renderer.backend?.isWebGPUBackend ? 'webgpu' : 'webgl',
      camera: {
        position: camera.position.toArray(),
        direction: camera.getWorldDirection(camera.position.clone()).toArray(),
        quaternion: camera.quaternion.toArray(),
        projection: camera.projectionMatrix.toArray(),
      },
      motion: { ...window.__demo.motion.states.value },
      nodes: Object.fromEntries(
        test.nodes.map((node) => [
          node.name,
          {
            position: node.position.toArray(),
            quaternion: node.quaternion.toArray(),
            scale: node.scale.toArray(),
          },
        ]),
      ),
      selectedPart: window.__demo.store.selectedPart,
      viewId: window.__demo.store.viewId,
      panel: window.__demo.store.panel,
      finishId: window.__demo.store.finishId,
      output: {
        width: canvas.width,
        height: canvas.height,
        cssWidth: rect.width,
        cssHeight: rect.height,
        dpr: window.devicePixelRatio,
        rendererPixelRatio: renderer.getPixelRatio(),
      },
      viewport: { width: innerWidth, height: innerHeight },
      layout: {
        documentWidth: document.documentElement.scrollWidth,
        bodyWidth: document.body.scrollWidth,
        horizontalOverflow:
          Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) >
          innerWidth + 1,
      },
      lighting: test.lighting?.snapshot() ?? null,
      gpuErrors: [...test.gpuErrors],
      memory: { ...renderer.info.memory },
    }
  })
}

function cameraError(actual, expected) {
  const direction = expected.target.map((value, index) => value - expected.position[index])
  const length = Math.hypot(...direction)
  return Math.max(
    ...actual.position.map((value, index) => Math.abs(value - expected.position[index])),
    ...actual.direction.map((value, index) => Math.abs(value - direction[index] / length)),
  )
}

async function settled(expectedCamera, targets = {}) {
  let previous = null,
    stable = 0
  const firstFrame = (await state()).lighting?.frames ?? 0
  await expect
    .poll(
      async () => {
        const current = await state()
        if (current.lighting?.error) throw new Error(current.lighting.error)
        if (current.lighting?.indirectLighting?.error)
          throw new Error(current.lighting.indirectLighting.error)
        assert.deepEqual(current.gpuErrors, [])
        const complete =
          Object.values(current.motion).every((motion) => !motion.playing) &&
          Object.entries(targets).every(
            ([id, target]) => Math.abs((current.motion[id]?.progress ?? -1) - target) < 1e-7,
          ) &&
          cameraError(current.camera, expectedCamera) < 1e-6 &&
          (options.pipeline !== 'realtime' || current.lighting?.frames >= firstFrame + 2)
        const signature = JSON.stringify({
          camera: current.camera,
          motion: current.motion,
          output: current.output,
          nodes: current.nodes,
        })
        stable = complete && signature === previous ? stable + 1 : 0
        previous = signature
        return stable >= 3
      },
      { timeout, intervals: [50, 100, 200] },
    )
    .toBe(true)
  // Await submitted work and browser composition without drawing an extra frame or
  // creating a renderer. Camera/motion completion above is based on actual state.
  await page.evaluate(async () => {
    await window.__demo.scene.renderer.instance.backend?.device?.queue.onSubmittedWorkDone()
    await new Promise(requestAnimationFrame)
    await new Promise(requestAnimationFrame)
  })
}

async function capture(name, expectedCamera, targets, source = null) {
  report.stage = name
  await page.evaluate(() => document.fonts.ready)
  await page.mouse.move(1, 1)
  await settled(expectedCamera, targets)
  const actual = await state()
  assert.equal(page.context().pages().length, 1, 'One real frontend page only')
  assert.equal(actual.slug, 'reventon')
  assert.equal(actual.source, 'glb')
  assert.equal(actual.adapter, 'reventon-v1')
  assert.equal(actual.bundleVersion, bundle.version)
  assert.equal(actual.bundleSha256, bundle.sha256)
  assert.equal(actual.canvases, 1)
  assert.equal(actual.sameCanvas && actual.sameRenderer && actual.sameRoot, true)
  assert.equal(actual.backend, options.pipeline === 'realtime' ? 'webgpu' : 'webgl')
  assert.equal(actual.layout.horizontalOverflow, false, 'No horizontal page overflow')
  assert.equal(actual.output.width, actual.viewport.width, 'Device-scale-one actual drawing width')
  assert.equal(
    actual.output.height,
    actual.viewport.height,
    'Device-scale-one actual drawing height',
  )
  const file = name + '.png'
  await page.screenshot({ path: resolve(output, file), fullPage: false })
  report.captures.push({ name, file, source, expectedCamera, ...actual })
  console.log(JSON.stringify({ event: 'reventon-visual-capture', name, output: actual.output }))
  return actual
}

async function panel(label, selector) {
  const trigger = page.getByRole('button', { name: label, exact: true })
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click()
  await expect(trigger).toHaveAttribute('aria-expanded', 'true')
  await expect(page.locator(selector)).toBeVisible()
}

async function view(id) {
  const named = product.presentation.views.find((entry) => entry.id === id)
  assert.ok(named, 'Required named view: ' + id)
  await page.getByLabel('观察视角', { exact: true }).selectOption(id)
  return { position: named.position, target: named.target }
}

async function focus(id) {
  const named = product.presentation.hotspots.find((entry) => entry.id === id)
  assert.ok(named, 'Required named hotspot: ' + id)
  await panel('细节', '.wb-part-list')
  const target = await page.evaluate((hotspot) => {
    const camera = window.__demo.scene.camera.activeCamera.value
    const node = window.__carVisual.root.getObjectByName(hotspot.node)
    if (!node) throw new Error('Hotspot actual GLB node is missing')
    return node
      .localToWorld(camera.position.clone().fromArray(hotspot.anchor ?? [0, 0, 0]))
      .toArray()
  }, named)
  await page.locator('.wb-part-list').getByRole('button', { name: named.name, exact: true }).click()
  return { position: target.map((value, index) => value + named.cameraOffset[index]), target }
}

async function play(id, target = 1) {
  const action = product.presentation.actions.find((entry) => entry.id === id)
  assert.ok(action?.motion, 'Required actual motion action: ' + id)
  await panel('结构与动作', '.wb-car-motion')
  await page
    .locator(`.wb-car-motion [data-motion-id="${id}"]`)
    .getByRole('button', {
      name: target ? action.motion.openLabel : action.motion.closeLabel,
      exact: true,
    })
    .click()
}

function restoredPose(actual, initial) {
  for (const [name, node] of Object.entries(initial))
    for (const channel of ['position', 'quaternion', 'scale'])
      node[channel].forEach((value, index) =>
        assert.ok(
          Math.abs(actual[name][channel][index] - value) <= 1e-8,
          `Restored actual ${name}.${channel}[${index}]`,
        ),
      )
}

try {
  await preflight()
  report.stage = 'launch'
  browser = await chromium.launch({ channel: options.channel, headless: options.headless })
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
  })
  page = await context.newPage()
  page.setDefaultTimeout(30000)
  page.on('pageerror', (error) => report.errors.push({ type: 'pageerror', message: error.message }))
  page.on('console', (message) => {
    if (message.type() === 'error') report.errors.push({ type: 'console', message: message.text() })
  })
  page.on('request', (request) =>
    report.requests.push({
      url: request.url(),
      method: request.method(),
      type: request.resourceType(),
    }),
  )
  page.on('requestfailed', (request) =>
    report.failedRequests.push({ url: request.url(), error: request.failure()?.errorText }),
  )
  page.on('response', (response) => {
    if (response.status() >= 400)
      report.httpErrors.push({ url: response.url(), status: response.status() })
  })
  report.stage = 'real-glb-ready'
  await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 90000 })
  await page.waitForFunction(
    () =>
      ['ready', 'error', 'content'].includes(document.querySelector('.workbench')?.dataset.status),
    null,
    { timeout },
  )
  if ((await page.locator('.workbench').getAttribute('data-status')) !== 'ready')
    throw new Error(await page.locator('.wb-stage-status').innerText())
  await expect(page.locator('.workbench')).toHaveAttribute('data-slug', 'reventon')
  await expect(page.locator('canvas')).toHaveCount(1)
  await attach()
  if (options.pipeline === 'realtime') {
    await expect
      .poll(
        async () => {
          const value = await state()
          if (value.lighting?.error || value.lighting?.indirectLighting?.error)
            throw new Error(value.lighting.error || value.lighting.indirectLighting.error)
          return (
            value.lighting?.phase === 'ready' &&
            value.lighting?.indirectLighting?.actual === options.indirect
          )
        },
        { timeout, intervals: [100, 250, 500] },
      )
      .toBe(true)
  }
  const zero = { 'open-doors': 0, 'explore-parts': 0 }
  const overview = product.presentation.views.find((entry) => entry.id === 'perspective')
  assert.ok(overview)
  for (const [width, height] of [
    [1280, 720],
    [1440, 1000],
    [1920, 1080],
    [390, 844],
    [320, 760],
  ]) {
    await page.setViewportSize({ width, height })
    await capture('whole-' + width, overview, zero, {
      kind: 'view',
      id: overview.id,
      label: overview.label,
    })
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  const baseline = await state()
  let camera
  for (const [name, id] of [
    ['paint-body', 'body'],
    ['wheel-front', 'wheel_1_1'],
    ['door-right', 'door_1'],
  ]) {
    camera = await focus(id)
    const named = product.presentation.hotspots.find((entry) => entry.id === id)
    await capture(name + '-1440', camera, zero, { kind: 'hotspot', id, label: named.name })
  }
  await play('open-doors')
  const opened = await capture('open-doors-1440', camera, { ...zero, 'open-doors': 1 })
  assert.notDeepEqual(opened.nodes, baseline.nodes, 'Actual door transforms must change')
  camera = await view('car-cabin')
  await capture(
    'cabin-1440',
    camera,
    { ...zero, 'open-doors': 1 },
    { kind: 'view', id: 'car-cabin', label: '座舱观察' },
  )
  camera = await view('car-structure')
  await settled(camera, { ...zero, 'open-doors': 1 })
  await play('explore-parts')
  const separated = await capture('separated-1440', camera, { 'open-doors': 1, 'explore-parts': 1 })
  assert.notDeepEqual(separated.nodes, opened.nodes, 'Actual separation transforms must change')
  await page
    .locator('.wb-car-motion')
    .getByRole('button', { name: '复原动作', exact: true })
    .click()
  const restored = await capture('restored-actions-1440', camera, zero)
  restoredPose(restored.nodes, baseline.nodes)
  await page.getByRole('button', { name: '复位视角', exact: true }).click()
  camera = overview
  for (const [width, height] of [
    [390, 844],
    [320, 760],
  ]) {
    await page.setViewportSize({ width, height })
    await capture('actions-' + width, camera, zero)
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.getByRole('button', { name: '结构与动作', exact: true }).click()
  await capture('restored-whole-1440', camera, zero)
  report.requestOrigins = [
    ...new Set(
      report.requests
        .filter((request) => /^https?:/.test(request.url))
        .map((request) => new URL(request.url).origin),
    ),
  ]
  report.sameOrigin =
    report.requestOrigins.length > 0 &&
    report.requestOrigins.every((origin) => origin === url.origin)
  report.gpuErrors = (await state()).gpuErrors
  assert.equal(report.sameOrigin, true, 'Browser requests remain same-origin')
  assert.deepEqual(report.errors, [])
  assert.deepEqual(report.gpuErrors, [])
  assert.deepEqual(report.failedRequests, [])
  assert.deepEqual(report.httpErrors, [])
  report.checks.push(
    'One actual GLB root, Canvas and renderer persist through every view, action and viewport',
    'Five viewport sizes and mobile action panels have no horizontal overflow',
    'Named views and actual open/separate transforms completed; motion nodes restored within 1e-8',
  )
  report.stage = 'complete'
  report.passed = true
} catch (error) {
  report.failure = { message: error.message, stack: error.stack }
  if (page)
    await page.screenshot({ path: resolve(output, 'failure.png'), fullPage: true }).catch(() => {})
  process.exitCode = 1
} finally {
  if (page)
    report.gpuErrors = await page
      .evaluate(() => window.__carVisual?.gpuErrors ?? [])
      .catch(() => report.gpuErrors)
  report.requestOrigins = [
    ...new Set(
      report.requests
        .filter((request) => /^https?:/.test(request.url))
        .map((request) => new URL(request.url).origin),
    ),
  ]
  report.sameOrigin =
    report.requestOrigins.length > 0 &&
    report.requestOrigins.every((origin) => origin === url.origin)
  await browser?.close().catch((error) => {
    report.errors.push({ type: 'browser-close', message: error.message })
  })
  if (
    report.errors.length ||
    report.gpuErrors.length ||
    report.failedRequests.length ||
    report.httpErrors.length ||
    !report.sameOrigin
  ) {
    report.passed = false
    process.exitCode = 1
  }
  report.completedAt = new Date().toISOString()
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
}
console.log(
  JSON.stringify({
    passed: report.passed,
    visualQualityValidated: false,
    captures: report.captures.length,
    output,
    failure: report.failure?.message,
  }),
)

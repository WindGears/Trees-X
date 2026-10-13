/* global URL, URLSearchParams, performance, setTimeout, MutationObserver */
import { chromium, expect } from '@playwright/test'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import {
  readProducts,
  productEvidence,
  bridge,
  inputPoint,
  openPanel,
} from './demo/browser-check.mjs'

const base = process.env.CHECK_URL || 'http://127.0.0.1:5183'
const output = process.env.REALTIME_CHECK_OUTPUT || 'artifacts/realtime-workbench'
const scope = process.env.REALTIME_CHECK_SCOPE || 'core'
const timeout = Number(process.env.REALTIME_CHECK_TIMEOUT || 240000)
const callbackFailureMessage = 'Trees X controlled renderer error callback test'
if (
  ![
    'core',
    'performance',
    'long',
    'soak',
    'visibility',
    'faults',
    'visual',
    'quality',
    'admin',
    'all',
  ].includes(scope)
)
  throw new Error('Invalid REALTIME_CHECK_SCOPE')
if (!Number.isFinite(timeout) || timeout < 1000) throw new Error('Invalid REALTIME_CHECK_TIMEOUT')
const viewport = { width: 1440, height: 1000 }
const started = Date.now()
let stage = 'initialization',
  page,
  browser
const report = {
  passed: false,
  fullJointAcceptance: false,
  scope,
  origin: new URL(base).origin,
  viewport,
  fixture: false,
  startedAt: new Date().toISOString(),
  checks: [],
  pending: [],
  snapshots: {},
  pixels: {},
  captures: [],
  interactions: [],
  reloads: [],
  resourceChecks: [],
  errors: [],
  expectedErrors: [],
  failedRequests: [],
  expectedCancellationRequests: [],
  requestFailureEvents: [],
  cancellationWindows: [],
  requests: [],
  measurementMethod:
    'Test-window instrumentation wraps the existing Three inspector begin/finish for complete successful coordinator frames. Timestamps describe JS render-command submission completion intervals and CPU submission duration, not GPU elapsed time or displayed-frame timing. Passing the submission-interval goal does not validate the real presented-frame budget; frameBudgetValidated remains false. No extra rendering clock, geometry replacement, API fixture or quality reduction is installed.',
  frameBudgetValidated: false,
  memoryMethod:
    'renderer.info.memory reports Three-tracked live resources and estimated allocated byte sizes. These are lifecycle counters, not measured physical VRAM, process memory or a hardware residency budget.',
  deferredJointChecks: [
    '20-minute continuous joint demonstration',
    'Real device-loss recovery and failure injection',
    'Six fixed-view quality acceptance and desktop/mobile layout batch',
    'User visual and interaction acceptance',
  ],
}
const progress = (next, detail) => {
  stage = next
  console.log(`[realtime ${Math.round((Date.now() - started) / 1000)}s] ${next}`, detail ?? '')
}
const includes = (name) => scope === name || scope === 'all'
await mkdir(output, { recursive: true })

function distribution(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const percentile = (fraction) => sorted[Math.floor((sorted.length - 1) * fraction)] ?? null
  return {
    samples: sorted.length,
    minMs: sorted[0] ?? null,
    medianMs: percentile(0.5),
    p95Ms: percentile(0.95),
    maxMs: sorted.at(-1) ?? null,
    meanMs: sorted.length ? sorted.reduce((sum, value) => sum + value, 0) / sorted.length : null,
  }
}

function physicalProjectionComparison(realtime, webgl, label, tolerance = 1e-6) {
  const gpu = realtime.cameraProjection,
    gl = webgl.cameraProjection
  if (gpu?.type !== 'PerspectiveCamera' || gl?.type !== 'PerspectiveCamera')
    throw new Error(`${label}: real perspective-camera metadata is required`)
  if (gpu.coordinateSystem !== 2001 || gl.coordinateSystem !== 2000)
    throw new Error(`${label}: expected native WebGPU and WebGL coordinate systems`)
  if (gpu.reversedDepth || gl.reversedDepth)
    throw new Error(`${label}: reversed-depth comparison requires its own depth contract`)
  const differences = {}
  const difference = (left, right, field) => {
    if (!Number.isFinite(left) || !Number.isFinite(right))
      throw new Error(`${label}: non-finite camera or projection value at ${field}`)
    const error = Math.abs(left - right)
    if (error > tolerance)
      throw new Error(`${label}: ${field} differs by ${error} (tolerance ${tolerance})`)
    return error
  }
  for (const field of ['fov', 'aspect', 'zoom', 'near', 'far', 'filmGauge', 'filmOffset'])
    differences[field] = difference(gpu[field], gl[field], field)
  if (Boolean(gpu.view) !== Boolean(gl.view))
    throw new Error(`${label}: view-offset presence differs`)
  if (gpu.view) {
    if (gpu.view.enabled !== gl.view.enabled)
      throw new Error(`${label}: view-offset enabled state differs`)
    for (const field of ['fullWidth', 'fullHeight', 'offsetX', 'offsetY', 'width', 'height'])
      differences[`view.${field}`] = difference(gpu.view[field], gl.view[field], `view.${field}`)
  }
  for (const matrix of [realtime.projection, webgl.projection])
    if (!Array.isArray(matrix) || matrix.length !== 16 || !matrix.every(Number.isFinite))
      throw new Error(`${label}: actual projection matrix must contain 16 finite values`)
  const commonProjectionErrors = realtime.projection
    .map((value, index) =>
      index === 10 || index === 14
        ? null
        : difference(value, webgl.projection[index], `projection[${index}]`),
    )
    .filter((value) => value !== null)
  // Three r185 uses [-1, 1] NDC depth for WebGL and [0, 1] for WebGPU.
  // The same physical frustum therefore differs only at matrix entries 10/14:
  // z_gpu = (z_gl + w) / 2, with this perspective matrix's w = -z_view.
  const depthMappingErrors = [
    difference(realtime.projection[10], (webgl.projection[10] - 1) / 2, 'depth mapping[10]'),
    difference(realtime.projection[14], webgl.projection[14] / 2, 'depth mapping[14]'),
  ]
  return {
    physicalCameraMaxError: Math.max(0, ...Object.values(differences)),
    physicalCameraFieldErrors: differences,
    commonProjectionMaxError: Math.max(0, ...commonProjectionErrors),
    commonProjectionIndices: Array.from({ length: 16 }, (_, index) => index).filter(
      (index) => index !== 10 && index !== 14,
    ),
    coordinateSystemDepthDifference: {
      webgl: { coordinateSystem: gl.coordinateSystem, ndcDepthRange: [-1, 1] },
      realtime: { coordinateSystem: gpu.coordinateSystem, ndcDepthRange: [0, 1] },
      clipConversion: 'z_webgpu = 0.5 * z_webgl + 0.5 * w; x/y/w unchanged',
      webglDepthTerms: [webgl.projection[10], webgl.projection[14]],
      realtimeDepthTerms: [realtime.projection[10], realtime.projection[14]],
      rawDepthTermDifferences: [10, 14].map((index) =>
        Math.abs(realtime.projection[index] - webgl.projection[index]),
      ),
      mappingMaxError: Math.max(0, ...depthMappingErrors),
      expectedBackendDifference: true,
    },
  }
}

const resourceTolerance = {
  renderTargets: 0,
  geometries: 2,
  attributes: 4,
  programs: 2,
  uniformBuffers: 8,
  textures: 2,
  total: 2 * 1024 * 1024,
}

function resourceAssessment(reloads, baseline) {
  const latest = reloads.at(-1)
  const values = {}
  for (const [key, tolerance] of Object.entries(resourceTolerance)) {
    const value = latest.memory[key],
      initial = baseline[key]
    if (!Number.isFinite(value) || !Number.isFinite(initial))
      throw new Error(`Native WebGPU memory counter is unavailable: ${key}`)
    const trailing = reloads.slice(-4).map((entry) => entry.memory[key])
    const differences = trailing.slice(1).map((item, index) => item - trailing[index])
    values[key] = {
      value,
      baseline: initial,
      delta: value - initial,
      tolerance,
      exceeded: value - initial > tolerance,
      trailingDeltas: differences,
      sustainedGrowth:
        differences.length === 3 &&
        differences.every((delta) => delta > 0) &&
        value - initial > tolerance,
    }
  }
  // A repeated identical model cannot legitimately acquire another large set of
  // screen targets. Fail immediately after warmup rather than accumulate GBs.
  const largeTargetLeak =
    values.total.delta > 64 * 1024 * 1024 &&
    values.renderTargets.exceeded &&
    values.textures.exceeded
  const sustained = Object.entries(values)
    .filter(([, value]) => value.sustainedGrowth)
    .map(([key]) => key)
  return {
    reload: latest.index,
    values,
    largeTargetLeak,
    sustained,
    earlyFailure: largeTargetLeak || sustained.length > 0,
  }
}
const intervals = (times) => times.slice(1).map((time, index) => time - times[index])
const lighting = () => page.evaluate(() => window.__realtimeTest?.snapshot())
const requestStarts = new WeakMap()
let cancellationWindow

function beginCancellationWindow(metadata, reason) {
  if (cancellationWindow) throw new Error('Cancellation evidence windows must not overlap')
  const window = {
    id: report.cancellationWindows.length + 1,
    reason,
    stage,
    startedElapsedMs: performance.now(),
    startedAt: new Date().toISOString(),
    maxDurationMs: 60000,
    allowedUrls: metadata.manifest.files.map(
      (file) => new URL(file.path, metadata.manifestUrl).href,
    ),
    candidates: [],
    verified: false,
  }
  cancellationWindow = window
  report.cancellationWindows.push(window)
  return window
}

function closeCancellationWindow(window) {
  if (cancellationWindow === window) cancellationWindow = undefined
  if (window.closedAt) return
  window.closedElapsedMs = performance.now()
  window.closedAt = new Date().toISOString()
}

function verifyCancellationWindow(window, evidence) {
  closeCancellationWindow(window)
  window.verified = true
  window.evidence = evidence
  for (const candidate of window.candidates) {
    const index = report.failedRequests.indexOf(candidate)
    if (index === -1) throw new Error('Cancellation candidate absent from failed-request evidence')
    report.failedRequests.splice(index, 1)
    report.expectedCancellationRequests.push({ ...candidate, verifiedBy: evidence })
  }
}

async function attachLighting() {
  // Vue's real retained VNode tree exposes the scene-local coordinator. The
  // disposable browser test owns this window reference; production adds no global debug API.
  await page.evaluate(() => {
    const seen = new Set()
    const visit = (vnode) => {
      if (!vnode || typeof vnode !== 'object' || seen.has(vnode)) return
      seen.add(vnode)
      const current = vnode.component
      if (current) {
        const exposed = current.exposed?.realLighting,
          value = exposed?.value ?? exposed
        if (value?.snapshot && value?.setSignals) return value
        const found = visit(current.subTree)
        if (found) return found
      }
      if (Array.isArray(vnode.children))
        for (const child of vnode.children) {
          const found = visit(child)
          if (found) return found
        }
      return visit(vnode.suspense?.activeBranch)
    }
    const value = visit(document.querySelector('#app')?._vnode)
    if (!value) throw new Error('Real WorkbenchScene realLighting exposure absent')
    window.__realtimeTest = value
  })
  await expect.poll(lighting, { timeout: 10000 }).not.toBeUndefined()
}

async function ready(metadata, remember = false, backend = 'webgpu') {
  await expect(page.locator('.workbench')).toHaveAttribute('data-slug', metadata.product.slug)
  await expect
    .poll(
      async () => {
        const state = await page.evaluate(() => ({
          status: document.querySelector('.workbench')?.dataset.status,
          text: document.querySelector('.wb-stage-status')?.textContent,
        }))
        if (state.status === 'error' || state.status === 'content')
          throw new Error(`Real workbench failed: ${state.status}: ${state.text}`)
        return state.status
      },
      { timeout, intervals: [250, 500, 1000] },
    )
    .toBe('ready')
  await expect(page.locator('canvas')).toHaveCount(1)
  await expect(page.locator('.wb-stage')).toHaveAttribute('data-render-backend', backend)
  await bridge(page, remember)
  if (backend !== 'webgpu') return
  await attachLighting()
  const state = await lighting()
  expect(state.phase).toBe('ready')
  expect(state.error).toBeNull()
  expect(state.firstRasterMs).toBeGreaterThanOrEqual(0)
}

async function waitFrames(count = 24) {
  const previous = await lighting()
  await expect
    .poll(
      async () => {
        const current = await lighting()
        if (current?.error) throw new Error(`Real-time pipeline error: ${current.error}`)
        return current?.frames ?? previous.frames
      },
      { timeout, intervals: [50, 100, 250] },
    )
    .toBeGreaterThanOrEqual(previous.frames + count)
}

async function actual() {
  return page.evaluate(() => {
    const context = window.__demo.scene,
      scene = context.scene.value,
      renderer = context.renderer.instance,
      root = scene.children.find((node) => node.userData.workbenchProduct),
      camera = context.camera.activeCamera.value
    if (!root) throw new Error('Real product root absent')
    const parts = [],
      poses = [],
      identities = [],
      materials = [],
      sourceMaterials = [],
      lights = []
    const materialInputs = (material) => [
      material.name,
      material.color?.getHexString(),
      material.roughness,
      material.metalness,
      material.clearcoat,
      material.clearcoatRoughness,
      material.anisotropy,
      material.anisotropyRotation,
      material.transmission,
      material.thickness,
      material.ior,
      material.opacity,
      material.transparent,
      material.envMapIntensity,
      material.alphaTest,
      ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'clearcoatMap'].map((name) => {
        const texture = material[name]
        return texture
          ? {
              slot: name,
              name: texture.name,
              width: texture.image?.width ?? null,
              height: texture.image?.height ?? null,
              colorSpace: texture.colorSpace,
              type: texture.type,
              mapping: texture.mapping,
            }
          : { slot: name, absent: true }
      }),
    ]
    let meshes = 0,
      instances = 0,
      triangles = 0
    root.traverse((node) => {
      if (Number.isInteger(node.userData.partId)) parts.push(node.name)
      poses.push([
        node.name,
        ...node.position.toArray(),
        ...node.quaternion.toArray(),
        ...node.scale.toArray(),
      ])
      if (!node.isMesh) return
      meshes++
      const count = node.isInstancedMesh ? node.count : 1
      instances += node.isInstancedMesh ? node.count : 0
      triangles +=
        ((node.geometry.index?.count ?? node.geometry.attributes.position.count) / 3) * count
      if (node.isInstancedMesh) poses.push([`${node.name}:instances`, ...node.instanceMatrix.array])
      const values = Array.isArray(node.material) ? node.material : [node.material]
      identities.push([
        node.name,
        node.type,
        count,
        node.geometry.attributes.position.count,
        node.geometry.index?.count ?? 0,
        values.map((material) => material.name),
      ])
      for (const material of values) {
        materials.push(materialInputs(material))
        sourceMaterials.push(
          materialInputs(material.source?.isMaterial ? material.source : material),
        )
      }
    })
    const device = renderer.backend?.device,
      canvas = document.querySelector('canvas')
    scene.traverse((node) => {
      if (!node.isLight) return
      lights.push({
        name: node.name,
        type: node.type,
        color: node.color.getHexString(),
        intensity: node.intensity,
        width: node.width ?? null,
        height: node.height ?? null,
        position: node.position.toArray(),
        world: node.matrixWorld.toArray(),
      })
    })
    return {
      roots: scene.children
        .filter((node) => node.userData.workbenchProduct)
        .map((node) => node.userData.workbenchProduct),
      rootUuid: root.uuid,
      source: root.userData.sourceKind,
      adapter: root.userData.adapter,
      bundle: root.userData.assetBundle,
      semanticParts: parts.length,
      sourceTriangles: root.userData.triangles,
      meshes,
      instances,
      triangles,
      parts,
      poses,
      identities,
      materials,
      sourceMaterials,
      camera: [...camera.position.toArray(), ...camera.quaternion.toArray()],
      cameraProjection: {
        type: camera.type,
        coordinateSystem: camera.coordinateSystem,
        reversedDepth: camera.reversedDepth,
        fov: camera.fov,
        aspect: camera.aspect,
        zoom: camera.zoom,
        near: camera.near,
        far: camera.far,
        filmGauge: camera.filmGauge,
        filmOffset: camera.filmOffset,
        view: camera.view ? { ...camera.view } : null,
      },
      projection: camera.projectionMatrix.toArray(),
      selectedPart: window.__demo.store.selectedPart,
      motion: Object.fromEntries(
        Object.entries(window.__demo.motion.states.value).map(([id, value]) => [
          id,
          { progress: value.progress, target: value.target, playing: value.playing },
        ]),
      ),
      sameCanvas: canvas === window.__demo.canvas,
      sameRenderer: renderer === window.__demo.renderer,
      outputResolution: { width: canvas.width, height: canvas.height },
      pixelRatio: renderer.getPixelRatio(),
      memory: { ...renderer.info.memory },
      renderSettings: {
        toneMapping: renderer.toneMapping,
        exposure: renderer.toneMappingExposure,
        outputColorSpace: renderer.outputColorSpace,
        environmentIntensity: scene.environmentIntensity,
        background: scene.background?.isColor
          ? scene.background.getHexString()
          : (scene.background?.name ?? null),
        environment: scene.environment
          ? {
              name: scene.environment.name,
              mapping: scene.environment.mapping,
              type: scene.environment.type,
              colorSpace: scene.environment.colorSpace,
              width: scene.environment.image?.width ?? null,
              height: scene.environment.image?.height ?? null,
              reference: scene.environment.userData?.reference
                ? { ...scene.environment.userData.reference }
                : null,
            }
          : null,
        stageInput: window.__demo.store.presentation.stage ?? null,
        lights,
      },
      webgpu: Boolean(
        renderer.isWebGPURenderer && renderer.backend?.isWebGPUBackend && device?.queue,
      ),
      adapterInfo: device?.adapterInfo
        ? {
            vendor: device.adapterInfo.vendor,
            architecture: device.adapterInfo.architecture,
            device: device.adapterInfo.device,
            description: device.adapterInfo.description,
          }
        : null,
    }
  })
}

function compact(snapshot) {
  const { poses, identities, materials, sourceMaterials, parts, ...value } = snapshot
  const hash = (input) => createHash('sha256').update(JSON.stringify(input)).digest('hex')
  return {
    ...value,
    poseDigest: hash(poses),
    identityDigest: hash(identities),
    materialDigest: hash(materials),
    sourceMaterialDigest: hash(sourceMaterials),
    partNamesDigest: hash(parts),
  }
}

async function save(name) {
  const snapshot = await actual(),
    state = await lighting()
  const png = await page.locator('canvas').screenshot(),
    stats = await sharp(png).stats()
  await writeFile(`${output}/${name}.canvas.png`, png)
  await page.screenshot({ path: `${output}/${name}.png`, fullPage: true })
  expect(Math.max(...stats.channels.slice(0, 3).map((channel) => channel.stdev))).toBeGreaterThan(3)
  report.snapshots[name] = { ...compact(snapshot), lighting: state, canvasPngBytes: png.length }
  await writeFile(`${output}/${name}.json`, `${JSON.stringify(report.snapshots[name], null, 2)}\n`)
  report.captures.push(name)
  return snapshot
}

async function compare(beforeName, afterName) {
  const decode = (name) =>
    sharp(`${output}/${name}.canvas.png`).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const [before, after] = await Promise.all([decode(beforeName), decode(afterName)])
  expect(after.info).toEqual(before.info)
  let squared = 0,
    changed = 0
  const { width, height, channels } = before.info
  for (let pixel = 0; pixel < width * height; pixel++) {
    let difference = 0
    for (let channel = 0; channel < channels; channel++) {
      const offset = pixel * channels + channel,
        delta = after.data[offset] - before.data[offset]
      squared += delta * delta
      difference += Math.abs(delta)
    }
    if (difference > 12) changed++
  }
  return {
    width,
    height,
    rms: Math.sqrt(squared / before.data.length),
    changedFraction: changed / (width * height),
  }
}

async function setSignals(ssr, ssgi, denoise = true) {
  await page.evaluate(
    ({ ssr, ssgi, denoise }) => window.__realtimeTest.setSignals(ssr, ssgi, denoise),
    { ssr, ssgi, denoise },
  )
  await waitFrames(24)
  expect((await lighting()).signals).toEqual({ ssr, ssgi, denoise })
}

async function stableMotion(actionId) {
  await expect
    .poll(async () => (await actual()).motion[actionId]?.playing, {
      timeout: 15000,
      intervals: [100],
    })
    .toBe(false)
  await waitFrames(2)
  return actual()
}

async function observe() {
  const point = await inputPoint(page)
  await page.mouse.move(point.x, point.y)
  await page.mouse.down()
  await page.mouse.move(point.x + 55, point.y + 15, { steps: 5 })
  await page.mouse.up()
}

async function sustainedInteraction(metadata, actionId, initial) {
  // This scope is deliberately opt-in and has no duration override. The Node
  // monotonic clock measures real elapsed time; no virtual browser clock is used.
  const minimumDurationMs = 20 * 60 * 1000,
    hotspot = metadata.product.presentation.hotspots.find((part) => part.marker !== false),
    strike = metadata.product.presentation.actions.find(
      (action) => action.behavior?.type === 'typewriter-strike',
    ),
    identity = compact(initial).identityDigest
  if (!hotspot || !strike || metadata.product.presentation.guide.length < 2)
    throw new Error(
      'Published typewriter lacks the actual hotspot, strike or guide needed for soak',
    )
  report.soak = {
    minimumDurationMs,
    passed: false,
    cycles: 0,
    checkpoints: [],
    operations: {},
    timingMethod:
      'At least 1200000 ms of real Node monotonic and wall-clock elapsed time after one complete warmup operation cycle. Existing coordinator complete-frame counters confirm continued render-command submission; they do not measure GPU elapsed time or displayed-frame timing.',
    resourcePolicy: {
      warmupCycles: 1,
      tolerance: resourceTolerance,
      baseline:
        'Fixed native counters after one complete actual operation cycle and 24 complete frames',
      rebased: false,
      earlyFailure:
        'Existing large-target and three-consecutive-increment guards apply to minute checkpoints',
      finalCheck: 'All native counters must remain inside the fixed warm-baseline tolerance',
    },
  }
  report.measurementMethod = report.soak.timingMethod
  let checkpoint = async () => {}
  const operation = async (name, callback) => {
    await callback()
    report.soak.operations[name] = (report.soak.operations[name] ?? 0) + 1
    await checkpoint()
  }
  const cycle = async (index) => {
    await operation('strike', async () => {
      await openPanel(page, '结构与动作', '.wb-layout-motion')
      await page.getByRole('button', { name: strike.label, exact: true }).click()
      await page.waitForTimeout(850)
    })
    await operation('expand-pause', async () => {
      await page.getByRole('button', { name: '分层展开', exact: true }).click()
      await page.waitForTimeout(200)
      await page
        .locator('.wb-layout-motion')
        .getByRole('button', { name: '暂停', exact: true })
        .click()
      const stopped = await stableMotion(actionId)
      expect(stopped.motion[actionId].progress).toBeGreaterThan(0)
      expect(stopped.motion[actionId].progress).toBeLessThan(0.6)
    })
    await operation('seek-current-controller', async () => {
      // Visitor UI intentionally has no slider. This calls the exact existing
      // scene-intent contract, without installing an alternative rig or animation.
      const target = 0.18 + (index % 5) * 0.07
      await page.evaluate(
        ({ actionId, target }) => window.__demo.store.motion('seek', actionId, target),
        { actionId, target },
      )
      expect((await stableMotion(actionId)).motion[actionId].progress).toBe(target)
    })
    await operation('mouse-observe', async () => {
      await observe()
      const point = await inputPoint(page)
      await page.mouse.move(point.x, point.y)
      await page.mouse.wheel(0, index % 2 ? -60 : 60)
      await waitFrames(6)
    })
    await operation('focus-hotspot', async () => {
      await openPanel(page, '细节', '.wb-part-list')
      await page
        .locator('.wb-part-list')
        .getByRole('button', { name: hotspot.name, exact: true })
        .click()
      await expect
        .poll(() => page.evaluate(() => window.__demo.store.selectedPart))
        .toBe(hotspot.id)
      await page.waitForTimeout(900)
    })
    await operation('guide-forward-backward', async () => {
      await openPanel(
        page,
        '导览',
        '.wb-guide-count, .wb-panel-content button:has-text("开始导览")',
      )
      await page.getByRole('button', { name: '开始导览', exact: true }).click()
      await page.waitForTimeout(900)
      await page.getByRole('button', { name: '下一步', exact: true }).click()
      await page.waitForTimeout(900)
      await expect.poll(() => page.evaluate(() => window.__demo.store.guideStep)).toBe(1)
      await page.getByRole('button', { name: '上一步', exact: true }).click()
      await page.waitForTimeout(900)
      await expect.poll(() => page.evaluate(() => window.__demo.store.guideStep)).toBe(0)
      await page.getByRole('button', { name: '退出导览，保留当前观察', exact: true }).click()
    })
    await operation('reverse-restore', async () => {
      await openPanel(page, '结构与动作', '.wb-layout-motion')
      await page.getByRole('button', { name: '平铺部件', exact: true }).click()
      expect((await stableMotion(actionId)).motion[actionId].progress).toBe(1)
      await page.getByRole('button', { name: '合拢整机', exact: true }).click()
      expect((await stableMotion(actionId)).motion[actionId].progress).toBe(0)
      await page.getByRole('button', { name: '还原商品', exact: true }).click()
      await stableMotion(actionId)
      await page.waitForTimeout(900)
      expect((await actual()).poses).toEqual(initial.poses)
    })
    await operation('panel-close-reopen', async () => {
      const before = await actual()
      await page.getByRole('button', { name: '收起面板', exact: true }).click()
      await page.waitForTimeout(400)
      await openPanel(page, '结构与动作', '.wb-layout-motion')
      await page.waitForTimeout(400)
      const after = await actual()
      expect(after.poses).toEqual(before.poses)
      expect(after.camera).toEqual(before.camera)
    })
  }

  progress('Continuous-operation warmup without replacing the product or renderer')
  await cycle(0)
  await waitFrames(24)
  const baseline = compact(await actual()),
    initialLighting = await lighting(),
    soakStarted = performance.now(),
    wallStarted = Date.now()
  let previousFrames = initialLighting.frames,
    nextCheckpoint = 60 * 1000
  report.soak.startedAt = new Date(wallStarted).toISOString()
  report.soak.baseline = { ...baseline, lighting: initialLighting }
  await save('soak-start')
  checkpoint = async (force = false) => {
    const elapsedMs = performance.now() - soakStarted
    if (!force && elapsedMs < nextCheckpoint) return
    const snapshot = await actual(),
      current = compact(snapshot),
      lightingState = await lighting()
    await expect(page.locator('canvas')).toHaveCount(1)
    expect(current.roots).toEqual(['typewriter-study'])
    expect(current.rootUuid).toBe(baseline.rootUuid)
    expect(current.identityDigest).toBe(identity)
    expect(current.semanticParts).toBe(572)
    expect(current.instances).toBe(2257)
    expect(current.sameCanvas && current.sameRenderer).toBe(true)
    expect(snapshot.camera.every(Number.isFinite)).toBe(true)
    expect(snapshot.projection.every(Number.isFinite)).toBe(true)
    expect(snapshot.poses.every((pose) => pose.slice(1).every(Number.isFinite))).toBe(true)
    expect(lightingState.error).toBeNull()
    expect(lightingState.phase).toBe('ready')
    expect(lightingState.frames).toBeGreaterThan(previousFrames)
    expect(report.errors).toEqual([])
    expect(report.failedRequests).toEqual([])
    const entry = {
      index: report.soak.checkpoints.length + 1,
      elapsedMs,
      wallElapsedMs: Date.now() - wallStarted,
      ...current,
      lighting: lightingState,
    }
    report.soak.checkpoints.push(entry)
    const assessment = resourceAssessment(report.soak.checkpoints, baseline.memory)
    entry.resources = assessment
    previousFrames = lightingState.frames
    nextCheckpoint = (Math.floor(elapsedMs / 60000) + 1) * 60000
    report.soak.elapsedMs = elapsedMs
    report.soak.wallElapsedMs = entry.wallElapsedMs
    await writeFile(`${output}/partial-report.json`, `${JSON.stringify(report, null, 2)}\n`)
    progress(`Continuous-operation checkpoint ${entry.index}`, {
      elapsedMs: Math.round(elapsedMs),
      cycles: report.soak.cycles,
      completeFrames: lightingState.frames - initialLighting.frames,
      fixedBaselineDeltaBytes: assessment.values.total.delta,
    })
    if (assessment.earlyFailure)
      throw new Error(
        `Sustained native resource growth during soak: ${assessment.largeTargetLeak ? 'large target allocation leak' : assessment.sustained.join(', ')}`,
      )
  }
  while (
    performance.now() - soakStarted < minimumDurationMs ||
    Date.now() - wallStarted < minimumDurationMs
  ) {
    await cycle(report.soak.cycles + 1)
    report.soak.cycles++
  }
  await waitFrames(24)
  await checkpoint(true)
  const finalResources = report.soak.checkpoints.at(-1).resources
  for (const [key, value] of Object.entries(finalResources.values))
    expect(
      value.delta,
      `${key}: twenty-minute soak cannot exceed fixed warm resources`,
    ).toBeLessThanOrEqual(value.tolerance)
  expect(report.soak.elapsedMs).toBeGreaterThanOrEqual(minimumDurationMs)
  expect(report.soak.wallElapsedMs).toBeGreaterThanOrEqual(minimumDurationMs)
  expect(report.soak.cycles).toBeGreaterThan(0)
  await save('soak-finished')
  report.soak.passed = true
  report.soak.completedAt = new Date().toISOString()
  report.soak.resourceSummary = finalResources
  report.deferredJointChecks = report.deferredJointChecks.filter(
    (item) => item !== '20-minute continuous joint demonstration',
  )
  report.checks.push(
    'Twenty real wall-clock minutes of repeated actual strike, reversible structure, mouse observation, hotspot focus, guide and panel operations preserve the same real typewriter, host, finite poses, continued complete-frame submission and fixed warm resource bounds; this is stability evidence, not GPU or displayed-frame timing',
  )
}

async function realVisibility(actionId, strict = false) {
  progress('Actual browser visibility pause and resume')
  const session = await page.context().newCDPSession(page)
  const { windowId } = await session.send('Browser.getWindowForTarget'),
    { bounds: originalBounds } = await session.send('Browser.getWindowBounds', { windowId })
  let hidden, foregroundTab
  const evidence = {
    browserMode: process.env.REALTIME_HEADED === '1' ? 'headed' : 'headless',
    observedMethod: null,
    attempts: [],
    passed: false,
    syntheticVisibilityUsed: false,
  }
  report.visibility = evidence
  const waitHidden = async (method) => {
    const attempt = { method, startedAt: new Date().toISOString(), observed: null }
    evidence.attempts.push(attempt)
    try {
      await expect
        .poll(() => page.evaluate(() => document.visibilityState), {
          timeout: 5000,
          intervals: [100, 250],
        })
        .toBe('hidden')
      attempt.observed = 'hidden'
      evidence.observedMethod = method
      return true
    } catch {
      attempt.observed = await page.evaluate(() => document.visibilityState)
      return false
    } finally {
      attempt.completedAt = new Date().toISOString()
    }
  }
  const startMotion = async () => {
    await page.evaluate((id) => window.__demo.store.motion('seek', id, 0.2), actionId)
    expect((await stableMotion(actionId)).motion[actionId].progress).toBe(0.2)
    await page.evaluate((id) => window.__demo.store.motion('play', id, 1), actionId)
    await page.waitForTimeout(150)
    expect((await actual()).motion[actionId].playing).toBe(true)
  }
  try {
    await startMotion()
    await session.send('Browser.setWindowBounds', {
      windowId,
      bounds: { windowState: 'minimized' },
    })
    hidden = await waitHidden('native-window-minimization')
    if (!hidden) {
      // A separate actual tab can hide the original page even when this Edge
      // window manager does not expose minimization to document.visibilityState.
      // No property override, synthetic event or CDP lifecycle pause is used.
      await session.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } })
      foregroundTab = await page.context().newPage()
      await foregroundTab.goto('about:blank')
      await page.bringToFront()
      await expect.poll(() => page.evaluate(() => document.visibilityState)).toBe('visible')
      await expect.poll(async () => (await lighting()).active).toBe(true)
      await startMotion()
      await foregroundTab.bringToFront()
      hidden = await waitHidden('real-foreground-blank-tab')
    }
    if (!hidden) {
      const message = `This ${evidence.browserMode} Edge run did not expose actual hidden-page visibility after native window minimization or a real foreground blank tab. Visibility pause/resume remains unverified; no property override, synthetic event or CDP lifecycle pause was substituted.`
      report.pending.push(message)
      if (strict) throw new Error(message)
    }
    if (hidden) {
      await expect.poll(async () => (await lighting()).active, { timeout: 5000 }).toBe(false)
      const paused = await actual(),
        state = await lighting()
      expect(paused.motion[actionId].playing).toBe(false)
      await page.waitForTimeout(600)
      expect((await lighting()).frames).toBe(state.frames)
      expect((await actual()).poses).toEqual(paused.poses)
      report.snapshots.hidden = { ...compact(paused), lighting: state }
    }
  } finally {
    await foregroundTab?.close()
    await session.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } })
    await page.bringToFront()
    if (originalBounds.windowState !== 'normal')
      await session.send('Browser.setWindowBounds', {
        windowId,
        bounds: { windowState: originalBounds.windowState },
      })
    await session.detach()
  }
  if (hidden) {
    await expect
      .poll(() => page.evaluate(() => document.visibilityState), { timeout: 5000 })
      .toBe('visible')
    await expect.poll(async () => (await lighting()).active, { timeout: 5000 }).toBe(true)
    await waitFrames(4)
    const resumed = await save('visibility-resumed')
    expect(resumed.motion[actionId].playing).toBe(false)
    expect(compact(resumed).poseDigest).toBe(report.snapshots.hidden.poseDigest)
    expect(resumed.sameCanvas && resumed.sameRenderer).toBe(true)
    evidence.passed = true
    report.checks.push(
      'Actual browser visibility stops complete rendering and actions; resume preserves the paused pose',
    )
  }
}

async function beginTiming() {
  await page.evaluate(() => {
    const renderer = window.__demo.scene.renderer.instance,
      inspector = renderer._inspector
    if (!inspector?.begin || !inspector?.finish)
      throw new Error('Inspected r185 clock hooks absent')
    const originalBegin = inspector.begin,
      originalFinish = inspector.finish
    const completions = [],
      cpuDurations = [],
      startMs = performance.now()
    let submissionStart = 0,
      lastFrame = window.__realtimeTest.snapshot().frames
    inspector.begin = function (...args) {
      submissionStart = performance.now()
      return originalBegin.apply(this, args)
    }
    inspector.finish = function (...args) {
      const result = originalFinish.apply(this, args),
        end = performance.now()
      const frames = window.__realtimeTest.snapshot().frames
      if (frames > lastFrame) {
        completions.push(end)
        cpuDurations.push(end - submissionStart)
        lastFrame = frames
      }
      return result
    }
    window.__realtimeTiming = {
      stop() {
        inspector.begin = originalBegin
        inspector.finish = originalFinish
        const result = {
          startMs,
          endMs: performance.now(),
          completions,
          cpuDurations,
          restored: inspector.begin === originalBegin && inspector.finish === originalFinish,
        }
        delete window.__realtimeTiming
        return result
      },
    }
  })
}

async function performanceRounds(metadata) {
  progress('Three 30-second real mouse interaction measurement rounds')
  await page.evaluate(() => window.__demo.store.restore())
  const actionId = metadata.product.presentation.actions.find(
    (action) => action.motion?.program,
  )?.id
  await stableMotion(actionId)
  await page.waitForTimeout(900)
  const initial = compact(await actual())
  for (let round = 1; round <= 3; round++) {
    const point = await inputPoint(page),
      inputTimes = [],
      start = performance.now()
    await beginTiming()
    await page.mouse.move(point.x, point.y)
    await page.mouse.down()
    let measured
    try {
      while (performance.now() - start < 30000) {
        const seconds = (performance.now() - start) / 1000
        await page.mouse.move(
          point.x + 75 * Math.sin(seconds * 0.7),
          point.y + 35 * Math.cos(seconds * 0.55),
        )
        inputTimes.push(performance.now() - start)
        await page.waitForTimeout(16)
      }
    } finally {
      await page.mouse.up()
      measured = await page.evaluate(() => window.__realtimeTiming.stop())
    }
    const snapshot = compact(await actual()),
      state = await lighting()
    const frameIntervals = distribution(intervals(measured.completions))
    const entry = {
      round,
      durationMs: measured.endMs - measured.startMs,
      inputMoves: inputTimes.length,
      inputTimesMs: inputTimes,
      completionTimesMs: measured.completions.map((time) => time - measured.startMs),
      frameSubmissionIntervals: frameIntervals,
      completeFrameSubmissionCpu: distribution(measured.cpuDurations),
      submissionIntervalGoal: { medianMs: 33.3, p95Ms: 45 },
      submissionIntervalGoalMet:
        frameIntervals.medianMs !== null &&
        frameIntervals.medianMs <= 33.3 &&
        frameIntervals.p95Ms <= 45,
      instrumentationRestored: measured.restored,
      scene: snapshot,
      lighting: state,
    }
    expect(entry.durationMs).toBeGreaterThanOrEqual(30000)
    expect(entry.inputMoves).toBeGreaterThan(10)
    expect(frameIntervals.samples).toBeGreaterThan(10)
    expect(entry.instrumentationRestored).toBe(true)
    expect(snapshot.identityDigest).toBe(initial.identityDigest)
    expect(snapshot.poseDigest).toBe(initial.poseDigest)
    expect(snapshot.sameCanvas && snapshot.sameRenderer).toBe(true)
    expect(snapshot.outputResolution).toEqual(viewport)
    report.interactions.push(entry)
    await writeFile(
      `${output}/interaction-round-${round}.json`,
      `${JSON.stringify(entry, null, 2)}\n`,
    )
    progress(`Measured round ${round}`, {
      frameSubmissionIntervals: frameIntervals,
      submissionIntervalGoalMet: entry.submissionIntervalGoalMet,
    })
  }
  report.submissionIntervalGoalMet = report.interactions.every(
    (entry) => entry.submissionIntervalGoalMet,
  )
  report.checks.push(
    'Three full 30-second measurements use actual pointer interaction at native 1440×1000; submission-interval goals are recorded separately from the unvalidated displayed-frame budget',
  )
}

async function faultRecovery(metadata, actionId) {
  progress('Injected model download failure')
  const downloadCancellation = beginCancellationWindow(metadata, 'injected-model-503')
  let failures = 0
  const failDownload = async (route) => {
    failures++
    await route.fulfill({
      status: 503,
      contentType: 'text/plain',
      body: 'Intentional browser-test model outage',
    })
  }
  await page.route(metadata.modelUrl, failDownload)
  try {
    await page.evaluate(() => window.__demo.store.retry())
    await expect(page.locator('.workbench')).toHaveAttribute('data-status', 'error', { timeout })
    await expect(page.getByRole('button', { name: '重新加载', exact: true })).toBeVisible()
    expect(failures).toBeGreaterThan(0)
    const failed = await page.evaluate(() => ({
      roots: window.__demo.scene.scene.value.children
        .filter((node) => node.userData.workbenchProduct)
        .map((node) => node.userData.workbenchProduct),
      sameRenderer: window.__demo.scene.renderer.instance === window.__demo.renderer,
      sameCanvas: document.querySelector('canvas') === window.__demo.canvas,
    }))
    expect(failed.roots).toEqual([])
    expect(failed.sameRenderer && failed.sameCanvas).toBe(true)
    report.snapshots.failedDownload = {
      failures,
      ...failed,
      visibleMessage: await page.locator('.wb-stage-status').innerText(),
    }
    // Let requestfailed events caused by the failed parallel transfer reach
    // Playwright while this exact injected-outage window is still active.
    await page.waitForTimeout(200)
  } finally {
    closeCancellationWindow(downloadCancellation)
    await page.unroute(metadata.modelUrl, failDownload)
  }
  progress('Retry genuine model after restoring download')
  await page.getByRole('button', { name: '重新加载', exact: true }).click()
  await ready(metadata)
  await waitFrames(6)
  const recovered = await save('download-recovered')
  expect(recovered.roots).toEqual(['typewriter-study'])
  expect(recovered.source).toBe('glb')
  expect(recovered.adapter).toBe('typewriter-v1')
  expect(recovered.bundle).toBe(`${metadata.manifest.id}@${metadata.manifest.version}`)
  expect(compact(recovered).identityDigest).toBe(report.snapshots.initial.identityDigest)
  expect(recovered.semanticParts).toBe(572)
  expect(recovered.instances).toBe(2257)
  expect(recovered.sameCanvas && recovered.sameRenderer).toBe(true)
  expect((await lighting()).phase).toBe('ready')
  expect((await lighting()).error).toBeNull()
  expect((await lighting()).firstRasterMs).toBeGreaterThanOrEqual(0)
  verifyCancellationWindow(downloadCancellation, {
    method:
      'The injected model HTTP 503 causes loadBundle to abort its parallel same-bundle transfers; exemption is validated only after genuine same-host recovery',
    injected503Responses: failures,
    failedRoots: report.snapshots.failedDownload.roots,
    failedSameRenderer: report.snapshots.failedDownload.sameRenderer,
    failedSameCanvas: report.snapshots.failedDownload.sameCanvas,
    recoveredRoot: recovered.rootUuid,
    recoveredIdentityDigest: compact(recovered).identityDigest,
    realGlbBundle: recovered.bundle,
    recoveredFirstRasterMs: (await lighting()).firstRasterMs,
  })
  report.checks.push(
    'A real model HTTP 503 clears the old scene and displays retry; restoring the same real resource recovers without replacing the renderer or substituting a model',
  )

  progress('Controlled renderer error callback integration (not native GPU fault)')
  await openPanel(page, '结构与动作', '.wb-layout-motion')
  await page.getByRole('button', { name: '平铺部件', exact: true }).click()
  await page.waitForTimeout(150)
  const beforeCallback = await actual()
  expect(beforeCallback.motion[actionId].playing).toBe(true)
  expect(beforeCallback.motion[actionId].progress).toBeGreaterThan(0)
  expect(beforeCallback.motion[actionId].progress).toBeLessThan(1)
  // Exercise the installed integration callback. This does not induce a real
  // GPU validation fault, alter a shader, or replace the renderer/rig.
  await page.evaluate((message) => {
    window.__demo.scene.renderer.instance.onError({
      api: 'WebGPU',
      type: 'validation',
      message,
    })
  }, callbackFailureMessage)
  await expect(page.locator('.workbench')).toHaveAttribute('data-status', 'error')
  const loopActive = () => page.evaluate(() => window.__demo.scene.renderer.loop.isActive.value)
  await expect.poll(loopActive).toBe(false)
  const paused = await save('callback-error-paused'),
    pausedLighting = await lighting()
  expect(pausedLighting).toMatchObject({
    phase: 'error',
    active: false,
    error: callbackFailureMessage,
  })
  expect(paused.motion[actionId].playing).toBe(false)
  await page.waitForTimeout(400)
  expect((await lighting()).frames).toBe(pausedLighting.frames)
  expect((await actual()).poses).toEqual(paused.poses)
  expect((await actual()).camera).toEqual(paused.camera)

  // Error UI still permits closing the panel and opening the catalog. Their
  // real viewport-framing transitions must not restart a failed draw loop.
  await page.getByRole('button', { name: '收起面板', exact: true }).click()
  await page.waitForTimeout(400)
  await page.getByRole('button', { name: '商品目录', exact: true }).click()
  await expect(page.locator('#wb-catalog')).toBeVisible()
  await page.waitForTimeout(400)
  await page.getByRole('button', { name: '关闭目录', exact: true }).click()
  await page.waitForTimeout(400)
  const afterPanels = await actual()
  expect(await loopActive()).toBe(false)
  expect((await lighting()).frames).toBe(pausedLighting.frames)
  expect(afterPanels.poses).toEqual(paused.poses)
  expect(afterPanels.camera).toEqual(paused.camera)
  expect(afterPanels.sameCanvas && afterPanels.sameRenderer).toBe(true)
  report.snapshots.callbackError = {
    method:
      'Controlled renderer.onError callback integration; not a real GPU validation/device failure',
    message: callbackFailureMessage,
    before: compact(beforeCallback),
    paused: { ...compact(paused), lighting: pausedLighting },
    afterPanels: compact(afterPanels),
    loopStopped: true,
  }

  progress('Retry after controlled error callback with the same renderer')
  await page.getByRole('button', { name: '重新加载', exact: true }).click()
  await ready(metadata)
  await waitFrames(6)
  const callbackRecovered = await save('callback-error-recovered')
  expect(callbackRecovered.rootUuid).not.toBe(paused.rootUuid)
  expect(callbackRecovered.roots).toEqual(['typewriter-study'])
  expect(callbackRecovered.source).toBe('glb')
  expect(callbackRecovered.semanticParts).toBe(572)
  expect(callbackRecovered.instances).toBe(2257)
  expect(callbackRecovered.bundle).toBe(recovered.bundle)
  expect(compact(callbackRecovered).identityDigest).toBe(compact(recovered).identityDigest)
  expect(callbackRecovered.motion[actionId].progress).toBe(0)
  expect(callbackRecovered.sameCanvas && callbackRecovered.sameRenderer).toBe(true)
  expect((await lighting()).error).toBeNull()
  expect((await lighting()).active).toBe(true)
  expect((await lighting()).firstRasterMs).toBeGreaterThanOrEqual(0)
  expect(await loopActive()).toBe(true)
  await openPanel(page, '结构与动作', '.wb-layout-motion')
  await page.getByRole('button', { name: '分层展开', exact: true }).click()
  expect((await stableMotion(actionId)).motion[actionId].progress).toBe(0.6)
  await page.getByRole('button', { name: '复原动作', exact: true }).click()
  expect((await stableMotion(actionId)).motion[actionId].progress).toBe(0)
  report.snapshots.callbackError.recovery = {
    ...compact(callbackRecovered),
    lighting: await lighting(),
    subsequentStructureActionPassed: true,
  }
  report.checks.push(
    'A controlled renderer.onError callback during real structure playback pauses the actual pose and complete-frame/Tres clocks; panel transitions cannot wake the failed loop; explicit retry loads a new real GLB root on the same Canvas/renderer and restores actions. This checks callback integration, not a real GPU validation fault.',
  )

  progress('Native WebGPU device loss and checkpoint recovery')
  await page.evaluate((id) => window.__demo.store.motion('seek', id, 0.37), actionId)
  await waitFrames(4)
  const focus =
    metadata.product.presentation.hotspots.find((hotspot) => hotspot.marker) ??
    metadata.product.presentation.hotspots[0]
  await page.evaluate((id) => window.__demo.store.focus(id), focus.id)
  await page.waitForTimeout(900)
  const before = await save('device-loss-before')
  expect(before.motion[actionId].playing).toBe(false)
  const deviceCancellation = beginCancellationWindow(metadata, 'native-device-rebuild')
  try {
    await page.evaluate(() => {
      const renderer = window.__demo.scene.renderer.instance,
        device = renderer.backend?.device
      if (!device?.destroy) throw new Error('Native GPUDevice.destroy is unavailable')
      window.__deviceRecoveryTest = {
        renderer,
        canvas: document.querySelector('canvas'),
        reason: null,
        maxCanvas: document.querySelectorAll('canvas').length,
      }
      const observer = new MutationObserver(() => {
        window.__deviceRecoveryTest.maxCanvas = Math.max(
          window.__deviceRecoveryTest.maxCanvas,
          document.querySelectorAll('canvas').length,
        )
      })
      observer.observe(document.querySelector('#app'), { subtree: true, childList: true })
      window.__deviceRecoveryTest.observer = observer
      void device.lost.then((value) => {
        window.__deviceRecoveryTest.reason = value.reason
      })
      device.destroy()
    })
    await page.waitForFunction(() => window.__deviceRecoveryTest.reason !== null, null, {
      timeout: 30000,
    })
    await page.waitForFunction(
      () => document.querySelector('canvas') !== window.__deviceRecoveryTest.canvas,
      null,
      { timeout: 30000 },
    )
    await ready(metadata, true)
    await waitFrames(6)
    const after = await save('device-loss-recovered')
    const recovery = await page.evaluate(() => {
      const state = window.__deviceRecoveryTest
      state.observer.disconnect()
      return {
        reason: state.reason,
        maxCanvas: state.maxCanvas,
        rendererReplaced: state.renderer !== window.__demo.scene.renderer.instance,
      }
    })
    expect(recovery.reason).toBe('destroyed')
    expect(recovery.maxCanvas).toBeLessThanOrEqual(1)
    expect(recovery.rendererReplaced).toBe(true)
    expect(after.webgpu).toBe(true)
    expect(after.roots).toEqual(['typewriter-study'])
    expect(after.bundle).toBe(before.bundle)
    expect(compact(after).identityDigest).toBe(compact(before).identityDigest)
    expect(after.poses).toEqual(before.poses)
    expect(after.motion).toEqual(before.motion)
    expect(after.selectedPart).toBe(before.selectedPart)
    after.camera.forEach((value, index) => expect(value).toBeCloseTo(before.camera[index], 6))
    expect(after.motion[actionId].playing).toBe(false)
    verifyCancellationWindow(deviceCancellation, {
      nativeDeviceLossReason: recovery.reason,
      rendererReplaced: recovery.rendererReplaced,
      maxCanvas: recovery.maxCanvas,
      recoveredRoot: after.rootUuid,
      realGlbBundle: after.bundle,
      currentSelectionRevision: (await lighting()).revision,
      recoveredFirstRasterMs: (await lighting()).firstRasterMs,
    })
    report.snapshots.deviceRecovery = recovery
    report.checks.push(
      'Destroying the actual GPUDevice disposes the old host before creating its replacement, keeps at most one Canvas and restores camera, selected part and paused structure',
    )
    report.deferredJointChecks = report.deferredJointChecks.map((item) =>
      item === 'Real device-loss recovery and failure injection'
        ? 'Remaining shader/parse failures and rapid-generation recovery cases'
        : item,
    )
  } finally {
    if (!deviceCancellation.closedAt) closeCancellationWindow(deviceCancellation)
  }
}

async function visualBatch(metadata, actionId) {
  progress('One batched desktop, basic narrow-screen and reduced-motion screenshot pass')
  const materialPart = metadata.product.presentation.hotspots.find(
    (hotspot) => hotspot.marker && /连接|字杆|金属/.test(hotspot.name),
  )
  report.visualProbe = materialPart
    ? { id: materialPart.id, node: materialPart.node, name: materialPart.name }
    : null
  for (const dimensions of [
    { width: 1280, height: 720 },
    viewport,
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(dimensions)
    await page.goto(new URL('/?product=typewriter-study&renderPipeline=realtime', base).href, {
      waitUntil: 'domcontentloaded',
    })
    await ready(metadata, true)
    await waitFrames(12)
    await save(`visual-${dimensions.width}x${dimensions.height}-whole`)
    if (materialPart) {
      await page.evaluate((id) => window.__demo.store.focus(id), materialPart.id)
      await page.waitForTimeout(900)
      await waitFrames(12)
      await save(`visual-${dimensions.width}x${dimensions.height}-material`)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      dimensions.width + 1,
    )
  }
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 })
    await page.goto(new URL('/?product=typewriter-study&renderPipeline=realtime', base).href, {
      waitUntil: 'domcontentloaded',
    })
    await ready(metadata, true, 'webgl')
    const snapshot = await save(`visual-${width}-webgl-compatibility`)
    expect(snapshot.semanticParts).toBe(572)
    expect(snapshot.webgpu).toBe(false)
    await expect(page.getByRole('button', { name: '复位视角', exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width + 1,
    )
  }
  await page.setViewportSize(viewport)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto(new URL('/?product=typewriter-study&renderPipeline=realtime', base).href, {
    waitUntil: 'domcontentloaded',
  })
  await ready(metadata, true)
  await openPanel(page, '结构与动作', '.wb-layout-motion')
  await page.getByRole('button', { name: '分层展开', exact: true }).click()
  const reduced = await stableMotion(actionId)
  expect(reduced.motion[actionId].playing).toBe(false)
  expect(reduced.motion[actionId].progress).toBe(0.6)
  await save('visual-reduced-motion-layered')
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  report.checks.push(
    'One batch captures three desktop sizes and a configured metal-detail focus; 390/320px retain native WebGL compatibility, while reduced-motion structure reaches its target directly',
  )
}

async function qualityComparison(metadata, actionId) {
  progress('Fixed-pose WebGL/realtime visual-direction comparison (different environment/fill)')
  const cases = [
    { id: 'whole', title: '整机', progress: 0, view: 'perspective' },
    { id: 'paint', title: '漆面 · part-095', progress: 0, part: 'part-095' },
    { id: 'metal', title: '金属观察点 · part-000', progress: 0, part: 'part-000' },
    { id: 'key', title: '键帽 · part-070', progress: 0, part: 'part-070' },
    { id: 'layers', title: '分层 60%', progress: 0.6, view: 'structure' },
    { id: 'flat', title: '平铺 100%', progress: 1, view: 'knoll' },
  ]
  for (const item of cases) {
    if (
      item.part &&
      !metadata.product.presentation.hotspots.some(
        (hotspot) => hotspot.id === item.part || hotspot.node === item.part,
      )
    )
      throw new Error(`Fixed quality part is not bound by the real configuration: ${item.part}`)
    if (item.view && !metadata.product.presentation.views.some((view) => view.id === item.view))
      throw new Error(`Fixed quality view is not in the real configuration: ${item.view}`)
  }
  report.quality = {
    definition:
      'Enhanced production WebGL and corrected realtime use the same published GLB/rig, source PBR inputs and texture dimensions, published stage configuration, three RectAreaLight softboxes, exposure, semantic pose and physical camera including view offset. Lighting intentionally differs: WebGL retains its authored environment at intensity 0.9 and directional fills 0.75/0.35; realtime uses frozen Studio Small 05 HDR at intensity 0.35 and disables those two delta-light fills after raw-reflection isolation isolated their extreme planar-capture highlights. Ambient fill remains 0.16; all light fields except the two directional intensities match. This is a visual-direction comparison, not a matched-lighting algorithm ablation. Lateral projection must match; native WebGL [-1,1] and WebGPU [0,1] depth terms are validated by clip-space conversion rather than full matrix equality. Backend output, BRDF and reflection branches remain separately recorded. Pixel differences are diagnostics, not matched-lighting error or quality scores.',
    matchedLighting: false,
    supplementalLightingContract: {
      sharedSoftboxes: true,
      localLights: false,
      webglDirectionalIntensities: [0.75, 0.35],
      realtimeDirectionalIntensities: [0, 0],
      ambientIntensity: 0.16,
      otherLightFields: 'identical',
      reason:
        'Real native planar reflection A/B removes only directional fills: HDR maximum falls from 16376 to 9.414. Candidate realtime disables these fills rather than clamping radiance or broadening blur; original WebGL lighting remains unchanged.',
    },
    environmentContract: {
      webgl: { kind: 'authored studio environment', intensity: 0.9 },
      realtime: {
        name: 'Trees X / Studio Small 05 reference HDR',
        width: 1024,
        height: 512,
        reference: {
          url: '/textures/studio_small_05_1k.hdr',
          bytes: 1723695,
          sha256: '358d532ee8233f17499830eb512591c1e308ce16ed181e0efc938cb7f0f0e11f',
          intensity: 0.35,
          source: 'Poly Haven / Studio Small 05 / Greg Zaal / CC0',
        },
      },
    },
    visualAcceptance:
      'Pending visual inspection of whole, three detail views, layers and flat poses; successful contract checks alone do not establish higher image quality.',
    cases,
    pairs: [],
    ssrDiagnostics: [],
    previousPathTracing: {
      directory: 'artifacts/renderlab/production-final',
      files: [],
      fairReference: false,
      reason:
        'Existing independent renderlab output also uses Studio Small 05 at environmentIntensity 0.35, but its stage, material preparation and lighting set differ from the live workbench and it omits production reflection/contact-shadow approximations. Matching the HDR alone does not make these images fair references. They remain qualitative direction references; new matched-input path tracing is deferred until the runtime material/UV copy is complete. No path-tracing render or matched-error score is produced in this run.',
    },
  }
  const referenceFiles = await readdir(report.quality.previousPathTracing.directory).catch(
    (error) => {
      if (error.code === 'ENOENT') return []
      throw error
    },
  )
  report.quality.previousPathTracing.files = referenceFiles.filter((name) =>
    /^pathtrace-.*\.(?:png|json)$/.test(name),
  )
  const snapshots = new Map()
  const assertNear = (left, right, label) => {
    expect(left, `${label}: same dimensions`).toHaveLength(right.length)
    const maximum = Math.max(0, ...left.map((value, index) => Math.abs(value - right[index])))
    expect(maximum, `${label}: controlled actual transform`).toBeLessThanOrEqual(1e-6)
    return maximum
  }
  async function settle(item, backend) {
    // Let each normal camera tween finish before issuing another user command.
    // No private camera write, alternate stage or source model is introduced.
    await page.evaluate(() => {
      window.__demo.store.panel = null
      window.__demo.store.restore()
    })
    await page.waitForTimeout(1000)
    await page.evaluate(
      ({ actionId, value }) => window.__demo.store.motion('seek', actionId, value),
      { actionId, value: item.progress },
    )
    await expect
      .poll(
        () =>
          page.evaluate((id) => {
            const value = window.__demo.motion.states.value[id]
            return { progress: value?.progress, playing: value?.playing }
          }, actionId),
        { timeout: 15000, intervals: [100] },
      )
      .toEqual({ progress: item.progress, playing: false })
    if (item.part) {
      const hotspot = metadata.product.presentation.hotspots.find(
        (entry) => entry.id === item.part || entry.node === item.part,
      )
      await page.evaluate((id) => window.__demo.store.focus(id), hotspot.id)
    } else await page.evaluate((id) => window.__demo.store.view(id), item.view)
    await page.evaluate(() => {
      window.__demo.store.panel = null
    })
    await page.waitForTimeout(1000)
    if (backend === 'realtime') await waitFrames(32)
    const snapshot = await actual()
    expect(snapshot.motion[actionId]).toMatchObject({ progress: item.progress, playing: false })
    expect(snapshot.sameCanvas && snapshot.sameRenderer).toBe(true)
    expect(snapshot.outputResolution).toEqual(viewport)
    expect(await page.evaluate(() => window.__demo.store.panel)).toBeNull()
    return snapshot
  }
  for (const backend of ['webgl', 'realtime']) {
    await page.setViewportSize(viewport)
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    const query = new URLSearchParams({ product: 'typewriter-study', renderPipeline: backend })
    await page.goto(new URL(`/?${query}`, base).href, { waitUntil: 'domcontentloaded' })
    await ready(metadata, true, backend === 'webgl' ? 'webgl' : 'webgpu')
    if (backend === 'realtime') await setSignals(true, true, true)
    for (const item of cases) {
      progress(`Quality ${backend}/${item.id}`)
      await settle(item, backend)
      const name = `quality-${backend}-${item.id}`
      const snapshot = await save(name)
      snapshots.set(`${backend}:${item.id}`, snapshot)
      if (backend === 'realtime' && item.part) {
        await setSignals(false, true, true)
        const offName = `quality-realtime-${item.id}-ssr-off`,
          off = await save(offName)
        expect(compact(off).poseDigest).toBe(compact(snapshot).poseDigest)
        expect(compact(off).materialDigest).toBe(compact(snapshot).materialDigest)
        assertNear(off.camera, snapshot.camera, `${item.id} SSR toggle camera`)
        assertNear(off.projection, snapshot.projection, `${item.id} SSR toggle projection`)
        await setSignals(true, true, true)
        const repeatName = `quality-realtime-${item.id}-ssr-on-repeat`,
          repeat = await save(repeatName)
        expect(compact(repeat).poseDigest).toBe(compact(snapshot).poseDigest)
        assertNear(repeat.camera, snapshot.camera, `${item.id} repeated SSR camera`)
        assertNear(repeat.projection, snapshot.projection, `${item.id} repeated SSR projection`)
        report.quality.ssrDiagnostics.push({
          case: item.id,
          sourcePart: item.part,
          onImage: `${name}.canvas.png`,
          offImage: `${offName}.canvas.png`,
          repeatedOnImage: `${repeatName}.canvas.png`,
          offVsOn: await compare(offName, name),
          onVsRepeatedOn: await compare(name, repeatName),
          interpretation:
            'SSR toggles preserve pose, camera and SSGI. Repeated converged on-images can expose remaining temporal variation; this difference alone is not a perceptual noise or quality score.',
        })
      }
    }
  }
  for (const item of cases) {
    const webgl = snapshots.get(`webgl:${item.id}`),
      realtime = snapshots.get(`realtime:${item.id}`)
    const webglCompact = compact(webgl),
      realtimeCompact = compact(realtime)
    expect(realtimeCompact.identityDigest, `${item.id}: same real model identity`).toBe(
      webglCompact.identityDigest,
    )
    expect(realtimeCompact.poseDigest, `${item.id}: identical semantic and instance poses`).toBe(
      webglCompact.poseDigest,
    )
    expect(
      realtimeCompact.sourceMaterialDigest,
      `${item.id}: same original PBR values and texture dimensions`,
    ).toBe(webglCompact.sourceMaterialDigest)
    expect(realtime.renderSettings.stageInput).toEqual(webgl.renderSettings.stageInput)
    expect(realtime.renderSettings.exposure).toBe(webgl.renderSettings.exposure)
    expect(
      webgl.renderSettings.environmentIntensity,
      `${item.id}: preserved WebGL environment`,
    ).toBe(report.quality.environmentContract.webgl.intensity)
    expect(
      webgl.renderSettings.environment?.reference,
      `${item.id}: authored WebGL environment`,
    ).toBeNull()
    expect(
      realtime.renderSettings.environment,
      `${item.id}: frozen realtime reference HDR`,
    ).toMatchObject(report.quality.environmentContract.realtime)
    expect(
      realtime.renderSettings.environmentIntensity,
      `${item.id}: realtime reference intensity`,
    ).toBe(report.quality.environmentContract.realtime.reference.intensity)
    expect(realtime.renderSettings.exposure, `${item.id}: frozen realtime exposure`).toBe(1)
    const lights = (snapshot, type) =>
        snapshot.renderSettings.lights.filter((light) => light.type === type),
      sharedSoftboxes = lights(realtime, 'RectAreaLight'),
      directionalWithoutIntensity = (snapshot) =>
        lights(snapshot, 'DirectionalLight').map((light) => {
          const fields = { ...light }
          delete fields.intensity
          return fields
        })
    expect(sharedSoftboxes, `${item.id}: three actual softboxes`).toHaveLength(3)
    expect(sharedSoftboxes, `${item.id}: unchanged shared softboxes`).toEqual(
      lights(webgl, 'RectAreaLight'),
    )
    expect(
      lights(webgl, 'DirectionalLight').map((light) => light.intensity),
      `${item.id}: original WebGL directional fill`,
    ).toEqual(report.quality.supplementalLightingContract.webglDirectionalIntensities)
    expect(
      lights(realtime, 'DirectionalLight').map((light) => light.intensity),
      `${item.id}: disabled realtime delta-light fill`,
    ).toEqual(report.quality.supplementalLightingContract.realtimeDirectionalIntensities)
    expect(directionalWithoutIntensity(realtime)).toEqual(directionalWithoutIntensity(webgl))
    expect(
      realtime.renderSettings.lights.filter((light) => light.type !== 'DirectionalLight'),
      `${item.id}: other lights retain all fields`,
    ).toEqual(webgl.renderSettings.lights.filter((light) => light.type !== 'DirectionalLight'))
    expect(lights(realtime, 'AmbientLight').map((light) => light.intensity)).toEqual([
      report.quality.supplementalLightingContract.ambientIntensity,
    ])
    report.quality.pairs.push({
      case: item.id,
      title: item.title,
      webglImage: `quality-webgl-${item.id}.canvas.png`,
      realtimeImage: `quality-realtime-${item.id}.canvas.png`,
      cameraMaxError: assertNear(realtime.camera, webgl.camera, `${item.id} backend camera`),
      projectionComparison: physicalProjectionComparison(
        realtime,
        webgl,
        `${item.id} backend projection`,
      ),
      poseDigest: realtimeCompact.poseDigest,
      identityDigest: realtimeCompact.identityDigest,
      sourceMaterialDigest: realtimeCompact.sourceMaterialDigest,
      runtimeMaterialDigests: {
        webgl: webglCompact.materialDigest,
        realtime: realtimeCompact.materialDigest,
      },
      runtimeMaterialBranchesDiffer: realtimeCompact.materialDigest !== webglCompact.materialDigest,
      webglSettings: webgl.renderSettings,
      realtimeSettings: realtime.renderSettings,
      pixels: await compare(`quality-webgl-${item.id}`, `quality-realtime-${item.id}`),
      pixelInterpretation:
        'Different environment and directional-fill illumination: numerical differences are diagnostics only, not matched-lighting image error or evidence of algorithmic improvement.',
      matchedContract: {
        modelIdentity: true,
        semanticAndInstancePose: true,
        physicalCameraAndProjection: true,
        sourcePbrInputs: true,
        publishedStageConfiguration: true,
        localLights: false,
        sharedSoftboxes: true,
        exposure: true,
        environment: false,
      },
      matchedLighting: false,
    })
  }
  const uniqueInputs = (values) => [
    ...new Map(values.map((value) => [JSON.stringify(value), value])).values(),
  ]
  report.quality.materialFieldOrder = [
    'name',
    'color',
    'roughness',
    'metalness',
    'clearcoat',
    'clearcoatRoughness',
    'anisotropy',
    'anisotropyRotation',
    'transmission',
    'thickness',
    'ior',
    'opacity',
    'transparent',
    'envMapIntensity',
    'alphaTest',
    'textures',
  ]
  report.quality.sourceMaterialInputs = {
    webgl: uniqueInputs(snapshots.get('webgl:whole').sourceMaterials),
    realtime: uniqueInputs(snapshots.get('realtime:whole').sourceMaterials),
  }
  report.quality.runtimeMaterialInputs = {
    webgl: uniqueInputs(snapshots.get('webgl:whole').materials),
    realtime: uniqueInputs(snapshots.get('realtime:whole').materials),
    interpretation:
      'Source input equality does not claim runtime shader equivalence. Realtime opaque surface/complete transparent beauty routing and supported Physical-lighting branches remain explicitly visible here.',
  }
  const escape = (value) =>
    String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
  const rows = report.quality.pairs
    .map(
      (pair) =>
        `<section><h2>${escape(pair.title)}</h2><div class="pair"><figure><img src="${escape(pair.webglImage)}" alt="增强 WebGL：${escape(pair.title)}"><figcaption>增强 WebGL · 原摄影棚环境 0.9，方向补光 0.75／0.35</figcaption></figure><figure><img src="${escape(pair.realtimeImage)}" alt="实时组合：${escape(pair.title)}"><figcaption>WebGPU 实时组合 · Studio Small 05 HDR 0.35，方向补光关闭</figcaption></figure></div></section>`,
    )
    .join('\n')
  const diagnostics = report.quality.ssrDiagnostics
    .map(
      (item) =>
        `<section><h2>SSR 诊断：${escape(item.case)}</h2><div class="triple">${[
          [item.onImage, 'SSR 开启'],
          [item.offImage, 'SSR 关闭'],
          [item.repeatedOnImage, 'SSR 再开启'],
        ]
          .map(
            ([file, label]) =>
              `<figure><img src="${escape(file)}" alt="${escape(label)}"><figcaption>${escape(label)}</figcaption></figure>`,
          )
          .join('')}</div></section>`,
    )
    .join('\n')
  await writeFile(
    `${output}/quality-comparison.html`,
    `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Trees X 固定取景画质对照</title><style>body{margin:0;padding:32px;background:#ecefea;color:#202821;font:15px/1.65 system-ui,sans-serif}main{max-width:1800px;margin:auto}h1{font-size:28px}h2{font-size:20px;margin:28px 0 10px}.pair,.triple{display:grid;gap:12px;grid-template-columns:repeat(2,minmax(0,1fr))}.triple{grid-template-columns:repeat(3,minmax(0,1fr))}figure{margin:0}img{display:block;width:100%;height:auto;background:#dce1dc}figcaption{padding:8px 0}p{max-width:1000px}@media(max-width:800px){.pair,.triple{grid-template-columns:1fr}}</style><main><h1>Trees X · 同商品、同取景，环境与补光不同的画质方向对照</h1><p>增强 WebGL 保留原摄影棚环境（强度 0.9）及两盏方向补光（0.75／0.35）；WebGPU 实时入口采用 Studio Small 05 HDR（强度 0.35）并关闭方向补光。真实原始反射测试确认异常高亮反射峰值来自方向补光支路，修正未截断亮度或扩大模糊。共同模型、源 PBR 输入、结构姿态、实际镜头、公开舞台配置、曝光及三块软箱保持一致；环境和方向补光刻意不同，localLights=false、sharedSoftboxes=true、matchedLighting=false。因此这些图像不能作为同光照算法消融或误差分数。实际环境来源、摘要和后端支路记入 report.json；仍需检查文字、漆面、细边、反射与噪声。</p><p>旧路径追踪图虽同用 Studio Small 05，舞台、材质准备与灯光集合仍不同，只作视觉方向参考。候选运行材质／UV 副本完成后再生成同条件路径参考；本轮未新渲染路径追踪，也未以旧图计算误差。</p>${rows}<h1>近景 SSR 噪声与稳定性诊断</h1><p>近景保持同一实时 HDR、SSGI、模型和镜头不变。重复开启图用于观察时域波动，不能将差异直接当作噪声得分。</p>${diagnostics}</main></html>\n`,
  )
  report.checks.push(
    'Six fixed physical poses verify common model, source PBR, structure, camera projection, published stage configuration, three shared softboxes and exposure. Authored WebGL (0.9 environment, 0.75/0.35 directional fills) and corrected realtime (Studio Small 05 HDR 0.35, zero directional fills) intentionally differ; all other light fields remain equal. This is not a matched-lighting ablation. Three close-ups additionally record same-realtime-input SSR-off/on temporal diagnostics',
  )
}

try {
  const { products } = await readProducts(base)
  const metadata = products.find((item) => item.product.slug === 'typewriter-study')
  if (!metadata) throw new Error('Published real typewriter absent')
  report.product = productEvidence(metadata)
  const actionId = metadata.product.presentation.actions.find(
    (action) => action.motion?.program,
  )?.id
  if (!actionId) throw new Error('Real reversible typewriter layout action absent')
  browser = await chromium.launch({
    channel: 'msedge',
    headless: process.env.REALTIME_HEADED !== '1',
  })
  report.browserVersion = browser.version()
  const browserContext = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    reducedMotion: 'no-preference',
  })
  page = await browserContext.newPage()
  page.on('pageerror', (error) => report.errors.push(error.message))
  page.on('console', (entry) => {
    if (entry.type() !== 'error') return
    if (
      stage === 'Injected model download failure' &&
      /Failed to load resource.*503/.test(entry.text())
    )
      report.expectedErrors.push(entry.text())
    else if (
      stage === 'Controlled renderer error callback integration (not native GPU fault)' &&
      entry.text().includes(callbackFailureMessage)
    )
      report.expectedErrors.push(entry.text())
    else if (
      stage === 'Native WebGPU device loss and checkpoint recovery' &&
      /GPU.*device.*lost|device.*lost|WebGPU.*destroyed/i.test(entry.text())
    )
      report.expectedErrors.push(entry.text())
    else if (
      stage === 'Authenticated admin preview without persistent writes' &&
      /Failed to load resource.*401/.test(entry.text())
    )
      report.expectedErrors.push(entry.text())
    else report.errors.push(entry.text())
  })
  page.on('request', (request) => {
    requestStarts.set(request, {
      stage,
      elapsedMs: performance.now(),
      cancellationWindowId: cancellationWindow?.id ?? null,
    })
    if (/^https?:/.test(request.url())) report.requests.push(request.url())
  })
  page.on('requestfailed', (request) => {
    const requestStart = requestStarts.get(request),
      window = cancellationWindow,
      event = {
        url: request.url(),
        reason: request.failure()?.errorText,
        startedStage: requestStart?.stage ?? null,
        failedStage: stage,
        startedElapsedMs: requestStart?.elapsedMs ?? null,
        failedElapsedMs: performance.now(),
        cancellationWindowId: null,
      }
    // An aborted request remains a failure until the narrow injected-503 or
    // native-device window proves its matching genuine first-frame recovery.
    // No API, manifest, unrelated URL, other error or repeated URL is exempted.
    if (
      window &&
      ((window.reason === 'native-device-rebuild' &&
        stage === 'Native WebGPU device loss and checkpoint recovery') ||
        (window.reason === 'injected-model-503' && stage === 'Injected model download failure')) &&
      event.reason === 'net::ERR_ABORTED' &&
      request.method() === 'GET' &&
      window.allowedUrls.includes(event.url) &&
      requestStart?.cancellationWindowId === window.id &&
      requestStart?.stage === window.stage &&
      stage === window.stage &&
      event.failedElapsedMs - window.startedElapsedMs <= window.maxDurationMs &&
      !window.candidates.some((candidate) => candidate.url === event.url)
    ) {
      event.cancellationWindowId = window.id
      window.candidates.push(event)
    }
    report.requestFailureEvents.push(event)
    report.failedRequests.push(event)
  })
  progress('Native GPU typewriter loading')
  await page.goto(new URL('/?product=typewriter-study&renderPipeline=realtime', base).href, {
    waitUntil: 'domcontentloaded',
  })
  await ready(metadata, true)
  await waitFrames(4)
  const initial = await actual(),
    state = await lighting()
  expect(initial.webgpu, 'Genuine GPUDevice-backed WebGPU, not a WebGL fallback').toBe(true)
  const adapterIdentity = Object.values(initial.adapterInfo ?? {}).join(' ')
  expect(adapterIdentity.trim(), 'Actual GPU adapter identity must be available').not.toBe('')
  expect(adapterIdentity, 'Software WebGPU is not a hardware acceptance run').not.toMatch(
    /swiftshader|llvmpipe|lavapipe|software|cpu adapter/i,
  )
  expect(initial.roots).toEqual(['typewriter-study'])
  expect(initial.source).toBe('glb')
  expect(initial.adapter).toBe('typewriter-v1')
  expect(initial.bundle).toBe(`${metadata.manifest.id}@${metadata.manifest.version}`)
  expect(initial.semanticParts).toBe(572)
  expect(initial.instances).toBe(2257)
  expect(initial.triangles).toBe(initial.sourceTriangles)
  expect(initial.outputResolution).toEqual(viewport)
  expect(state.resolution).toEqual(viewport)
  expect(state.motion.instances).toBe(2257)
  expect(state.motion.historyBytes).toBe(2257 * 16 * 4)
  expect(state.motion.frameOpen).toBe(false)
  expect(initial.sameCanvas && initial.sameRenderer).toBe(true)
  report.device = initial.adapterInfo
  report.hardwareNativeVerified = true
  report.snapshots.initial = { ...compact(initial), lighting: state }
  report.checks.push(
    'Actual GLB, 572 semantic parts, 2257 native instances and frame-owned motion buffers use one GPU renderer at native 1440×1000',
  )

  if (includes('core')) {
    progress('SSR and SSGI signal ablation at identical actual pose and camera')
    const variants = [
      ['signals-none', false, false],
      ['signals-ssr', true, false],
      ['signals-ssgi', false, true],
      ['signals-combined', true, true],
    ]
    const captures = []
    for (const [name, ssr, ssgi] of variants) {
      await setSignals(ssr, ssgi)
      captures.push(await save(name))
    }
    for (const capture of captures.slice(1)) {
      expect(capture.camera).toEqual(captures[0].camera)
      expect(capture.projection).toEqual(captures[0].projection)
      expect(capture.poses).toEqual(captures[0].poses)
      expect(capture.materials).toEqual(captures[0].materials)
    }
    for (const name of ['signals-ssr', 'signals-ssgi', 'signals-combined']) {
      const result = await compare('signals-none', name)
      expect(result.rms, `${name} must change real rendered pixels`).toBeGreaterThan(0.05)
      expect(result.changedFraction).toBeGreaterThan(0.0001)
      report.pixels[name] = result
    }
    report.checks.push(
      'Independent SSR, SSGI and combined real pixels are captured with unchanged model pose, camera, projection and materials',
    )

    progress('Actual A-key movement and continuous completed frames')
    await openPanel(page, '结构与动作', '.wb-layout-motion')
    await page.waitForTimeout(400)
    const beforeStrike = await actual(),
      beforeFrames = (await lighting()).frames
    const strike = metadata.product.presentation.actions.find(
      (action) => action.behavior?.type === 'typewriter-strike',
    )
    if (!strike) throw new Error('Typewriter strike action absent')
    await page.getByRole('button', { name: strike.label, exact: true }).click()
    const samples = await page.evaluate(async (nodeName) => {
      const root = window.__demo.scene.scene.value.children.find(
        (node) => node.userData.workbenchProduct,
      )
      const node = root.getObjectByName(nodeName),
        values = []
      if (!node) throw new Error('Strike semantic node absent')
      for (let index = 0; index < 25; index++) {
        values.push({
          at: performance.now(),
          pose: [...node.position.toArray(), ...node.quaternion.toArray()],
          frames: window.__realtimeTest.snapshot().frames,
        })
        await new Promise((resolve) => setTimeout(resolve, 30))
      }
      return values
    }, strike.node)
    expect(new Set(samples.map((sample) => JSON.stringify(sample.pose))).size).toBeGreaterThan(1)
    expect(samples.at(-1).frames).toBeGreaterThan(beforeFrames)
    await waitFrames(3)
    expect((await actual()).poses).toEqual(beforeStrike.poses)
    report.snapshots.strike = { samples, motion: (await lighting()).motion }
    report.checks.push(
      'A-key changes actual semantic pose while complete real-time frames continue; strike returns without accumulated pose drift',
    )

    progress('Continuous reversible structure, input takeover and panel preservation')
    await page.getByRole('button', { name: '分层展开', exact: true }).click()
    await page.waitForTimeout(200)
    const moving = await actual(),
      movingState = await lighting()
    expect(moving.motion[actionId].progress).toBeGreaterThan(0)
    expect(moving.motion[actionId].progress).toBeLessThan(0.6)
    expect(moving.motion[actionId].playing).toBe(true)
    await observe()
    const paused = await stableMotion(actionId)
    expect(paused.motion[actionId].progress).toBeGreaterThan(0)
    expect(paused.motion[actionId].progress).toBeLessThan(0.6)
    expect((await lighting()).frames).toBeGreaterThan(movingState.frames)
    const pausedProgress = paused.motion[actionId].progress
    await page.waitForTimeout(300)
    expect((await actual()).motion[actionId].progress).toBe(pausedProgress)
    await page.getByRole('button', { name: '收起面板', exact: true }).click()
    await page.waitForTimeout(400)
    const closed = await actual()
    expect(closed.poses).toEqual(paused.poses)
    expect(closed.camera).toEqual(paused.camera)
    await openPanel(page, '结构与动作', '.wb-layout-motion')
    expect((await actual()).motion[actionId].progress).toBe(pausedProgress)
    await save('structure-paused-takeover')
    await page.getByRole('button', { name: '平铺部件', exact: true }).click()
    const movingFlatFrames = (await lighting()).frames
    const flat = await stableMotion(actionId)
    expect(flat.motion[actionId].progress).toBe(1)
    expect(flat.poses).not.toEqual(paused.poses)
    expect((await lighting()).frames).toBeGreaterThan(movingFlatFrames)
    await page.getByLabel('观察视角', { exact: true }).selectOption('knoll')
    await page.waitForTimeout(900)
    await save('flat-overview')
    await page.getByRole('button', { name: '复原动作', exact: true }).click()
    const restored = await stableMotion(actionId)
    expect(restored.poses).toEqual(initial.poses)
    expect(restored.sameCanvas && restored.sameRenderer).toBe(true)
    report.checks.push(
      'Structure and flat poses keep rendering; mouse takeover pauses at current progress; closing panels preserves pose and camera; reset is deterministic',
    )
    await realVisibility(actionId)
  }

  if (includes('performance')) await performanceRounds(metadata)
  if (scope === 'soak') await sustainedInteraction(metadata, actionId, initial)
  if (includes('visibility') && scope !== 'all') await realVisibility(actionId, true)

  if (includes('long')) {
    progress('Thirty actual resource reloads in one renderer')
    const identity = compact(initial).identityDigest
    let warmBaseline
    report.resourcePolicy = {
      warmupReloads: 3,
      tolerance: resourceTolerance,
      baseline:
        'Fixed resource counts at the third completed reload, after twelve successful complete frames',
      earlyFailure:
        'More than 64 MiB plus new render targets and textures after warmup, or three successive positive increments that exceed a fixed tolerance',
      finalCheck:
        'All seven native WebGPU counters stay within the fixed warm baseline tolerance; counters are not rebased upward to hide growth',
    }
    for (let index = 1; index <= 30; index++) {
      const before = await actual()
      await page.evaluate(() => window.__demo.store.retry())
      await ready(metadata)
      await waitFrames(12)
      const snapshot = compact(await actual())
      expect(snapshot.rootUuid).not.toBe(before.rootUuid)
      expect(snapshot.identityDigest).toBe(identity)
      expect(snapshot.semanticParts).toBe(572)
      expect(snapshot.instances).toBe(2257)
      expect(snapshot.sameCanvas && snapshot.sameRenderer).toBe(true)
      expect((await lighting()).motion.historyBytes).toBe(2257 * 16 * 4)
      report.reloads.push({ index, ...snapshot, lighting: await lighting() })
      if (index === 3) warmBaseline = { ...snapshot.memory }
      const assessment = index > 3 ? resourceAssessment(report.reloads, warmBaseline) : null
      if (assessment) report.resourceChecks.push(assessment)
      await writeFile(
        `${output}/reload-${String(index).padStart(2, '0')}.json`,
        `${JSON.stringify({ ...report.reloads.at(-1), resources: assessment }, null, 2)}\n`,
      )
      await writeFile(`${output}/partial-report.json`, `${JSON.stringify(report, null, 2)}\n`)
      progress(`Reload ${index}/30`, {
        renderTargets: snapshot.memory.renderTargets,
        geometries: snapshot.memory.geometries,
        attributes: snapshot.memory.attributes,
        programs: snapshot.memory.programs,
        uniformBuffers: snapshot.memory.uniformBuffers,
        textures: snapshot.memory.textures,
        totalBytes: snapshot.memory.total,
        warmDeltaBytes: assessment?.values.total.delta ?? null,
      })
      if (assessment?.earlyFailure)
        throw new Error(
          `Sustained native GPU resource growth detected at reload ${index}: ${assessment.largeTargetLeak ? 'large render-target/texture allocation leak' : assessment.sustained.join(', ')}. Stopping early to avoid retaining more leaked GPU memory.`,
        )
    }
    const final = resourceAssessment(report.reloads, warmBaseline)
    for (const [key, value] of Object.entries(final.values))
      expect(
        value.delta,
        `${key}: fixed warm-baseline resource count/bytes cannot grow after thirty reloads`,
      ).toBeLessThanOrEqual(value.tolerance)
    report.resourceSummary = final
    report.checks.push(
      'Thirty real resource reloads preserve native model identity, one host, fixed motion buffers and bounded render targets, geometries, attributes, programs, uniform buffers, textures and total bytes against a fixed warm baseline',
    )
  }

  if (includes('faults')) await faultRecovery(metadata, actionId)
  if (includes('quality')) await qualityComparison(metadata, actionId)
  if (includes('visual')) await visualBatch(metadata, actionId)

  if (includes('admin')) {
    progress('Authenticated admin preview without persistent writes')
    await page.setViewportSize(viewport)
    const env = await readFile('server/.env.local', 'utf8').catch((error) => {
      if (error.code === 'ENOENT') return ''
      throw error
    })
    const credentials = Object.fromEntries(
      env
        .split(/\r?\n/)
        .filter((line) => /^TREES_ADMIN_/.test(line))
        .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
    )
    await page.route('**/api/v1/admin/**', async (route) => {
      const request = route.request(),
        path = new URL(request.url()).pathname
      const allowed =
        request.method() === 'GET' ||
        (request.method() === 'POST' &&
          [
            '/api/v1/admin/session/login',
            '/api/v1/admin/session/logout',
            '/api/v1/admin/products/preview',
          ].includes(path))
      if (!allowed) {
        report.errors.push(`Blocked persistent write: ${request.method()} ${path}`)
        await route.abort('blockedbyclient')
      } else await route.continue()
    })
    await page.goto(new URL('/admin?renderPipeline=realtime', base).href)
    await expect
      .poll(
        async () =>
          (await page.getByLabel('管理员账号', { exact: true }).isVisible()) ||
          (await page.getByRole('button', { name: '退出登录', exact: true }).isVisible()),
        { timeout: 15000 },
      )
      .toBe(true)
    if (await page.getByLabel('管理员账号', { exact: true }).isVisible()) {
      await page
        .getByLabel('管理员账号', { exact: true })
        .fill(process.env.REALTIME_ADMIN_USERNAME || credentials.TREES_ADMIN_USERNAME || 'admin')
      await page
        .getByLabel('密码', { exact: true })
        .fill(process.env.REALTIME_ADMIN_PASSWORD || credentials.TREES_ADMIN_PASSWORD || '123456')
      await page.getByRole('button', { name: '登录管理端', exact: true }).click()
    }
    await expect(page.getByRole('button', { name: '退出登录', exact: true })).toBeVisible()
    const detail = new URL('/api/v1/admin/products/typewriter-study', base).href
    const originalResponse = await page.request.get(detail)
    expect(originalResponse.ok()).toBe(true)
    const original = await originalResponse.json()
    await page.getByRole('button', { name: `编辑${metadata.product.name}`, exact: true }).click()
    const tab = (name) =>
      page
        .getByRole('navigation', { name: '商品编辑分区' })
        .getByRole('button', { name, exact: true })
        .click()
    await tab('镜头')
    await page.getByRole('button', { name: '为默认取景采集镜头', exact: true }).click()
    await ready(metadata, true)
    await waitFrames(4)
    const before = await actual(),
      point = await inputPoint(page)
    await page.mouse.move(point.x, point.y)
    await page.mouse.down({ button: 'right' })
    await page.mouse.move(point.x + 45, point.y + 12, { steps: 8 })
    await page.mouse.up({ button: 'right' })
    const moved = await save('admin-preview-capture')
    expect(moved.camera).not.toEqual(before.camera)
    expect(moved.sameCanvas && moved.sameRenderer).toBe(true)
    await page.getByRole('button', { name: '使用此取景并返回', exact: true }).click()
    await expect(page.locator('canvas')).toHaveCount(0)
    await expect(
      page.getByText('取景已回填到表单，尚未保存到数据库。', { exact: true }),
    ).toBeVisible()
    await tab('高级配置')
    const captured = JSON.parse(
      await page.getByLabel('完整展示配置 JSON', { exact: true }).inputValue(),
    )
    captured.camera.position.forEach((value, index) =>
      expect(value).toBeCloseTo(moved.camera[index], 4),
    )
    expect(captured.views.find((view) => view.id === 'perspective').position).toEqual(
      captured.camera.position,
    )
    expect(captured.actions).toEqual(original.presentation.actions)
    const persisted = await page.request.get(detail)
    expect(persisted.ok()).toBe(true)
    expect(await persisted.json()).toEqual(original)
    report.snapshots.adminCapture = {
      actualCamera: moved.camera,
      capturedCamera: captured.camera,
      persistedUnchanged: true,
    }
    report.checks.push(
      'Authenticated native-GPU admin preview permits right-button pan and actual camera return, unmounts its unique host, and leaves persisted product unchanged',
    )
  }

  expect([...new Set(report.requests.map((url) => new URL(url).origin))]).toEqual([
    new URL(base).origin,
  ])
  expect(
    report.requests.some((url) => /rt_hdr_alb_nrm\.tza|oidn-web|three-gpu-pathtracer/.test(url)),
  ).toBe(false)
  expect(report.errors).toEqual([])
  expect(report.failedRequests).toEqual([])
  report.passed = true
  report.completedAt = new Date().toISOString()
  progress('Completed scoped checks', {
    scope,
    checks: report.checks.length,
    pending: report.pending.length,
    submissionIntervalGoalMet: report.submissionIntervalGoalMet,
    frameBudgetValidated: report.frameBudgetValidated,
  })
} catch (error) {
  report.failure = error.stack || String(error)
  progress('Failed', error.message)
  if (page) await page.screenshot({ path: `${output}/failure.png`, fullPage: true }).catch(() => {})
} finally {
  if (browser) await browser.close()
  await writeFile(`${output}/report.json`, `${JSON.stringify(report, null, 2)}\n`)
}
console.log(
  JSON.stringify(
    {
      passed: report.passed,
      scope,
      output,
      checks: report.checks.length,
      pending: report.pending,
      submissionIntervalGoalMet: report.submissionIntervalGoalMet,
      frameBudgetValidated: report.frameBudgetValidated,
      failure: report.failure,
    },
    null,
    2,
  ),
)
if (!report.passed) process.exitCode = 1

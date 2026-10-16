/* global fetch, URL, AbortSignal, requestAnimationFrame, performance */
import { chromium, expect } from '@playwright/test'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { bridge, trackLifecycle } from './demo/browser-check.mjs'

const base = process.env.CHECK_URL || 'http://127.0.0.1:5181'
const output = process.env.DDGI_CHECK_OUTPUT || 'artifacts/realtime-ddgi'
const origin = new URL(base).origin
const scope = process.env.DDGI_CHECK_SCOPE || 'full'
if (!['full', 'views'].includes(scope)) throw new Error('DDGI_CHECK_SCOPE must be full or views')
const modes = ['ssgi', 'ddgi']
const viewport = { width: 1440, height: 1000 }
const poses = [
  { id: 'whole', progress: 0, view: 'perspective' },
  { id: 'paint', progress: 0, part: 'part-095' },
  { id: 'metal', progress: 0, part: 'part-000' },
  { id: 'key', progress: 0, part: 'part-070' },
  { id: 'layers', progress: 0.6, view: 'structure' },
  { id: 'flat', progress: 1, view: 'knoll' },
]
const report = {
  passed: false,
  engineeringPassed: false,
  visualAccepted: false,
  frameBudgetValidated: false,
  fixture: false,
  viewport,
  scope,
  startedAt: new Date().toISOString(),
  cases: [],
  pairs: [],
  errors: [],
  pending: [
    'Human six-view image review',
    'GPU and actual presentation budget',
    '20-minute joint acceptance and actual hidden-page/device recovery',
  ],
  method:
    'Real API and Edge native WebGPU, same light studio without spatial/DOF parameters. Real Vue/Pinia/Three objects issue ordinary production intents. Fixed views compare complete camera, original product configuration, material inputs, lighting and semantic poses. Structure checks use the real program, not duplicated pose formulas. Complete-frame and DDGI counters count successful CPU submissions/solve calls; no GPU-duration or displayed-FPS claim. DDGI fallback is recorded and fails this comparison. Only verified same-product rapid-selection request cancellations can be expected; GPU/console failures are never ignored.',
}
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const difference = (a, b) =>
  a.length === b.length
    ? Math.max(0, ...a.map((value, index) => Math.abs(value - b[index])))
    : Infinity
const baseline = new Map()
let browser, product, action, pulse, bundle
await mkdir(output, { recursive: true })

async function attach(page, remember) {
  await bridge(page, remember)
  await page.evaluate(() => {
    const seen = new Set()
    const visit = (vnode) => {
      if (!vnode || typeof vnode !== 'object' || seen.has(vnode)) return
      seen.add(vnode)
      const exposed = vnode.component?.exposed?.realLighting,
        value = exposed?.value ?? exposed
      if (value?.snapshot && value?.setSignals) return value
      const nested = visit(vnode.component?.subTree)
      if (nested) return nested
      for (const child of Array.isArray(vnode.children) ? vnode.children : []) {
        const found = visit(child)
        if (found) return found
      }
      return visit(vnode.suspense?.activeBranch)
    }
    window.__ddgiCheck = {
      lighting: visit(document.querySelector('#app')?._vnode),
      root: window.__demo.scene.scene.value.children.find((node) => node.userData.workbenchProduct),
    }
    if (!window.__ddgiCheck.lighting || !window.__ddgiCheck.root)
      throw new Error('Actual production coordinator/root unavailable')
  })
}

const lighting = (page) => page.evaluate(() => window.__ddgiCheck.lighting.snapshot())

async function ready(page, result, remember = false) {
  await page.waitForFunction(
    () =>
      ['ready', 'error', 'content'].includes(document.querySelector('.workbench')?.dataset.status),
    null,
    { timeout: 240000 },
  )
  await expect(page.locator('.workbench')).toHaveAttribute('data-status', 'ready')
  await expect(page.locator('.workbench')).toHaveAttribute('data-slug', 'typewriter-study')
  await expect(page.locator('canvas')).toHaveCount(1)
  await expect(page.locator('.wb-stage')).toHaveAttribute('data-render-backend', 'webgpu')
  await expect(page.locator('.wb-stage')).toHaveAttribute('data-studio-mood', 'light')
  await attach(page, remember)
  const initial = await lighting(page)
  result.startups.push(initial)
  await expect
    .poll(
      async () => {
        const current = await lighting(page)
        if (current.error) throw new Error('Realtime failed: ' + current.error)
        const indirect = current.indirectLighting
        if (indirect?.error || indirect?.details?.error) {
          result.fallbacks.push({ stage: 'ready', ...indirect })
          throw new Error(
            'DDGI fallback is not acceptance: ' + (indirect.error || indirect.details.error),
          )
        }
        return current.phase === 'ready' && indirect?.actual === result.mode
      },
      { timeout: 240000 },
    )
    .toBe(true)
  await settle(page, result)
}

async function settle(page, result, frames = 8) {
  const initial = await lighting(page)
  await expect
    .poll(
      async () => {
        const state = await lighting(page)
        if (
          state.error ||
          state.indirectLighting?.error ||
          state.indirectLighting?.details?.error
        ) {
          result.fallbacks.push({ stage: 'settle', ...state.indirectLighting })
          throw new Error(
            state.error || state.indirectLighting.error || state.indirectLighting.details.error,
          )
        }
        if (state.indirectLighting?.actual !== result.mode) return -1
        return state.frames
      },
      { timeout: 120000 },
    )
    .toBeGreaterThan(initial.frames + frames)
}

const snapshot = (page) =>
  page.evaluate(() => {
    const test = window.__demo,
      scene = test.scene.scene.value,
      renderer = test.scene.renderer.instance,
      roots = scene.children.filter((node) => node.userData.workbenchProduct),
      root = roots[0],
      camera = test.scene.camera.activeCamera.value,
      poses = [],
      instances = [],
      geometries = new Map(),
      materials = new Map(),
      lights = []
    root.updateMatrixWorld(true)
    camera.updateMatrixWorld(true)
    root.traverse((node) => {
      if (Number.isInteger(node.userData.partId))
        poses.push([
          node.name,
          ...node.position.toArray(),
          ...node.quaternion.toArray(),
          ...node.scale.toArray(),
          ...node.matrixWorld.toArray(),
        ])
      if (node.isInstancedMesh)
        instances.push({
          name: node.name,
          count: node.count,
          capacity: node.instanceMatrix.count,
          version: node.instanceMatrix.version,
          matrices: [...node.instanceMatrix.array],
        })
      if (node.geometry)
        geometries.set(node.geometry.uuid, {
          uuid: node.geometry.uuid,
          vertices: node.geometry.getAttribute('position')?.count,
          indices: node.geometry.index?.count ?? 0,
        })
      for (const material of node.material
        ? Array.isArray(node.material)
          ? node.material
          : [node.material]
        : []) {
        const original = material.source ?? material
        materials.set(material.uuid, {
          name: original.name,
          color: original.color?.getHexString(),
          roughness: original.roughness,
          metalness: original.metalness,
          clearcoat: original.clearcoat,
          clearcoatRoughness: original.clearcoatRoughness,
          anisotropy: original.anisotropy,
          anisotropyRotation: original.anisotropyRotation,
          opacity: original.opacity,
          transparent: original.transparent,
          envMapIntensity: original.envMapIntensity,
          textures: ['map', 'normalMap', 'roughnessMap', 'anisotropyMap'].map((slot) => {
            const t = original[slot]
            return t
              ? [slot, t.name, t.channel, t.image?.width, t.image?.height, t.colorSpace]
              : [slot]
          }),
        })
      }
    })
    scene.traverse((node) => {
      if (node.isLight)
        lights.push([
          node.type,
          node.name,
          node.color.getHexString(),
          node.intensity,
          ...node.position.toArray(),
          ...node.quaternion.toArray(),
          node.width,
          node.height,
        ])
    })
    return {
      root: root.uuid,
      roots: roots.length,
      slug: root.userData.workbenchProduct,
      version: root.userData.bundleVersion,
      bundleSha256: root.userData.bundleSha256,
      parts: poses.length,
      sameRoot: root === window.__ddgiCheck.root,
      sameCanvas: document.querySelector('canvas') === test.canvas,
      sameRenderer: renderer === test.renderer,
      canvases: document.querySelectorAll('canvas').length,
      nativeWebgpu: renderer.backend?.isWebGPUBackend === true,
      camera: [
        ...camera.position.toArray(),
        ...camera.quaternion.toArray(),
        ...camera.matrixWorld.toArray(),
        ...camera.projectionMatrix.toArray(),
        ...camera.projectionMatrixInverse.toArray(),
      ],
      poses: poses.sort((a, b) => a[0].localeCompare(b[0])),
      instances: instances.sort((a, b) => a.name.localeCompare(b.name)),
      geometries: [...geometries.values()].sort((a, b) => a.uuid.localeCompare(b.uuid)),
      materials: [...materials.values()].sort((a, b) =>
        JSON.stringify(a).localeCompare(JSON.stringify(b)),
      ),
      lights,
      finish: test.store.finishId,
      selectedPart: test.store.selectedPart,
      presentation: JSON.parse(JSON.stringify(test.store.presentation)),
      motion: Object.fromEntries(
        Object.entries(test.motion.snapshot()).map(([id, status]) => [
          id,
          { progress: status.progress, target: status.target, playing: status.playing },
        ]),
      ),
      exposure: renderer.toneMappingExposure,
      environment: {
        name: scene.environment?.name,
        intensity: scene.environmentIntensity,
        rotation: scene.environmentRotation.toArray(),
        reference: scene.environment?.userData.reference,
      },
      memory: { ...renderer.info.memory },
      lighting: window.__ddgiCheck.lighting.snapshot(),
    }
  })

function identity(state, mode) {
  expect(state).toMatchObject({
    roots: 1,
    slug: 'typewriter-study',
    version: 2,
    bundleSha256: bundle.sha256,
    parts: 572,
    sameRoot: true,
    sameCanvas: true,
    sameRenderer: true,
    canvases: 1,
    nativeWebgpu: true,
  })
  expect(state.lighting.error).toBeNull()
  expect(state.lighting.indirectLighting).toMatchObject({
    requested: mode,
    actual: mode,
    error: null,
    preparing: false,
  })
  if (mode === 'ddgi') {
    const field = state.lighting.indirectLighting.details
    expect(field).toMatchObject({
      ready: true,
      error: null,
      disposed: false,
      resolution: [16, 9, 10],
      probes: 1440,
      actualRays: 64,
      actualBudgetRays: 98304,
      reflectionQuality: 'off',
      source: { version: '0.8.0', commit: 'a997aee5b0791be61b49719377e811c41720df59' },
      budget: {
        longestAxis: 16,
        raysPerProbe: 64,
        cascades: 1,
        reflectionQuality: 'off',
        maxRaysPerTick: 98304,
        automaticReduction: false,
      },
    })
    expect(field.state.tickBudgetRays).toBe(98304)
    expect(field.proxy.instances).toBeGreaterThan(0)
    expect(field.environment.linearHDR).toBe(true)
    expect(field.acceptedTicks).toBeGreaterThan(1)
  } else expect(state.lighting.indirectLighting.details).toBeNull()
}

async function pose(page, result, item) {
  await page.evaluate(() => {
    window.__demo.store.panel = null
    window.__demo.store.restore()
  })
  await page.waitForTimeout(1200)
  await page.evaluate(({ id, progress }) => window.__demo.store.motion('seek', id, progress), {
    id: action.id,
    progress: item.progress,
  })
  await expect
    .poll(() => page.evaluate((id) => window.__demo.motion.snapshot()[id]?.progress, action.id))
    .toBe(item.progress)
  if (item.part) {
    const hotspot = product.presentation.hotspots.find(
      (entry) => entry.id === item.part || entry.node === item.part,
    )
    if (!hotspot) throw new Error('Missing actual hotspot: ' + item.part)
    await page.evaluate((id) => window.__demo.store.focus(id), hotspot.id)
  } else await page.evaluate((id) => window.__demo.store.view(id), item.view)
  await page.waitForTimeout(1200)
  await settle(page, result, 24)
}

async function save(page, result, id, state) {
  await page.mouse.move(1, 1)
  await page.screenshot({ path: `${output}/${result.mode}/${id}.png` })
  const current = state ?? (await snapshot(page))
  await writeFile(`${output}/${result.mode}/${id}.json`, JSON.stringify(current, null, 2) + '\n')
  result.captures.push(id)
  console.log('[realtime ' + result.mode + '] ' + id)
}

async function structureChecks(page, result) {
  await pose(page, result, poses[0])
  result.structure = await page.evaluate(async (id) => {
    const test = window.__demo,
      lighting = window.__ddgiCheck.lighting,
      root = window.__ddgiCheck.root,
      all = [],
      instances = []
    root.traverse((node) => {
      if (Number.isInteger(node.userData.partId)) all.push(node)
      if (node.isInstancedMesh) instances.push(node)
    })
    const values = () =>
      all.flatMap((node) => [
        ...node.position.toArray(),
        ...node.quaternion.toArray(),
        ...node.scale.toArray(),
      ])
    const diff = (a, b) => Math.max(0, ...a.map((value, index) => Math.abs(value - b[index])))
    let maxTransformInstances = 0,
      maxTlasRefits = 0,
      observedFrames = 0
    const field = () => {
      const state = lighting.snapshot()
      if (state.error || state.indirectLighting?.error)
        throw new Error(state.error || state.indirectLighting.error)
      const detail = state.indirectLighting?.details
      if (detail) {
        if (detail.error || detail.actualRays !== 64 || detail.actualBudgetRays !== 98304)
          throw new Error(detail.error || 'Actual DDGI budget changed during structure motion')
        maxTransformInstances = Math.max(
          maxTransformInstances,
          detail.state.lastTransformInstanceCount,
        )
        maxTlasRefits = Math.max(maxTlasRefits, detail.state.lastTlasRefitCount)
      }
      return state
    }
    const seek = async (progress) => {
      const before = field().frames,
        started = performance.now()
      test.store.motion('seek', id, progress)
      while (test.motion.snapshot()[id]?.progress !== progress || field().frames <= before) {
        await new Promise((resolve) => requestAnimationFrame(resolve))
        observedFrames++
        field()
        if (performance.now() - started > 60000)
          throw new Error('Real structure seek failed to submit a complete frame')
      }
      return values()
    }
    const initial = await seek(0),
      samples = [],
      initialVersions = instances.map((node) => node.instanceMatrix.version)
    for (let index = 0; index <= 100; index++) samples.push(await seek(index / 100))
    let reverseError = 0,
      resetError = 0
    for (let index = 100; index >= 0; index--)
      reverseError = Math.max(reverseError, diff(samples[index], await seek(index / 100)))
    for (let index = 0; index < 50; index++) {
      await seek(1)
      resetError = Math.max(resetError, diff(initial, await seek(0)))
    }
    return {
      points: 101,
      reversePoints: 101,
      resetCycles: 50,
      reverseError,
      resetError,
      maxTransformInstances,
      maxTlasRefits,
      observedFrames,
      actualInstancedMeshes: instances.length,
      instanceVersionIncreases: instances.map(
        (node, index) => node.instanceMatrix.version - initialVersions[index],
      ),
    }
  }, action.id)
  expect(result.structure.reverseError).toBeLessThanOrEqual(1e-6)
  expect(result.structure.resetError).toBeLessThanOrEqual(1e-6)
  expect(result.structure.instanceVersionIncreases.some((value) => value > 0)).toBe(true)
  if (result.mode === 'ddgi') {
    expect(result.structure.maxTransformInstances).toBeGreaterThan(0)
    expect(result.structure.maxTlasRefits).toBeGreaterThan(0)
  }
  await settle(page, result)
  identity(await snapshot(page), result.mode)
  console.log('[realtime ' + result.mode + '] 101 forward/reverse + 50 reset cycles')
}

async function strikeAndPause(page, result) {
  await pose(page, result, poses[0])
  const initial = await snapshot(page)
  result.strike = await page.evaluate(
    async ({ id, node }) => {
      const key = window.__ddgiCheck.root.getObjectByName(node)
      if (!key) throw new Error('Actual A key missing')
      const initial = [...key.position.toArray(), ...key.quaternion.toArray()]
      window.__demo.store.action(id)
      for (let frame = 0; frame < 120; frame++) {
        await new Promise((resolve) => requestAnimationFrame(resolve))
        const current = [...key.position.toArray(), ...key.quaternion.toArray()]
        const delta = Math.max(...current.map((value, index) => Math.abs(value - initial[index])))
        if (delta > 1e-6) return { node, observedFrame: frame, delta }
      }
      throw new Error('Actual A key did not move')
    },
    { id: pulse.id, node: pulse.node },
  )
  await page.waitForTimeout(1500)
  await settle(page, result)
  const restored = await snapshot(page)
  identity(restored, result.mode)
  expect(
    difference(
      initial.poses.flatMap((entry) => entry.slice(1)),
      restored.poses.flatMap((entry) => entry.slice(1)),
    ),
  ).toBeLessThanOrEqual(1e-6)
  await page.evaluate((id) => window.__demo.store.motion('play', id, 0.6), action.id)
  await expect
    .poll(() => page.evaluate((id) => window.__demo.motion.snapshot()[id]?.progress, action.id))
    .toBeGreaterThan(0.05)
  await page.evaluate((id) => window.__demo.store.motion('pause', id), action.id)
  const paused = await snapshot(page)
  expect(paused.motion[action.id].playing).toBe(false)
  expect(paused.motion[action.id].progress).toBeGreaterThan(0)
  expect(paused.motion[action.id].progress).toBeLessThan(0.6)
  await settle(page, result, 8)
  const held = await snapshot(page)
  expect(held.poses).toEqual(paused.poses)
  expect(held.motion[action.id]).toEqual(paused.motion[action.id])
  result.pause = {
    progress: held.motion[action.id].progress,
    completeFrameDelta: held.lighting.frames - paused.lighting.frames,
    poseHash: hash(held.poses),
  }
  identity(held, result.mode)
  await save(page, result, 'structure-paused', held)
}

async function reloads(page, result, cancellation) {
  await trackLifecycle(page)
  const roots = []
  for (let index = 0; index < 3; index++) {
    const previous = await snapshot(page)
    roots.push(previous.root)
    await page.evaluate(() => {
      void window.__demo.store.select('typewriter-study')
    })
    await ready(page, result)
    const current = await snapshot(page)
    identity(current, result.mode)
    expect(current.root).not.toBe(previous.root)
    const old = await trackLifecycle(page)
    for (const entry of old) {
      expect(entry.detached).toBe(true)
      expect(entry.disposed).toEqual(entry.resources)
    }
    result.reloads.push({
      iteration: index + 1,
      previousRoot: previous.root,
      currentRoot: current.root,
      lighting: current.lighting,
      memory: current.memory,
      old,
    })
    console.log('[realtime ' + result.mode + '] actual reload ' + (index + 1))
  }
  expect(new Set(roots).size).toBe(3)
  cancellation.active = true
  cancellation.started = Date.now()
  await page.evaluate(async () => {
    for (let index = 0; index < 3; index++) {
      void window.__demo.store.select('typewriter-study')
      await new Promise((resolve) => requestAnimationFrame(resolve))
    }
  })
  await ready(page, result)
  const recovered = await snapshot(page)
  identity(recovered, result.mode)
  cancellation.active = false
  cancellation.verified = true
  const old = await trackLifecycle(page)
  for (const entry of old) {
    expect(entry.detached).toBe(true)
    expect(entry.disposed).toEqual(entry.resources)
  }
  result.rapidReload = {
    intents: 3,
    recovery: recovered.lighting,
    root: recovered.root,
    sameCanvas: recovered.sameCanvas,
    sameRenderer: recovered.sameRenderer,
    old,
  }
  await save(page, result, 'reload-recovered', recovered)
}

try {
  const response = await fetch(new URL('/api/v1/products/typewriter-study', base), {
    signal: AbortSignal.timeout(60000),
  })
  if (!response.ok) throw new Error('Real product API unavailable: ' + response.status)
  product = await response.json()
  if (product.slug !== 'typewriter-study' || product.presentation.source?.kind !== 'glb')
    throw new Error('Actual typewriter GLB configuration unavailable')
  action = product.presentation.actions.find((entry) => entry.motion?.program)
  pulse = product.presentation.actions.find((entry) => entry.kind === 'pulse')
  if (!action || !pulse) throw new Error('Actual structure and strike definitions unavailable')
  bundle = JSON.parse(await readFile('src/lib/workbench/typewriterV2Bundle.json', 'utf8'))
  report.apiProductSha256 = hash(product)
  await writeFile(output + '/api-product.json', JSON.stringify(product, null, 2) + '\n')
  browser = await chromium.launch({ channel: 'msedge', headless: true })
  for (const mode of modes) {
    const result = {
      mode,
      passed: false,
      captures: [],
      startups: [],
      fallbacks: [],
      reloads: [],
      errors: [],
      warnings: [],
      failedRequests: [],
      expectedCancellations: [],
      requests: [],
    }
    const cancellation = { active: false, verified: false, started: 0 }
    report.cases.push(result)
    await mkdir(`${output}/${mode}`, { recursive: true })
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1 }),
      page = await context.newPage()
    page.setDefaultTimeout(30000)
    page.on('pageerror', (error) =>
      result.errors.push({ kind: 'pageerror', message: error.message }),
    )
    page.on('console', (message) => {
      if (message.type() === 'warning') {
        result.warnings.push({ message: message.text(), url: message.location().url })
        if (
          /SPEEDBALL.*failed|GPUValidationError|validation.*(?:error|failed)|error.*(?:WGSL|shader|pipeline)|(?:WGSL|shader|pipeline|binding).*(?:error|invalid|failed)/i.test(
            message.text(),
          )
        )
          result.errors.push({ kind: 'gpu-warning', message: message.text() })
      }
      if (message.type() === 'error')
        result.errors.push({
          kind: 'console',
          message: message.text(),
          url: message.location().url,
        })
    })
    page.on('request', (request) => {
      if (/^https?:/.test(request.url())) result.requests.push(request.url())
    })
    page.on('requestfailed', (request) => {
      const failure = { url: request.url(), reason: request.failure()?.errorText },
        url = new URL(request.url())
      if (
        cancellation.active &&
        Date.now() - cancellation.started < 60000 &&
        failure.reason === 'net::ERR_ABORTED' &&
        url.origin === origin &&
        (url.pathname === '/api/v1/products/typewriter-study' ||
          url.pathname.startsWith('/models/bundles/kimi-typewriter/'))
      )
        result.expectedCancellations.push(failure)
      else result.failedRequests.push(failure)
    })
    page.on('response', (response) => {
      if (response.status() >= 400)
        result.errors.push({ kind: 'http', url: response.url(), status: response.status() })
    })
    try {
      const url = new URL(
        '/?product=typewriter-study&renderPipeline=realtime&studioMood=light',
        base,
      )
      url.searchParams.set('indirectLighting', mode)
      result.url = url.href
      await page.goto(url.href, { waitUntil: 'domcontentloaded' })
      await ready(page, result, true)
      result.initial = await snapshot(page)
      identity(result.initial, mode)
      for (const item of poses) {
        await pose(page, result, item)
        const state = await snapshot(page)
        identity(state, mode)
        const immutable = {
          presentation: state.presentation,
          bundle: state.bundleSha256,
          finish: state.finish,
          selectedPart: state.selectedPart,
          poses: state.poses,
          instances: state.instances.map(({ version, ...values }) => {
            void version
            return values
          }),
          materials: state.materials,
          lights: state.lights,
          exposure: state.exposure,
          environment: state.environment,
          motion: state.motion,
        }
        const inputHash = hash(immutable)
        if (baseline.has(item.id)) {
          const original = baseline.get(item.id),
            cameraError = difference(original.camera, state.camera)
          expect(inputHash, item.id + ' identical real input').toBe(original.inputHash)
          expect(cameraError, item.id + ' identical complete camera').toBeLessThanOrEqual(1e-6)
          report.pairs.push({ id: item.id, inputHash, cameraError })
        } else baseline.set(item.id, { inputHash, camera: state.camera })
        await save(page, result, item.id, state)
      }
      if (scope === 'full') {
        await strikeAndPause(page, result)
        await structureChecks(page, result)
        await reloads(page, result, cancellation)
      } else
        result.deferred = [
          'Strike/pause, 101-point reverse/50-reset and reload checks are not rerun in this six-view smoke batch. Refer to the separately dated full-run report.',
        ]
      result.final = await snapshot(page)
      identity(result.final, mode)
      expect(result.fallbacks).toEqual([])
      expect(result.errors).toEqual([])
      expect(result.failedRequests).toEqual([])
      expect(result.expectedCancellations.length === 0 || cancellation.verified).toBe(true)
      expect(result.requests.every((url) => new URL(url).origin === origin)).toBe(true)
      result.passed = true
    } catch (error) {
      result.errors.push({ kind: 'test', message: error.stack || String(error) })
      process.exitCode = 1
      try {
        result.failureLighting = await lighting(page)
        await page.screenshot({ path: `${output}/${mode}/failure.png` })
      } catch {
        /* Actual host may have failed. */
      }
    } finally {
      if (result.expectedCancellations.length && !cancellation.verified)
        result.errors.push({
          kind: 'unverified-cancellation',
          message: 'Rapid reload did not recover; cancellation candidates are failures',
        })
      await context.close()
      if (result.errors.length || result.failedRequests.length) result.passed = false
      await writeFile(`${output}/${mode}/report.json`, JSON.stringify(result, null, 2) + '\n')
    }
  }
  report.engineeringPassed =
    report.cases.every((entry) => entry.passed) && report.pairs.length === 6
  report.passed = report.engineeringPassed
  if (!report.passed) process.exitCode = 1
} catch (error) {
  report.errors.push({ kind: 'test', message: error.stack || String(error) })
  process.exitCode = 1
} finally {
  await browser?.close()
  await writeFile(output + '/report.json', JSON.stringify(report, null, 2) + '\n')
  console.log(
    JSON.stringify({
      engineeringPassed: report.engineeringPassed,
      scope,
      visualAccepted: false,
      frameBudgetValidated: false,
      cases: report.cases.map((entry) => ({
        mode: entry.mode,
        passed: entry.passed,
        captures: entry.captures.length,
        reloads: entry.reloads.length,
        errors: entry.errors.length,
      })),
      output,
    }),
  )
}

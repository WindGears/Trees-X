/* global fetch, URL, AbortSignal, requestAnimationFrame, performance, createImageBitmap, Blob, crypto */
import { chromium, expect } from '@playwright/test'
import { createHash } from 'node:crypto'
import { access, cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { bridge, trackLifecycle } from './demo/browser-check.mjs'
import { openGlb } from './typewriter-v2/glb.mjs'

const base = process.env.CHECK_URL || 'http://127.0.0.1:5181'
const origin = new URL(base).origin
const output = process.env.PAINT_CHECK_OUTPUT || 'artifacts/typewriter-paint/browser'
const scope = process.env.PAINT_CHECK_SCOPE || 'full'
if (!['full', 'views'].includes(scope)) throw new Error('PAINT_CHECK_SCOPE must be full or views')
const viewport = { width: 1440, height: 1000 }
const modes = ['v2', 'roughness-only', 'paint-study']
const paintNames = ['enamel', 'shellGloss', 'shellRim']
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
  scope,
  viewport,
  startedAt: new Date().toISOString(),
  cases: [],
  pairs: [],
  errors: [],
  pending: [
    'Owner review of material scale, point noise, legibility and nameplate style',
    'Actual GPU and presented-frame budget; RAF is scheduling evidence only',
    '30 reload and 20-minute joint acceptance are not part of this batch',
  ],
  method:
    'Serial native Edge WebGPU at 1440×1000, real API and immutable verified packages, same SSGI/light studio, six identical actual camera/semantic poses. Roughness-only is a disposable browser-local hybrid: new paint-study roughness/clearcoat/nameplate plus the verified v2 normal pixels with unchanged sampler/UV/scalars. Existing exposed setSignals(true,true,true) controls reset history and request the normal material-sync frame after each test substitution/restoration. It is not a published package, and its full-image comparison to v2 also changes the nameplate. No production debug collector, alternate renderer, pixel readback or second clock. No earlier pass is inherited.',
}
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
const hash = (value) => digest(JSON.stringify(value))
const difference = (a, b) =>
  a.length === b.length
    ? Math.max(0, ...a.map((value, index) => Math.abs(value - b[index])))
    : Infinity
const baselines = new Map()
let browser, product, action, pulse, v2, study, record, metadata
await mkdir(output, { recursive: true })

async function verifiedResponse(url, file) {
  const response = await fetch(url, { signal: AbortSignal.timeout(120000) })
  if (!response.ok) throw new Error(`Actual resource unavailable: ${response.status} ${url}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (file) {
    expect(bytes.length).toBe(file.bytes)
    expect(digest(bytes)).toBe(file.sha256)
  }
  return bytes
}

async function resourceMetadata(reference) {
  const manifestUrl = new URL(reference.manifest, base)
  expect(manifestUrl.origin).toBe(origin)
  const manifestBytes = await verifiedResponse(manifestUrl)
  expect(digest(manifestBytes)).toBe(reference.sha256)
  const manifest = JSON.parse(manifestBytes)
  expect([manifest.id, manifest.version]).toEqual([reference.id, reference.version])
  const files = []
  let brand
  for (const file of manifest.files) {
    const bytes = await verifiedResponse(new URL(file.path, manifestUrl), file)
    files.push({ path: file.path, bytes: bytes.length, sha256: digest(bytes) })
    if (file.path === manifest.entry) {
      const glb = openGlb(bytes),
        image = glb.json.images[50],
        view = glb.json.bufferViews[image.bufferView],
        encoded = glb.binary.subarray(
          view.byteOffset ?? 0,
          (view.byteOffset ?? 0) + view.byteLength,
        )
      brand = { index: 50, material: 'decal-62', bytes: encoded.length, sha256: digest(encoded) }
    }
  }
  return { reference, manifest, files, brand }
}

async function attach(page, remember = false) {
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
    window.__paintCheck = {
      lighting: visit(document.querySelector('#app')?._vnode),
      root: window.__demo.scene.scene.value.children.find((node) => node.userData.workbenchProduct),
      override: null,
    }
    if (!window.__paintCheck.lighting || !window.__paintCheck.root)
      throw new Error('Actual coordinator and product root unavailable')
  })
}

const lighting = (page) => page.evaluate(() => window.__paintCheck.lighting.snapshot())

async function settle(page, frames = 36) {
  const before = await lighting(page)
  await expect
    .poll(
      async () => {
        const current = await lighting(page)
        if (current.error || current.indirectLighting?.error)
          throw new Error(current.error || current.indirectLighting.error)
        expect(current.indirectLighting?.actual).toBe('ssgi')
        return current.frames
      },
      { timeout: 120000 },
    )
    .toBeGreaterThan(before.frames + frames)
}

async function ready(page, remember = false) {
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
  await attach(page, remember)
  await settle(page)
}

async function overrideNormal(page) {
  const normal = metadata.v2.manifest.files.find(
    (file) => file.path === 'textures/paint-normal.png',
  )
  return page.evaluate(
    async ({ names, url, sha256 }) => {
      const check = window.__paintCheck
      if (check.override) throw new Error('Only one disposable normal override may exist')
      const materials = new Map()
      check.root.traverse((node) => {
        for (const runtime of node.material
          ? Array.isArray(node.material)
            ? node.material
            : [node.material]
          : []) {
          const source = runtime.source ?? runtime
          if (names.includes(source.name)) materials.set(source.uuid, source)
        }
      })
      if (materials.size !== 3) throw new Error('Audited paint materials missing')
      const response = await fetch(url)
      if (!response.ok) throw new Error('Original v2 normal unavailable')
      const bytes = await response.arrayBuffer(),
        actual = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
          .map((value) => value.toString(16).padStart(2, '0'))
          .join('')
      if (actual !== sha256) throw new Error('Original v2 normal hash mismatch')
      const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }), {
        imageOrientation: 'none',
        premultiplyAlpha: 'none',
        colorSpaceConversion: 'none',
      })
      const original = [...materials.values()][0].normalMap,
        replacement = original.clone()
      // Texture.clone() shares Source. Give this test-owned texture its own
      // Source before assigning pixels, so loader-owned images stay untouched.
      replacement.source = new original.source.constructor(image)
      replacement.name = 'test-only verified v2 paint normal'
      replacement.userData = { ...replacement.userData, paintStudyTestSha256: actual }
      replacement.needsUpdate = true
      const entries = [...materials.values()].map((material) => ({
        material,
        normal: material.normalMap,
      }))
      for (const entry of entries) {
        entry.material.normalMap = replacement
        entry.material.needsUpdate = true
      }
      check.override = { entries, replacement, image }
      // Use the existing exposed signal controls to reset history and request
      // a real frame. Its normal material-sync stage observes the source map.
      check.lighting.setSignals(true, true, true)
      return {
        scope: 'test page only; not a published asset',
        originalNormalSha256: actual,
        materials: entries.map(({ material }) => material.name).sort(),
        replacementTexture: replacement.uuid,
        independentSource: replacement.source !== original.source,
        normalDimensions: [image.width, image.height],
        channel: replacement.channel,
        colorSpace: replacement.colorSpace,
        flipY: replacement.flipY,
      }
    },
    {
      names: paintNames,
      url: new URL(normal.path, new URL(v2.manifest, base)).href,
      sha256: normal.sha256,
    },
  )
}

async function restoreNormal(page) {
  const restored = await page.evaluate(() => {
    const check = window.__paintCheck,
      override = check?.override
    if (!override) return false
    for (const entry of override.entries) {
      entry.material.normalMap = entry.normal
      entry.material.needsUpdate = true
    }
    check.lighting.setSignals(true, true, true)
    override.replacement.dispose()
    override.image.close()
    check.override = null
    return true
  })
  if (restored) await settle(page, 8)
}

const snapshot = (page) =>
  page.evaluate(() => {
    const test = window.__demo,
      scene = test.scene.scene.value,
      root = scene.children.find((node) => node.userData.workbenchProduct),
      camera = test.scene.camera.activeCamera.value,
      materials = new Map(),
      geometry = new Set(),
      textures = new Set(),
      poses = [],
      instances = [],
      lights = []
    root.updateMatrixWorld(true)
    root.traverse((node) => {
      if (Number.isInteger(node.userData.partId))
        poses.push([
          node.name,
          ...node.position.toArray(),
          ...node.quaternion.toArray(),
          ...node.scale.toArray(),
        ])
      if (node.geometry) geometry.add(node.geometry.uuid)
      if (node.isInstancedMesh)
        instances.push({
          name: node.name,
          count: node.count,
          matrices: [...node.instanceMatrix.array],
        })
      for (const runtime of node.material
        ? Array.isArray(node.material)
          ? node.material
          : [node.material]
        : []) {
        const material = runtime.source ?? runtime
        const maps = ['map', 'normalMap', 'roughnessMap', 'clearcoatRoughnessMap'].map((slot) => {
          const texture = material[slot]
          if (texture) textures.add(texture.uuid)
          return [
            slot,
            texture
              ? {
                  uuid: texture.uuid,
                  name: texture.name,
                  width: texture.image?.width,
                  height: texture.image?.height,
                  channel: texture.channel,
                  colorSpace: texture.colorSpace,
                  testSha256: texture.userData.paintStudyTestSha256,
                  runtimeMatchesSource: runtime[slot] === texture,
                }
              : null,
          ]
        })
        materials.set(material.uuid, {
          name: material.name,
          roughness: material.roughness,
          metalness: material.metalness,
          clearcoat: material.clearcoat,
          clearcoatRoughness: material.clearcoatRoughness,
          normalScale: material.normalScale?.toArray(),
          color: material.color?.getHexString(),
          maps: Object.fromEntries(maps),
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
          node.width,
          node.height,
        ])
    })
    return {
      slug: root.userData.workbenchProduct,
      root: root.uuid,
      version: root.userData.bundleVersion,
      bundle: root.userData.assetBundle,
      hash: root.userData.bundleSha256,
      parts: poses.length,
      geometry: geometry.size,
      textures: textures.size,
      canvases: document.querySelectorAll('canvas').length,
      sameCanvas: document.querySelector('canvas') === test.canvas,
      sameRenderer: test.scene.renderer.instance === test.renderer,
      nativeWebgpu: test.renderer.backend?.isWebGPUBackend === true,
      camera: [
        ...camera.position.toArray(),
        ...camera.quaternion.toArray(),
        ...camera.projectionMatrix.elements,
      ],
      poses: poses.sort((a, b) => a[0].localeCompare(b[0])),
      instances: instances.sort((a, b) => a.name.localeCompare(b.name)),
      materials: [...materials.values()].sort((a, b) => a.name.localeCompare(b.name)),
      lights,
      exposure: test.renderer.toneMappingExposure,
      environment: {
        intensity: scene.environmentIntensity,
        rotation: scene.environmentRotation.toArray(),
        reference: scene.environment?.userData.reference,
      },
      presentation: JSON.parse(JSON.stringify(test.store.presentation)),
      motion: test.motion.snapshot(),
      mood: document.querySelector('.wb-stage')?.dataset.studioMood,
      memory: { ...test.renderer.info.memory },
      lighting: window.__paintCheck.lighting.snapshot(),
    }
  })

function identity(state, mode) {
  const reference = mode === 'v2' ? v2 : study
  expect(state).toMatchObject({
    slug: 'typewriter-study',
    version: reference.version,
    hash: reference.sha256,
    parts: 572,
    canvases: 1,
    sameCanvas: true,
    sameRenderer: true,
    nativeWebgpu: true,
  })
  expect(state.lighting).toMatchObject({
    phase: 'ready',
    error: null,
    indirectLighting: { requested: 'ssgi', actual: 'ssgi', error: null },
  })
  const paint = state.materials.filter((material) => paintNames.includes(material.name))
  expect(paint).toHaveLength(3)
  for (const material of paint) {
    for (const slot of [
      'normalMap',
      'roughnessMap',
      ...(mode === 'v2' ? [] : ['clearcoatRoughnessMap']),
    ])
      expect(material.maps[slot]).toMatchObject({
        width: 2048,
        height: 2048,
        channel: 1,
        colorSpace: '',
        runtimeMatchesSource: true,
      })
    if (mode === 'v2') expect(material.maps.clearcoatRoughnessMap).toBeNull()
    if (mode === 'roughness-only')
      expect(material.maps.normalMap.testSha256).toBe(
        metadata.v2.manifest.files.find((file) => file.path === 'textures/paint-normal.png').sha256,
      )
    else expect(material.maps.normalMap.testSha256).toBeUndefined()
  }
}

async function pose(page, item) {
  await page.evaluate(() => {
    window.__demo.store.panel = null
    window.__demo.store.restore()
  })
  await page.waitForTimeout(1200)
  await page.evaluate(({ id, value }) => window.__demo.store.motion('seek', id, value), {
    id: action.id,
    value: item.progress,
  })
  await expect
    .poll(() => page.evaluate((id) => window.__demo.motion.snapshot()[id]?.progress, action.id))
    .toBe(item.progress)
  if (item.part) {
    const hotspot = product.presentation.hotspots.find(
      (entry) => entry.id === item.part || entry.node === item.part,
    )
    if (!hotspot) throw new Error('Actual comparison hotspot missing: ' + item.part)
    await page.evaluate((id) => window.__demo.store.focus(id), hotspot.id)
  } else await page.evaluate((id) => window.__demo.store.view(id), item.view)
  await page.waitForTimeout(1200)
  await settle(page)
}

async function save(page, result, id, state = null) {
  await page.mouse.move(1, 1)
  await page.screenshot({ path: `${output}/${result.mode}/${id}.png` })
  const current = state ?? (await snapshot(page))
  await writeFile(`${output}/${result.mode}/${id}.json`, JSON.stringify(current, null, 2) + '\n')
  result.captures.push(id)
  console.log(`[paint ${result.mode}] ${id}`)
}

async function actionChecks(page, result) {
  await pose(page, poses[0])
  result.structure = await page.evaluate(async (id) => {
    const test = window.__demo,
      root = window.__paintCheck.root
    let seekCount = 0,
      maxProgressError = 0
    const values = () => {
      const poses = []
      root.traverse((node) => {
        if (Number.isInteger(node.userData.partId))
          poses.push(
            ...node.position.toArray(),
            ...node.quaternion.toArray(),
            ...node.scale.toArray(),
          )
      })
      return poses
    }
    const seek = async (value) => {
      test.store.motion('seek', id, value)
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const actual = test.motion.snapshot()[id]?.progress
      if (typeof actual !== 'number' || !Number.isFinite(actual))
        throw new Error('Actual structure progress unavailable for seek ' + value)
      const error = Math.abs(actual - value)
      if (error > 1e-9)
        throw new Error(`Actual structure progress ${actual} differs from requested ${value}`)
      maxProgressError = Math.max(maxProgressError, error)
      seekCount++
      return values()
    }
    const diff = (a, b) => Math.max(0, ...a.map((value, index) => Math.abs(value - b[index])))
    const initial = await seek(0),
      samples = []
    for (let index = 0; index <= 100; index++) samples.push(await seek(index / 100))
    const endTravel = diff(initial, samples[100]),
      maxTravel = Math.max(...samples.map((sample) => diff(initial, sample)))
    if (!(endTravel > 1e-6))
      throw new Error('Structure 0→1 did not actually move any semantic part')
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
      resetCycles: 50,
      seekCount,
      maxProgressError,
      endTravel,
      maxTravel,
      travelUnits: 'Maximum absolute local position/quaternion/scale component difference',
      reverseError,
      resetError,
    }
  }, action.id)
  expect(result.structure.maxProgressError).toBeLessThanOrEqual(1e-9)
  expect(result.structure.endTravel).toBeGreaterThan(1e-6)
  expect(result.structure.reverseError).toBeLessThanOrEqual(1e-6)
  expect(result.structure.resetError).toBeLessThanOrEqual(1e-6)
  result.strike = await page.evaluate(
    async ({ id, node }) => {
      const key = window.__paintCheck.root.getObjectByName(node)
      if (!key) throw new Error('Actual strike key missing')
      const initial = [...key.position.toArray(), ...key.quaternion.toArray()]
      window.__demo.store.action(id)
      for (let frame = 0; frame < 120; frame++) {
        await new Promise((resolve) => requestAnimationFrame(resolve))
        const current = [...key.position.toArray(), ...key.quaternion.toArray()],
          delta = Math.max(0, ...current.map((value, index) => Math.abs(value - initial[index])))
        if (delta > 1e-6) return { node, delta, observedRaf: frame }
      }
      throw new Error('Actual strike key did not move')
    },
    { id: pulse.id, node: pulse.node },
  )
  await page.waitForTimeout(1500)
  await settle(page)
  await page.evaluate((id) => window.__demo.store.motion('play', id, 0.6), action.id)
  await expect
    .poll(() => page.evaluate((id) => window.__demo.motion.snapshot()[id]?.progress, action.id))
    .toBeGreaterThan(0.05)
  await page.evaluate((id) => window.__demo.store.motion('pause', id), action.id)
  const paused = await snapshot(page)
  expect(paused.motion[action.id].playing).toBe(false)
  await settle(page)
  const held = await snapshot(page)
  expect(held.poses).toEqual(paused.poses)
  expect(held.motion[action.id]).toEqual(paused.motion[action.id])
  result.pause = {
    progress: held.motion[action.id].progress,
    frames: held.lighting.frames - paused.lighting.frames,
  }
  await save(page, result, 'paused', held)
}

async function warmNight(page, result) {
  await pose(page, poses[0])
  const initial = await snapshot(page)
  await page.getByRole('button', { name: '切换暖夜环境', exact: true }).click()
  await expect(page.locator('.wb-stage')).toHaveAttribute('data-studio-mood', 'dark')
  await expect(page.locator('.wb-stage')).toHaveAttribute('data-studio-environment', 'ready', {
    timeout: 120000,
  })
  await page.waitForTimeout(700)
  await settle(page)
  const warm = await snapshot(page)
  identity(warm, result.mode)
  expect(warm.root).toBe(initial.root)
  expect(warm.poses).toEqual(initial.poses)
  expect(difference(warm.camera, initial.camera)).toBeLessThanOrEqual(1e-6)
  await save(page, result, 'warm-night', warm)
  await page.getByRole('button', { name: '切换明亮环境', exact: true }).click()
  await expect(page.locator('.wb-stage')).toHaveAttribute('data-studio-mood', 'light')
  await page.waitForTimeout(700)
  await settle(page)
  const restored = await snapshot(page)
  identity(restored, result.mode)
  expect(restored.poses).toEqual(initial.poses)
  expect(difference(restored.camera, initial.camera)).toBeLessThanOrEqual(1e-6)
  result.mood = {
    warmSameRoot: true,
    restoredSameRoot: restored.root === initial.root,
    cameraError: difference(restored.camera, initial.camera),
  }
}

async function reloads(page, result) {
  if (result.mode === 'roughness-only') await restoreNormal(page)
  await trackLifecycle(page)
  const reload = async (iteration) => {
    const initial = await snapshot(page)
    await page.evaluate(() => {
      void window.__demo.store.select('typewriter-study')
    })
    await ready(page)
    if (result.mode === 'roughness-only') {
      await overrideNormal(page)
      await settle(page)
    }
    const current = await snapshot(page)
    identity(current, result.mode)
    expect(current.root).not.toBe(initial.root)
    // The census must see the actual loader-owned paint-study normal, not the
    // temporary test replacement. Otherwise an undisposed source normal could
    // be absent from the listener ledger and pass unnoticed.
    if (result.mode === 'roughness-only') await restoreNormal(page)
    const resourceState = await snapshot(page)
    const old = await trackLifecycle(page)
    for (const entry of old) {
      expect(entry.detached).toBe(true)
      expect(entry.disposed).toEqual(entry.resources)
    }
    return {
      iteration,
      root: current.root,
      geometry: resourceState.geometry,
      textures: resourceState.textures,
      memory: resourceState.memory,
      resourceScope:
        result.mode === 'roughness-only'
          ? 'After restoring the package-owned normal and disposing the temporary test texture'
          : 'Actual loaded package and runtime renderer resources',
      old,
    }
  }
  // One explicit full reload warms transient allocations before the measured
  // three-reload sequence. It is recorded rather than silently discarded.
  result.reloadWarmup = await reload('warmup')
  for (let index = 0; index < 3; index++) result.reloads.push(await reload(index + 1))
  const values = result.reloads.map((entry) => [entry.geometry, entry.textures])
  for (const value of values) expect(value).toEqual(values[0])
  const fields = [...new Set(result.reloads.flatMap((entry) => Object.keys(entry.memory)))].filter(
    (field) => result.reloads.every((entry) => Number.isFinite(entry.memory[field])),
  )
  const deltas = result.reloads.map((entry, index) => {
    const previous = index === 0 ? result.reloadWarmup.memory : result.reloads[index - 1].memory
    return {
      iteration: entry.iteration,
      values: entry.memory,
      deltaFromPrevious: Object.fromEntries(
        fields.map((field) => [field, entry.memory[field] - previous[field]]),
      ),
    }
  })
  const sustainedGrowthFields = fields.filter(
    (field) =>
      result.reloads[1].memory[field] > result.reloads[0].memory[field] &&
      result.reloads[2].memory[field] > result.reloads[1].memory[field],
  )
  result.memoryPlatform = {
    method:
      'renderer.info.memory accounting after one separately recorded warmup reload; includes CPU program-text estimates and is not physical GPU VRAM. All numeric fields are reported. Consecutive growth across all three measured reloads fails this batch.',
    warmup: result.reloadWarmup.memory,
    deltas,
    ranges: Object.fromEntries(
      fields.map((field) => {
        const samples = result.reloads.map((entry) => entry.memory[field])
        return [field, { min: Math.min(...samples), max: Math.max(...samples) }]
      }),
    ),
    exactPlateau: fields.every(
      (field) =>
        result.reloads[0].memory[field] === result.reloads[1].memory[field] &&
        result.reloads[1].memory[field] === result.reloads[2].memory[field],
    ),
    sustainedGrowthFields,
  }
  expect(
    sustainedGrowthFields,
    'Sustained renderer accounting growth requires investigation',
  ).toEqual([])
  if (result.mode === 'roughness-only') {
    await overrideNormal(page)
    await settle(page)
  }
}

async function schedulingSample(page, result) {
  await pose(page, poses[0])
  const recording = page.evaluate(
    async ({ id, duration }) => {
      const started = performance.now(),
        intervals = [],
        submissions = window.__paintCheck.lighting.snapshot().frames
      let previous = started,
        lastStrike = started
      while (performance.now() - started < duration) {
        const now = await new Promise((resolve) => requestAnimationFrame(resolve))
        intervals.push(now - previous)
        previous = now
        if (now - lastStrike > 900) {
          window.__demo.store.action(id)
          lastStrike = now
        }
        const state = window.__paintCheck.lighting.snapshot()
        if (state.error || state.indirectLighting?.error)
          throw new Error(state.error || state.indirectLighting.error)
      }
      return {
        elapsedMs: performance.now() - started,
        intervalsMs: intervals,
        successfulSubmissionDelta: window.__paintCheck.lighting.snapshot().frames - submissions,
      }
    },
    { id: pulse.id, duration: 30000 },
  )
  const box = await page.locator('canvas').boundingBox()
  if (!box) throw new Error('Actual canvas bounds unavailable')
  const started = Date.now()
  while (Date.now() - started < 30000) {
    const x = box.x + box.width * 0.56,
      y = box.y + box.height * 0.5
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + 90, y + 18, { steps: 12 })
    await page.mouse.move(x - 60, y - 12, { steps: 12 })
    await page.mouse.up()
  }
  const sample = await recording
  const sorted = [...sample.intervalsMs].sort((a, b) => a - b)
  const quantile = (value) => sorted[Math.floor((sorted.length - 1) * value)]
  result.rafScheduling = {
    ...sample,
    medianMs: quantile(0.5),
    p95Ms: quantile(0.95),
    evidence:
      'Browser RAF callback scheduling during real mouse dragging and repeated key intents; not GPU duration, displayed FPS or actual presentation timing',
    frameBudgetValidated: false,
    memory: (await snapshot(page)).memory,
  }
  expect(sample.elapsedMs).toBeGreaterThanOrEqual(30000)
  expect(sample.successfulSubmissionDelta).toBeGreaterThan(0)
}

const htmlEscape = (text) =>
  String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;')
async function gallery() {
  const rows = [...poses.map((pose) => pose.id), 'warm-night', 'paused']
  const headings = {
    v2: '原 v2',
    'roughness-only': '新粗糙度＋清漆／原 v2 法线',
    'paint-study': '完整黑漆＋艺术字样片',
  }
  const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WindGear 黑漆材质样片对照</title><style>body{margin:0;padding:32px;background:#161917;color:#e8e8df;font:15px/1.6 system-ui}h1{font-size:26px;margin:0 0 8px}p{max-width:1000px;color:#bec5bb}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}figure{margin:0}img{width:100%;display:block;border:1px solid #40463f}figcaption{padding:6px 0;color:#cfd4c9}h2{font-size:18px;margin-top:30px}a{color:#e4c891}@media(max-width:800px){body{padding:16px}.grid{grid-template-columns:1fr}}</style><h1>WindGear 黑漆材质样片</h1><p>同一 SSGI、明亮摄影棚、相机与结构姿态。中间组只在测试页替换为原 v2 法线；新粗糙度、清漆和铭牌保持。截图供人工判断，工程通过不等于画质或实际帧预算通过。生成于 ${htmlEscape(report.startedAt)}。<a href="summary.json">本批原始报告</a></p>${rows
    .map(
      (id) =>
        `<h2>${htmlEscape(id)}</h2><div class="grid">${modes
          .map((mode) => {
            const result = report.cases.find((entry) => entry.mode === mode)
            return result?.captures.includes(id)
              ? `<figure><a href="${mode}/${id}.png"><img loading="lazy" src="${mode}/${id}.png" alt="${htmlEscape(headings[mode])} ${id}"></a><figcaption>${htmlEscape(headings[mode])}</figcaption></figure>`
              : '<p>本批未完成此取景</p>'
          })
          .join('')}</div>`,
    )
    .join('')}</html>`
  await writeFile(output + '/index.html', html)
  const destination = resolve('dist/artifacts/typewriter-paint/browser')
  try {
    await access('dist/index.html')
    if (resolve(output) !== destination) await cp(output, destination, { recursive: true })
    report.gallery = {
      path: destination + '/index.html',
      url: new URL('/artifacts/typewriter-paint/browser/index.html', base).href,
    }
  } catch (error) {
    report.gallery = {
      published: false,
      reason: error.message,
      path: resolve(output, 'index.html'),
    }
  }
}

try {
  product = JSON.parse(await verifiedResponse(new URL('/api/v1/products/typewriter-study', base)))
  action = product.presentation.actions.find((entry) => entry.motion?.program)
  pulse = product.presentation.actions.find((entry) => entry.kind === 'pulse')
  if (!action || !pulse) throw new Error('Actual structure and strike unavailable')
  v2 = JSON.parse(await readFile('src/lib/workbench/typewriterV2Bundle.json', 'utf8'))
  study = JSON.parse(
    await readFile(
      'public/models/bundles/kimi-typewriter/paint-study/bundle-reference.json',
      'utf8',
    ),
  )
  record = JSON.parse(
    await readFile(
      'public/models/bundles/kimi-typewriter/paint-study/production-record.json',
      'utf8',
    ),
  )
  metadata = { v2: await resourceMetadata(v2), study: await resourceMetadata(study) }
  expect(metadata.study.brand.sha256).toBe(record.brandReplacement.candidateSha256)
  report.resources = metadata
  report.productionRecordSha256 = hash(record)
  report.apiProductSha256 = hash(product)
  browser = await chromium.launch({ channel: 'msedge', headless: true })
  for (const mode of modes) {
    const result = {
      mode,
      passed: false,
      captures: [],
      errors: [],
      warnings: [],
      requests: [],
      failedRequests: [],
      reloads: [],
    }
    report.cases.push(result)
    await mkdir(`${output}/${mode}`, { recursive: true })
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1 }),
      page = await context.newPage()
    page.on('pageerror', (error) =>
      result.errors.push({ kind: 'pageerror', message: error.message }),
    )
    page.on('console', (message) => {
      if (message.type() === 'error')
        result.errors.push({ kind: 'console', message: message.text() })
      if (message.type() === 'warning') {
        result.warnings.push(message.text())
        if (
          /GPUValidationError|validation.*(?:error|failed)|(?:WGSL|shader|pipeline|binding).*(?:error|invalid|failed)/i.test(
            message.text(),
          )
        )
          result.errors.push({ kind: 'gpu-warning', message: message.text() })
      }
    })
    page.on('request', (request) => {
      if (/^https?:/.test(request.url())) result.requests.push(request.url())
    })
    page.on('requestfailed', (request) =>
      result.failedRequests.push({ url: request.url(), reason: request.failure()?.errorText }),
    )
    page.on('response', (response) => {
      if (response.status() >= 400)
        result.errors.push({ kind: 'http', status: response.status(), url: response.url() })
    })
    try {
      const url = new URL(
        '/?product=typewriter-study&renderPipeline=realtime&studioMood=light&indirectLighting=ssgi',
        base,
      )
      url.searchParams.set('typewriterAsset', mode === 'v2' ? 'v2' : 'paint-study')
      result.url = url.href
      await page.goto(url.href, { waitUntil: 'domcontentloaded' })
      await ready(page, true)
      if (mode === 'roughness-only') {
        result.override = await overrideNormal(page)
        await settle(page)
      }
      result.initial = await snapshot(page)
      identity(result.initial, mode)
      for (const item of poses) {
        await pose(page, item)
        const state = await snapshot(page)
        identity(state, mode)
        const common = {
          poses: state.poses,
          instances: state.instances,
          lights: state.lights,
          exposure: state.exposure,
          environment: state.environment,
        }
        const inputHash = hash(common)
        if (baselines.has(item.id)) {
          const original = baselines.get(item.id),
            cameraError = difference(original.camera, state.camera)
          expect(inputHash).toBe(original.inputHash)
          expect(cameraError).toBeLessThanOrEqual(1e-6)
          report.pairs.push({ mode, id: item.id, cameraError, inputHash })
        } else baselines.set(item.id, { inputHash, camera: state.camera })
        await save(page, result, item.id, state)
      }
      await warmNight(page, result)
      if (scope === 'full') {
        await actionChecks(page, result)
        if (mode === 'paint-study') await schedulingSample(page, result)
        await reloads(page, result)
      } else
        result.deferred = [
          'Actions, determinism, RAF scheduling and reload checks not run in views scope',
        ]
      result.final = await snapshot(page)
      identity(result.final, mode)
      expect(result.requests.every((url) => new URL(url).origin === origin)).toBe(true)
      expect(result.failedRequests).toEqual([])
      expect(result.errors).toEqual([])
      result.passed = true
    } catch (error) {
      result.errors.push({ kind: 'test', message: error.stack || String(error) })
      process.exitCode = 1
      try {
        result.failureLighting = await lighting(page)
        await page.screenshot({ path: `${output}/${mode}/failure.png` })
      } catch {
        /* Host may no longer be drawable. */
      }
    } finally {
      try {
        await restoreNormal(page)
      } catch (error) {
        result.errors.push({ kind: 'test-cleanup', message: error.message })
      }
      await context.close()
      if (result.errors.length || result.failedRequests.length) result.passed = false
      await writeFile(`${output}/${mode}/report.json`, JSON.stringify(result, null, 2) + '\n')
    }
  }
  report.passed = report.engineeringPassed =
    report.cases.every((entry) => entry.passed) && report.pairs.length === 12
  if (!report.passed) process.exitCode = 1
} catch (error) {
  report.errors.push({ kind: 'test', message: error.stack || String(error) })
  process.exitCode = 1
} finally {
  await browser?.close()
  report.finishedAt = new Date().toISOString()
  await writeFile(output + '/summary.json', JSON.stringify(report, null, 2) + '\n')
  await gallery()
  await writeFile(output + '/summary.json', JSON.stringify(report, null, 2) + '\n')
  if (report.gallery?.url)
    await cp(
      output + '/summary.json',
      resolve('dist/artifacts/typewriter-paint/browser/summary.json'),
    )
  console.log(
    JSON.stringify({
      passed: report.passed,
      scope,
      pairs: report.pairs.length,
      visualAccepted: false,
      frameBudgetValidated: false,
      output,
      gallery: report.gallery,
      cases: report.cases.map((entry) => ({
        mode: entry.mode,
        passed: entry.passed,
        captures: entry.captures.length,
        errors: entry.errors.length,
      })),
    }),
  )
}

/* global fetch, URL, AbortSignal, requestAnimationFrame, performance, innerHeight */
import { chromium, expect } from '@playwright/test'
import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { bridge } from './demo/browser-check.mjs'

const base = process.env.CHECK_URL || 'http://127.0.0.1:5181'
const origin = new URL(base).origin
const output = 'artifacts/lounge-spatial'
const viewport = { width: 1440, height: 1000 }
const availableModes = ['infinite', 'box', 'depth', 'depth-dof', 'layers']
const modes = process.env.LOUNGE_SPATIAL_MODES?.split(',') ?? availableModes
if (!modes.length || modes.some((mode) => !availableModes.includes(mode)))
  throw new Error('LOUNGE_SPATIAL_MODES must contain infinite, box, depth, depth-dof or layers')
const projectionMode = (mode) => (mode === 'depth-dof' ? 'depth' : mode === 'layers' ? 'box' : mode)
const poses = [
  { id: 'whole', progress: 0, view: 'perspective' },
  { id: 'front', progress: 0, view: 'front' },
  { id: 'side', progress: 0, view: 'side' },
  { id: 'back', progress: 0, view: 'front', horizontalSteps: 26 },
  { id: 'top', progress: 0, view: 'top' },
  { id: 'paintclose', progress: 0, part: 'part-095' },
  { id: 'layers-0.6', progress: 0.6, view: 'structure' },
  { id: 'flat', progress: 1, view: 'knoll' },
]
const report = {
  passed: false,
  engineeringPassed: false,
  visualAccepted: false,
  fixture: false,
  viewport,
  modes,
  cases: [],
  pairs: [],
  errors: [],
  pending: ['Human review of all stills and orbit videos', 'Actual GPU/presentation budget'],
  method:
    'Real typewriter API, production Vue/Pinia/Three objects and native Edge WebGPU. No API fixtures, alternate renderer, direct camera writes, control-bound changes, synthetic scene, GPU readback or image-quality auto-pass. Mode changes navigate to a new real host; mood changes operate the existing host. Browser recordVideo captures each full case including a continuous ordinary-store orbit segment. Observed requestAnimationFrame movement and complete-frame counters are not GPU or screen presentation timing. Mobile evidence resizes the same WebGPU host.',
  rearView:
    'The real product has no named rear preset. The back capture starts from its real front preset and issues 26 ordinary horizontal orbit intents (26 × 0.12 = 3.12 rad); actual world/projection matrices are saved, with no claim of an exact π turn.',
  wideView:
    'Non-infinite cases include a supplementary wide-table observation using four ordinary zoom-out intents and two upward vertical orbit intents. Its camera is deliberately different from the frozen comparison views and it never enters the baseline pairs.',
}
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const difference = (a, b) =>
  a.length === b.length
    ? Math.max(0, ...a.map((value, index) => Math.abs(value - b[index])))
    : Infinity
const baseline = new Map()
let browser, product, action, pulse, bundle
await mkdir(output, { recursive: true })

async function attach(page) {
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
  for (const attribute of ['lighting-phase', 'studio-environment']) {
    await expect(page.locator('.wb-stage')).toHaveAttribute('data-' + attribute, 'ready', {
      timeout: 120000,
    })
  }
  await bridge(page, true)
  await page.evaluate(() => {
    const seen = new Set()
    const visit = (vnode) => {
      if (!vnode || typeof vnode !== 'object' || seen.has(vnode)) return
      seen.add(vnode)
      const exposed = vnode.component?.exposed?.realLighting
      const value = exposed?.value ?? exposed
      if (value?.snapshot && value?.setSignals) return value
      const nested = visit(vnode.component?.subTree)
      if (nested) return nested
      for (const child of Array.isArray(vnode.children) ? vnode.children : []) {
        const found = visit(child)
        if (found) return found
      }
      return visit(vnode.suspense?.activeBranch)
    }
    const test = window.__demo
    window.__spatial = {
      lighting: visit(document.querySelector('#app')?._vnode),
      root: test.scene.scene.value.children.find((node) => node.userData.workbenchProduct),
      camera: test.scene.camera.activeCamera.value,
    }
    if (!window.__spatial.lighting || !window.__spatial.root)
      throw new Error('Actual scene/coordinator bridge unavailable')
  })
}

async function settle(page, transition = false) {
  if (transition) await page.waitForTimeout(1200)
  const initial = await page.evaluate(() => window.__spatial.lighting.snapshot())
  if (!initial) throw new Error('Actual realtime coordinator unavailable')
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const state = window.__spatial.lighting.snapshot()
          if (!state || state.error || state.phase === 'error')
            throw new Error(state?.error || 'Actual realtime render failed')
          return state.frames
        }),
      { timeout: 60000 },
    )
    .toBeGreaterThan(initial.frames + 3)
}

const snapshot = (page) =>
  page.evaluate(() => {
    const test = window.__demo
    const scene = test.scene.scene.value
    const renderer = test.scene.renderer.instance
    const roots = scene.children.filter((node) => node.userData.workbenchProduct)
    const root = roots[0]
    const studio = scene.children.find((node) => node.userData.studio && !node.userData.capture)
    const camera = test.scene.camera.activeCamera.value
    const partPoses = [],
      geometry = new Map(),
      materials = new Map(),
      calibration = []
    const projections = [],
      imageLayers = []
    const isProjection = (node) =>
      ['Trees X / finite lounge projection', 'Trees X / depth lounge projection'].includes(
        node.name,
      )
    const effectivelyVisible = (node) => {
      let current = node
      while (current) {
        if (!current.visible) return false
        current = current.parent
      }
      return true
    }
    const texture = (value) =>
      value
        ? {
            name: value.name,
            width: value.image?.width ?? null,
            height: value.image?.height ?? null,
            channel: value.channel,
            colorSpace: value.colorSpace,
            source: value.userData?.loungeAsset ?? null,
          }
        : null
    scene.updateMatrixWorld(true)
    camera.updateMatrixWorld(true)
    scene.traverse((node) => {
      if (node.userData.loungeSpatial)
        calibration.push({
          name: node.name,
          value: JSON.parse(JSON.stringify(node.userData.loungeSpatial)),
        })
      if (node.userData.loungeImageLayers)
        imageLayers.push({
          name: node.name,
          visible: effectivelyVisible(node),
          selfVisible: node.visible,
          metadata: JSON.parse(JSON.stringify(node.userData.loungeImageLayers)),
          cards: node.children
            .filter((child) => child.isMesh)
            .map((child) => ({
              name: child.name,
              visible: child.visible,
              effectiveVisible: effectivelyVisible(child),
              world: child.matrixWorld.toArray(),
              material: child.material.name,
              alphaTest: child.material.alphaTest,
              depthTest: child.material.depthTest,
              depthWrite: child.material.depthWrite,
            })),
        })
    })
    studio?.traverse((node) => {
      if (!isProjection(node)) return
      let parent = node.parent,
        fallback = false
      while (parent && parent !== studio) {
        fallback ||= isProjection(parent)
        parent = parent.parent
      }
      const meshes = []
      node.traverse((child) => {
        if (!child.isMesh) return
        meshes.push({
          name: child.name,
          visible: child.visible,
          vertices: child.geometry.getAttribute('position')?.count,
          triangles:
            (child.geometry.index?.count ?? child.geometry.getAttribute('position')?.count ?? 0) /
            3,
          world: child.matrixWorld.toArray(),
          material: child.material?.name,
          depthTest: child.material?.depthTest,
          depthWrite: child.material?.depthWrite,
        })
      })
      projections.push({
        name: node.name,
        visible: node.visible,
        fallback,
        depth: node.userData.depthProjection ?? null,
        meshes,
      })
    })
    root?.traverse((node) => {
      if (Number.isInteger(node.userData.partId))
        partPoses.push({
          name: node.name,
          local: [
            ...node.position.toArray(),
            ...node.quaternion.toArray(),
            ...node.scale.toArray(),
          ],
          world: node.matrixWorld.toArray(),
        })
      if (node.geometry)
        geometry.set(node.geometry.uuid, {
          uuid: node.geometry.uuid,
          name: node.geometry.name,
          vertices: node.geometry.getAttribute('position')?.count,
          indices: node.geometry.index?.count ?? 0,
        })
      for (const material of node.material
        ? Array.isArray(node.material)
          ? node.material
          : [node.material]
        : [])
        materials.set(material.uuid, {
          name: material.name,
          color: material.color?.getHexString(),
          roughness: material.roughness,
          metalness: material.metalness,
          clearcoat: material.clearcoat,
          clearcoatRoughness: material.clearcoatRoughness,
          anisotropy: material.anisotropy,
          opacity: material.opacity,
          transparent: material.transparent,
          map: texture(material.map),
          normal: texture(material.normalMap),
          roughnessMap: texture(material.roughnessMap),
        })
    })
    const primary = projections.filter((entry) => !entry.fallback)
    return {
      slug: root?.userData.workbenchProduct,
      bundle: root?.userData.assetBundle,
      version: root?.userData.bundleVersion,
      bundleSha256: root?.userData.bundleSha256,
      root: root?.uuid,
      roots: roots.length,
      parts: partPoses.length,
      sameRoot: root === window.__spatial.root,
      sameCamera: camera === window.__spatial.camera,
      sameCanvas: document.querySelector('canvas') === test.canvas,
      sameRenderer: renderer === test.renderer,
      canvases: document.querySelectorAll('canvas').length,
      nativeWebgpu: renderer.backend?.isWebGPUBackend === true,
      canvas: { width: renderer.domElement.width, height: renderer.domElement.height },
      camera: {
        position: camera.position.toArray(),
        quaternion: camera.quaternion.toArray(),
        world: camera.matrixWorld.toArray(),
        worldInverse: camera.matrixWorldInverse.toArray(),
        projection: camera.projectionMatrix.toArray(),
        projectionInverse: camera.projectionMatrixInverse.toArray(),
        near: camera.near,
        far: camera.far,
        fov: camera.fov,
      },
      geometry: [...geometry.values()].sort((a, b) => a.uuid.localeCompare(b.uuid)),
      poses: partPoses.sort((a, b) => a.name.localeCompare(b.name)),
      finish: test.store.finishId,
      materials: [...materials.values()].sort((a, b) =>
        JSON.stringify(a).localeCompare(JSON.stringify(b)),
      ),
      motion: Object.fromEntries(
        Object.entries(test.motion.snapshot()).map(([id, value]) => [
          id,
          { progress: value.progress, target: value.target, playing: value.playing },
        ]),
      ),
      actions: { ...test.store.actions },
      selectedPart: test.store.selectedPart,
      actualPresentation: JSON.parse(JSON.stringify(test.store.presentation)),
      studio: { mood: studio?.userData.studioMood, lounge: studio?.userData.lounge ?? null },
      calibration,
      imageLayers,
      dof: scene.userData.loungeDof ? JSON.parse(JSON.stringify(scene.userData.loungeDof)) : null,
      physicalProjection: {
        count: primary.length,
        fallbackCount: projections.length - primary.length,
        actualMode: primary.some((entry) => entry.name === 'Trees X / depth lounge projection')
          ? 'depth'
          : primary.length
            ? 'box'
            : 'infinite',
        groups: projections,
      },
      lighting: window.__spatial.lighting.snapshot(),
    }
  })

function identity(state, mode) {
  expect(state).toMatchObject({
    slug: 'typewriter-study',
    version: 2,
    bundleSha256: bundle.sha256,
    roots: 1,
    parts: 572,
    sameRoot: true,
    sameCamera: true,
    sameCanvas: true,
    sameRenderer: true,
    canvases: 1,
    nativeWebgpu: true,
  })
  expect(state.geometry.length).toBeGreaterThan(0)
  if (mode === 'infinite')
    expect(state.calibration.length, 'infinite has no finite spatial calibration').toBe(0)
  else
    expect(state.calibration.length, 'actual loungeSpatial calibration metadata').toBeGreaterThan(0)
  expect(state.physicalProjection.actualMode).toBe(projectionMode(mode))
  expect(state.physicalProjection.count).toBe(mode === 'infinite' ? 0 : 1)
  if (mode !== 'infinite')
    for (const group of state.physicalProjection.groups.filter((entry) => !entry.fallback))
      expect(group.visible, 'finite projection follows the current mood').toBe(
        state.studio.mood === 'dark',
      )
  if (mode === 'layers') {
    const layered = state.calibration.find((entry) => entry.value.imageLayers)?.value
    expect(layered?.imageLayers?.cardCount, 'actual layered branch metadata').toBe(2)
    expect(layered?.cleanPlate, 'actual clean background source').toBe(
      '/studio/amber-lounge/layers-v1/clean-room.png',
    )
    expect(state.imageLayers, 'actual independent card group').toHaveLength(1)
    expect(state.imageLayers[0].cards, 'actual independent mesh count').toHaveLength(2)
    expect(state.imageLayers[0].visible, 'cards follow the current mood').toBe(
      state.studio.mood === 'dark',
    )
    for (const card of state.imageLayers[0].cards) {
      expect(card).toMatchObject({
        visible: true,
        alphaTest: 0.2,
        depthTest: true,
        depthWrite: true,
      })
      expect(card.effectiveVisible, 'card ancestors follow the current mood').toBe(
        state.studio.mood === 'dark',
      )
    }
  } else expect(state.imageLayers).toHaveLength(0)
  expect(state.dof?.enabled, 'actual optional DOF selection').toBe(mode === 'depth-dof')
  if (mode === 'depth-dof') {
    expect(state.dof.active, 'actual product clear-band DOF active').toBe(true)
    expect(state.dof.boundsUpdates).toBeGreaterThan(0)
    expect(state.dof.far).toBeGreaterThan(state.dof.near)
  }
}

function unchanged(before, after, mode, label, camera = true) {
  identity(after, mode)
  for (const key of [
    'root',
    'geometry',
    'finish',
    'materials',
    'poses',
    'motion',
    'actions',
    'selectedPart',
    'actualPresentation',
  ])
    expect(after[key], label + ': ' + key).toEqual(before[key])
  const cameraError = difference(
    Object.values(before.camera).flat(),
    Object.values(after.camera).flat(),
  )
  if (camera) expect(cameraError, label + ': complete camera').toBeLessThanOrEqual(1e-6)
  return { label, cameraError, root: after.root, parts: after.parts, motion: after.motion }
}

async function preparePose(page, item) {
  await page.evaluate(() => {
    window.__demo.store.panel = null
    window.__demo.store.restore()
  })
  await settle(page, true)
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
    if (!hotspot) throw new Error('Real comparison hotspot unavailable: ' + item.part)
    await page.evaluate((id) => window.__demo.store.focus(id), hotspot.id)
  } else await page.evaluate((id) => window.__demo.store.view(id), item.view)
  await settle(page, true)
  if (item.horizontalSteps) {
    await page.evaluate(async (steps) => {
      for (let index = 0; index < steps; index++) {
        window.__demo.store.orbit('horizontal', 1)
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      }
    }, item.horizontalSteps)
    await settle(page)
  }
}

async function capture(page, result, name, state) {
  await page.mouse.move(1, 1)
  const file = name + '.png'
  await page.screenshot({ path: output + '/' + result.mode + '/' + file })
  const metadata = state ?? (await snapshot(page))
  await writeFile(
    output + '/' + result.mode + '/' + name + '.json',
    JSON.stringify(metadata, null, 2) + '\n',
  )
  result.captures.push({ id: name, image: file, metadata: name + '.json', camera: metadata.camera })
  console.log('[lounge spatial ' + result.mode + '] ' + name)
}

async function captureWideTable(page, result) {
  await preparePose(page, poses[0])
  const before = await snapshot(page)
  await page.evaluate(async () => {
    const wait = () =>
      new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    for (let step = 0; step < 4; step++) {
      window.__demo.store.zoom(-1)
      await wait()
    }
    for (let step = 0; step < 2; step++) {
      window.__demo.store.orbit('vertical', -1)
      await wait()
    }
  })
  await settle(page)
  const state = await snapshot(page)
  expect(difference(before.camera.world, state.camera.world)).toBeGreaterThan(1e-6)
  result.checks.push(
    unchanged(
      before,
      state,
      result.mode,
      'supplementary wider table observation preserves shape',
      false,
    ),
  )
  state.observation = {
    frozenComparison: false,
    purpose: 'Observe the complete real table body, its ground contact and nearby room context',
    method: 'Default whole view, four store.zoom(-1), then two store.orbit(vertical, -1)',
    baselinePair: false,
  }
  await capture(page, result, 'wide-table', state)
}

async function mood(page, target) {
  await page
    .getByRole('button', {
      name: target === 'light' ? '切换明亮环境' : '切换暖夜环境',
      exact: true,
    })
    .click()
  await expect(page.locator('.wb-stage')).toHaveAttribute('data-studio-mood', target)
  await settle(page, true)
}

async function recordOrbit(page, result) {
  await preparePose(page, poses[0])
  const before = await snapshot(page)
  result.orbit = await page.evaluate(async () => {
    const test = window.__demo
    const camera = test.scene.camera.activeCamera.value
    const plan = [
      ...Array.from({ length: 53 }, () => ({ axis: 'horizontal', direction: 1 })),
      ...Array.from({ length: 6 }, () => ({ axis: 'vertical', direction: -1 })),
      ...Array.from({ length: 12 }, () => ({ axis: 'vertical', direction: 1 })),
      ...Array.from({ length: 6 }, () => ({ axis: 'vertical', direction: -1 })),
    ]
    const started = performance.now(),
      startFrames = window.__spatial.lighting.snapshot().frames
    const samples = [],
      commands = []
    let next = started,
      previous = null,
      movementFrames = 0
    while (commands.length < plan.length || performance.now() < next + 250) {
      await new Promise((resolve) => requestAnimationFrame(resolve))
      const now = performance.now()
      camera.updateMatrixWorld(true)
      const world = camera.matrixWorld.toArray()
      const delta = previous
        ? Math.max(...world.map((value, index) => Math.abs(value - previous[index])))
        : 0
      if (delta > 1e-7) movementFrames++
      samples.push({
        elapsedMs: now - started,
        world,
        moved: delta > 1e-7,
        completeFrames: window.__spatial.lighting.snapshot().frames,
      })
      previous = world
      if (now >= next && commands.length < plan.length) {
        const command = plan[commands.length]
        test.store.orbit(command.axis, command.direction)
        commands.push({ ...command, elapsedMs: now - started })
        next = now + 110
      }
      if (now - started > 45000)
        throw new Error('Ordinary orbit failed to finish within 45 seconds')
    }
    return {
      commands,
      samples,
      observedAnimationFrames: samples.length,
      movementFrames,
      completeFrameDelta: window.__spatial.lighting.snapshot().frames - startFrames,
      elapsedMs: performance.now() - started,
      timingMeaning:
        'CPU observation duration and actual camera movement; neither GPU duration nor presented FPS',
    }
  })
  await settle(page)
  expect(result.orbit.movementFrames).toBeGreaterThan(20)
  expect(result.orbit.completeFrameDelta).toBeGreaterThan(3)
  result.checks.push(
    unchanged(
      before,
      await snapshot(page),
      result.mode,
      'ordinary continuous orbit preserves product shape and state',
      false,
    ),
  )
}

async function checkMoodPreservation(page, result) {
  await preparePose(
    page,
    poses.find((item) => item.id === 'layers-0.6'),
  )
  const alternate = product.presentation.finishes[1]?.id
  if (alternate) await page.evaluate((id) => window.__demo.store.finish(id), alternate)
  await settle(page)
  const before = await snapshot(page)
  await mood(page, 'light')
  result.checks.push(
    unchanged(
      before,
      await snapshot(page),
      result.mode,
      'dark to light preserves non-default finish and 0.6 structure',
    ),
  )
  await capture(page, result, 'mood-light-layers')
  await mood(page, 'dark')
  result.checks.push(
    unchanged(
      before,
      await snapshot(page),
      result.mode,
      'light to dark preserves non-default finish and 0.6 structure',
    ),
  )
}

async function checkStrike(page, result) {
  await preparePose(page, poses[0])
  const before = await snapshot(page)
  const movement = await page.evaluate(
    async ({ id, node }) => {
      const key = window.__spatial.root.getObjectByName(node)
      if (!key) throw new Error('Actual strike node unavailable')
      const initial = [...key.position.toArray(), ...key.quaternion.toArray()]
      window.__demo.store.action(id)
      for (let frame = 0; frame < 90; frame++) {
        await new Promise((resolve) => requestAnimationFrame(resolve))
        const current = [...key.position.toArray(), ...key.quaternion.toArray()]
        const delta = Math.max(...current.map((value, index) => Math.abs(value - initial[index])))
        if (delta > 1e-6) return { observed: true, frame, node, initial, current, delta }
      }
      throw new Error('Real strike produced no observed movement')
    },
    { id: pulse.id, node: pulse.node },
  )
  await settle(page, true)
  result.checks.push({ label: 'real key strike movement', ...movement })
  const after = await snapshot(page)
  identity(after, result.mode)
  expect(after.root).toBe(before.root)
  expect(after.geometry).toEqual(before.geometry)
  expect(after.finish).toBe(before.finish)
  expect(
    difference(
      before.poses.flatMap((part) => part.local),
      after.poses.flatMap((part) => part.local),
    ),
  ).toBeLessThanOrEqual(1e-6)
}

async function checkLayouts(page, result) {
  for (const [width, height] of [
    [1280, 720],
    [1440, 1000],
    [1920, 1080],
    [390, 844],
    [320, 740],
  ]) {
    await page.setViewportSize({ width, height })
    await preparePose(page, poses[0])
    const state = await snapshot(page)
    identity(state, result.mode)
    const view = page.getByRole('combobox', { name: '观察视角', exact: true })
    await expect(view).toBeVisible()
    await expect(view).toBeEnabled()
    await view.selectOption('front')
    await settle(page, true)
    const beforeZoom = await snapshot(page)
    const zoom = page.getByRole('button', { name: '放大', exact: true })
    await expect(zoom).toBeVisible()
    await expect(zoom).toBeEnabled()
    await zoom.click()
    await settle(page, true)
    const afterZoom = await snapshot(page)
    expect(difference(beforeZoom.camera.world, afterZoom.camera.world)).toBeGreaterThan(1e-6)
    result.checks.push(
      unchanged(
        beforeZoom,
        afterZoom,
        result.mode,
        width + 'x' + height + ' visible zoom control preserves shape',
        false,
      ),
    )
    await expect(page.getByRole('button', { name: '切换明亮环境', exact: true })).toBeVisible()
    const layout = await page.evaluate(() => ({
      width: innerWidth,
      height: innerHeight,
      overflow: document.documentElement.scrollWidth > innerWidth,
      canvases: document.querySelectorAll('canvas').length,
      controls: [
        ...document.querySelectorAll('.wb-camera-tools select, .wb-camera-tools button'),
      ].map((element) => {
        const box = element.getBoundingClientRect()
        return {
          label: element.getAttribute('aria-label') || element.textContent,
          left: box.left,
          right: box.right,
          top: box.top,
          bottom: box.bottom,
          disabled: element.disabled,
        }
      }),
    }))
    expect(layout.overflow).toBe(false)
    expect(layout.canvases).toBe(1)
    for (const control of layout.controls) {
      expect(control.disabled).toBe(false)
      expect(control.left).toBeGreaterThanOrEqual(-1)
      expect(control.right).toBeLessThanOrEqual(width + 1)
      expect(control.top).toBeGreaterThanOrEqual(-1)
      expect(control.bottom).toBeLessThanOrEqual(height + 1)
    }
    result.layouts.push(layout)
    await capture(page, result, 'layout-' + width + 'x' + height, afterZoom)
  }
  await page.setViewportSize(viewport)
}

function html(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

async function gallery() {
  const cards = [...poses, { id: 'wide-table' }]
    .map(
      (pose) =>
        '<section><h2>' +
        html(pose.id) +
        '</h2>' +
        (pose.id === 'wide-table'
          ? '<p>额外宽景观察：通过普通缩小与上仰操作查看完整桌体及落地关系，镜头不同，不计入冻结输入对照。</p>'
          : '') +
        '<div class="grid">' +
        report.cases
          .map((entry) => {
            const capture = entry.captures.find((item) => item.id === pose.id)
            return (
              '<article><h3>' +
              html(entry.mode) +
              '</h3>' +
              (capture
                ? '<a href="' +
                  entry.mode +
                  '/' +
                  capture.image +
                  '"><img loading="lazy" src="' +
                  entry.mode +
                  '/' +
                  capture.image +
                  '" alt="' +
                  html(entry.mode + ' ' + pose.id) +
                  '"></a><p><a href="' +
                  entry.mode +
                  '/' +
                  capture.metadata +
                  '">实际相机、姿态与标定</a></p>'
                : '<p>此模式未采集该取景。</p>') +
              '</article>'
            )
          })
          .join('') +
        '</div></section>',
    )
    .join('')
  const videos = report.cases
    .map(
      (entry) =>
        '<article><h3>' +
        html(entry.mode) +
        '</h3>' +
        (entry.video
          ? '<video controls preload="metadata" src="' +
            entry.mode +
            '/' +
            entry.video +
            '"></video>'
          : '<p>录像未完成。</p>') +
        '<p>实际观察到 ' +
        (entry.orbit?.movementFrames ?? 0) +
        ' 个相机变化帧；不是 GPU／屏幕计时。</p><a href="' +
        entry.mode +
        '/report.json">本模式报告</a></article>',
    )
    .join('')
  await writeFile(
    output + '/index.html',
    '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Trees X 空间模式对照</title><style>body{margin:32px;background:#171513;color:#eee9e2;font:16px system-ui}a{color:#e9be8d}h1{font-size:28px}h2{margin-top:48px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px}article{min-width:0;border:1px solid #4a4138;padding:12px}img,video{width:100%;height:auto}p{line-height:1.6}.notice{max-width:80ch;color:#f1cda5}</style><h1>Trees X 实际空间模式对照</h1><p class="notice">画质等待本人审阅。工程断言、相机变化帧与提交计数均不代表画质通过或 GPU／实际呈现预算通过。下图来自相同真实商品配置、默认外观、结构进度与实际取景；每张图保留完整元数据。后视使用既有转动命令产生 3.12 rad 旋转。</p><p><a href="report.json">完整报告</a></p>' +
      cards +
      '<section><h2>连续自由观察录像</h2><p>每段录像覆盖该模式完整检查，包含约 9 秒普通 store.orbit 命令的连续转动。</p><div class="grid">' +
      videos +
      '</div></section></html>',
  )
}

try {
  const response = await fetch(new URL('/api/v1/products/typewriter-study', base), {
    signal: AbortSignal.timeout(60000),
  })
  if (!response.ok) throw new Error('Real typewriter API unavailable: ' + response.status)
  product = await response.json()
  if (product.slug !== 'typewriter-study' || product.presentation.source?.kind !== 'glb')
    throw new Error('Real product GLB configuration unavailable')
  action = product.presentation.actions.find((entry) => entry.motion?.program)
  pulse = product.presentation.actions.find((entry) => entry.kind === 'pulse')
  if (!action || !pulse) throw new Error('Actual structure/strike configuration unavailable')
  for (const view of ['perspective', 'front', 'side', 'top', 'structure', 'knoll'])
    if (!product.presentation.views.some((entry) => entry.id === view))
      throw new Error('Real view missing: ' + view)
  bundle = JSON.parse(await readFile('src/lib/workbench/typewriterV2Bundle.json', 'utf8'))
  report.apiProductSha256 = digest(product)
  await writeFile(output + '/api-product.json', JSON.stringify(product, null, 2) + '\n')
  browser = await chromium.launch({ channel: 'msedge', headless: true })
  for (const mode of modes) {
    const directory = output + '/' + mode
    await mkdir(directory, { recursive: true })
    const result = {
      mode,
      passed: false,
      fixture: false,
      captures: [],
      checks: [],
      layouts: [],
      errors: [],
      failedRequests: [],
      requests: [],
      pending: ['Human image and video review', 'GPU/presentation budget'],
    }
    report.cases.push(result)
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: 1,
      recordVideo: { dir: directory, size: viewport },
    })
    const page = await context.newPage()
    const video = page.video()
    page.setDefaultTimeout(30000)
    page.on('pageerror', (error) =>
      result.errors.push({ kind: 'pageerror', message: error.message }),
    )
    page.on('console', (message) => {
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
    page.on('requestfailed', (request) =>
      result.failedRequests.push({ url: request.url(), reason: request.failure()?.errorText }),
    )
    page.on('response', (response) => {
      if (response.status() >= 400)
        result.errors.push({ kind: 'http', url: response.url(), status: response.status() })
    })
    try {
      const url = new URL(
        '/?product=typewriter-study&renderPipeline=realtime&studioMood=dark',
        base,
      )
      url.searchParams.set('loungeSpatial', projectionMode(mode))
      if (mode === 'depth-dof') url.searchParams.set('loungeDof', '1')
      if (mode === 'layers') url.searchParams.set('loungeLayers', '1')
      result.url = url.href
      await page.goto(url.href, { waitUntil: 'domcontentloaded' })
      await attach(page)
      await settle(page, true)
      result.initial = await snapshot(page)
      identity(result.initial, mode)
      await writeFile(
        directory + '/actual-presentation.json',
        JSON.stringify(result.initial.actualPresentation, null, 2) + '\n',
      )
      result.actualPresentationSha256 = digest(result.initial.actualPresentation)
      for (const item of poses.filter(
        (item) => mode !== 'depth-dof' || ['whole', 'paintclose', 'layers-0.6'].includes(item.id),
      )) {
        await preparePose(page, item)
        const state = await snapshot(page)
        identity(state, mode)
        expect(digest(state.actualPresentation)).toBe(result.actualPresentationSha256)
        const immutable = {
          presentation: state.actualPresentation,
          bundle: state.bundleSha256,
          finish: state.finish,
          materials: state.materials,
          poses: state.poses,
          motion: state.motion,
          actions: state.actions,
          selectedPart: state.selectedPart,
        }
        const inputHash = digest(immutable)
        const previous = baseline.get(item.id)
        if (previous) {
          expect(inputHash, mode + ' ' + item.id + ': same real product/finish/shape').toBe(
            previous.inputHash,
          )
          const cameraError = difference(Object.values(state.camera).flat(), previous.camera)
          expect(cameraError, mode + ' ' + item.id + ': same complete camera').toBeLessThanOrEqual(
            1e-6,
          )
          report.pairs.push({
            mode,
            pose: item.id,
            comparedWith: previous.mode,
            inputHash,
            cameraError,
          })
        } else
          baseline.set(item.id, { mode, inputHash, camera: Object.values(state.camera).flat() })
        await capture(page, result, item.id, state)
      }
      if (mode !== 'infinite') await captureWideTable(page, result)
      await checkMoodPreservation(page, result)
      await checkStrike(page, result)
      await recordOrbit(page, result)
      if (mode === 'depth') await checkLayouts(page, result)
      result.final = await snapshot(page)
      identity(result.final, mode)
      expect(result.requests.every((request) => new URL(request).origin === origin)).toBe(true)
      expect(result.errors).toEqual([])
      expect(result.failedRequests).toEqual([])
      result.passed = true
    } catch (error) {
      result.errors.push({ kind: 'test', message: error.stack || String(error) })
      process.exitCode = 1
      try {
        await page.screenshot({ path: directory + '/failure.png' })
      } catch {
        /* Host may be unavailable. */
      }
    } finally {
      await context.close()
      if (video) {
        try {
          await rename(await video.path(), directory + '/orbit.webm')
          result.video = 'orbit.webm'
        } catch (error) {
          result.errors.push({ kind: 'video', message: String(error) })
          result.passed = false
          process.exitCode = 1
        }
      }
      if (result.errors.length || result.failedRequests.length) result.passed = false
      await writeFile(directory + '/report.json', JSON.stringify(result, null, 2) + '\n')
    }
  }
  report.engineeringPassed =
    report.cases.length === modes.length && report.cases.every((entry) => entry.passed)
  report.passed = report.engineeringPassed
  if (!report.passed) process.exitCode = 1
} catch (error) {
  report.errors.push({ kind: 'test', message: error.stack || String(error) })
  process.exitCode = 1
} finally {
  await browser?.close()
  await writeFile(output + '/report.json', JSON.stringify(report, null, 2) + '\n')
  await gallery()
  console.log(
    JSON.stringify({
      engineeringPassed: report.engineeringPassed,
      visualAccepted: false,
      modes: report.cases.map((entry) => ({
        mode: entry.mode,
        passed: entry.passed,
        captures: entry.captures.length,
        movementFrames: entry.orbit?.movementFrames ?? 0,
      })),
      output,
      pending: report.pending,
    }),
  )
}

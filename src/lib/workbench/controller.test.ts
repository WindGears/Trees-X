// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { gsap } from 'gsap'
import { PerspectiveCamera, Scene, type WebGLRenderer } from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { createStageController } from './controller'
import { createSampleAdapter } from './adapter'
import { parseProduct } from './api'
import { loadAdapter } from './loadAdapter'
import type { WorkbenchProduct } from './types'

vi.mock('./loadAdapter', () => ({ loadAdapter: vi.fn() }))

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function loadedStage() {
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  const samples: WorkbenchProduct[] = JSON.parse(
    readFileSync('server/src/main/resources/samples/progress-products.json', 'utf8'),
  ).map(parseProduct)
  const product = samples[0]!,
    adapter = createSampleAdapter(product),
    select = vi.fn()
  adapter.select = select
  vi.mocked(loadAdapter).mockResolvedValueOnce(adapter)
  const added = vi.spyOn(OrbitControls.prototype, 'addEventListener'),
    canvas = document.createElement('canvas'),
    camera = new PerspectiveCamera(38, 1, 0.05, 250),
    interaction = vi.fn(),
    changed = vi.fn(),
    manual = vi.fn(),
    feedback = vi.fn()
  Object.assign(canvas, { setPointerCapture: vi.fn(), releasePointerCapture: vi.fn() })
  document.body.append(canvas)
  const controller = createStageController(
    { domElement: canvas } as unknown as WebGLRenderer,
    new Scene(),
    camera,
    vi.fn(),
    manual,
    vi.fn(),
    feedback,
    () => ({}),
    { interaction, changed },
  )
  const controls = added.mock.contexts.find((value) => value instanceof OrbitControls)
  if (!(controls instanceof OrbitControls)) throw new Error('Controls listener was not registered')
  await controller.load(product, vi.fn())
  controller.enableInteraction()
  return {
    controller,
    controls,
    camera,
    canvas,
    product,
    adapter,
    select,
    interaction,
    changed,
    manual,
    feedback,
    dispose() {
      controller.dispose()
      canvas.remove()
    },
  }
}

function hold(canvas: HTMLCanvasElement, pointerId = 17) {
  canvas.dispatchEvent(
    new PointerEvent('pointerdown', {
      pointerId,
      pointerType: 'mouse',
      button: 0,
      buttons: 1,
      clientX: 30,
      clientY: 30,
    }),
  )
}

it('requests numeric frames when OrbitControls changes at rest and unregisters the same listener', () => {
  const added = vi.spyOn(OrbitControls.prototype, 'addEventListener')
  const removed = vi.spyOn(OrbitControls.prototype, 'removeEventListener')
  const canvas = document.createElement('canvas')
  const camera = new PerspectiveCamera(38, 1, 0.05, 250)
  camera.position.set(3.5, 2.3, 5)
  let pendingFrames = 0
  const invalidate = vi.fn((frames = 1) => {
    pendingFrames = Math.min(60, pendingFrames + frames)
  })
  const controller = createStageController(
    { domElement: canvas } as unknown as WebGLRenderer,
    new Scene(),
    camera,
    invalidate,
    vi.fn(),
    vi.fn(),
  )
  const controls = added.mock.contexts.find((value) => value instanceof OrbitControls)
  if (!(controls instanceof OrbitControls)) throw new Error('Controls listener was not registered')
  const listener = added.mock.calls.find(([type]) => type === 'change')?.[1]
  controls.dispatchEvent({ type: 'change' })
  expect(invalidate).toHaveBeenLastCalledWith()
  expect(pendingFrames).toBe(1)
  pendingFrames = 0
  controls.dispatchEvent({ type: 'change' })
  expect(pendingFrames).toBe(1)
  controller.dispose()
  expect(removed.mock.calls.some(([type, fn]) => type === 'change' && fn === listener)).toBe(true)
  const calls = invalidate.mock.calls.length
  controls.dispatchEvent({ type: 'change' })
  expect(invalidate).toHaveBeenCalledTimes(calls)
})

it('cancels the actual captured pointer when switching products and accepts a fresh drag with the same ID', async () => {
  const item = await loadedStage()
  try {
    hold(item.canvas)
    expect(item.interaction.mock.calls).toEqual([[true]])
    item.controller.unload()
    expect(item.interaction.mock.calls).toEqual([[true], [false]])
    expect(item.canvas.releasePointerCapture).toHaveBeenCalledWith(17)
    const next = createSampleAdapter(item.product)
    vi.mocked(loadAdapter).mockResolvedValueOnce(next)
    await item.controller.load(item.product, vi.fn())
    item.controller.enableInteraction()
    hold(item.canvas)
    expect(item.interaction.mock.calls).toEqual([[true], [false], [true]])
    expect(item.manual).toHaveBeenCalledTimes(2)
    expect(item.controls.enabled).toBe(true)
  } finally {
    item.dispose()
  }
})

it('cancels captured input on hide and never resumes a paused action on reentry', async () => {
  const item = await loadedStage()
  try {
    hold(item.canvas)
    const action = item.product.presentation.actions.find((value) => value.kind === 'progress')!
    item.controller.motionCommand({ revision: 1, operation: 'play', id: action.id })
    const tween = gsap.globalTimeline
      .getChildren()
      .filter((value): value is gsap.core.Tween => 'targets' in value)
      .find((value) =>
        value
          .targets()
          .some(
            (target) =>
              typeof target === 'object' &&
              target !== null &&
              'playing' in target &&
              target.playing,
          ),
      )
    expect(tween).toBeDefined()
    tween!.progress(0.4)
    item.controller.setActive(false)
    const retained = item.adapter.pose[action.id]
    expect(retained).toBeGreaterThan(0)
    expect(item.interaction.mock.calls).toEqual([[true], [false]])
    expect(item.feedback.mock.calls.at(-1)?.[1]).toMatchObject({
      playing: false,
      progress: retained,
    })
    expect(item.controller.snapshotCamera()).toBeUndefined()
    expect(item.controller.snapshotCamera(true)).toBeDefined()
    item.controller.setActive(true)
    gsap.globalTimeline.time(gsap.globalTimeline.time() + 3, false)
    expect(item.adapter.pose[action.id]).toBe(retained)
    expect(item.feedback.mock.calls.at(-1)?.[1]).toMatchObject({
      playing: false,
      progress: retained,
    })
    hold(item.canvas)
    expect(item.interaction.mock.calls.at(-1)).toEqual([true])
  } finally {
    item.dispose()
  }
})

it('restores semantic selection without focusing, moving the camera or resuming actions', async () => {
  const item = await loadedStage()
  try {
    const hotspot = item.product.presentation.hotspots[0]!,
      position = item.camera.position.toArray(),
      target = item.controls.target.toArray(),
      tween = vi.spyOn(gsap, 'to')
    item.manual.mockClear()
    item.changed.mockClear()
    item.controller.restoreSelection(hotspot.id)
    expect(item.select).toHaveBeenLastCalledWith(hotspot.node)
    expect(item.changed.mock.calls).toEqual([['materials']])
    expect(item.camera.position.toArray()).toEqual(position)
    expect(item.controls.target.toArray()).toEqual(target)
    expect(tween).not.toHaveBeenCalled()
    expect(item.manual).not.toHaveBeenCalled()
    item.controller.restoreSelection()
    expect(item.select).toHaveBeenLastCalledWith(undefined)
    item.controller.restoreSelection('stale-hotspot')
    expect(item.select).toHaveBeenLastCalledWith(undefined)
  } finally {
    item.dispose()
  }
})

it('allows inactive device-checkpoint capture only for a loaded and ready product and returns detached arrays', async () => {
  const item = await loadedStage()
  try {
    item.controller.setActive(false)
    expect(item.controller.snapshotCamera()).toBeUndefined()
    const snapshot = item.controller.snapshotCamera(true)!
    expect(snapshot.position).toEqual(item.camera.position.toArray())
    expect(snapshot.target).toEqual(item.controls.target.toArray())
    snapshot.position[0] += 100
    snapshot.target[0] += 100
    expect(item.camera.position.x).not.toBe(snapshot.position[0])
    expect(item.controls.target.x).not.toBe(snapshot.target[0])
    item.controller.unload()
    expect(item.controller.snapshotCamera(true)).toBeUndefined()
  } finally {
    item.dispose()
  }
})

it('forwards seek/reset jumps from the real playback while retaining continuous action history', async () => {
  const item = await loadedStage(),
    tweens = vi.spyOn(gsap, 'to'),
    action = item.product.presentation.actions.find((value) => value.kind === 'progress')!
  try {
    item.changed.mockClear()
    item.controller.motionCommand({ revision: 1, operation: 'seek', id: action.id, value: 0.4 })
    expect(item.adapter.pose[action.id]).toBe(0.4)
    expect(item.changed.mock.calls).toEqual([['pose-jump']])
    item.controller.motionCommand({ revision: 2, operation: 'play', id: action.id, value: 1 })
    const tween = tweens.mock.results.at(-1)!.value as gsap.core.Tween
    item.changed.mockClear()
    tween.progress(0.5)
    tween.progress(1)
    expect(item.changed.mock.calls.length).toBeGreaterThan(1)
    expect(item.changed.mock.calls.every(([kind]) => kind === 'pose')).toBe(true)
    item.controller.resetMotion()
    expect(item.adapter.pose[action.id]).toBe(0)
    expect(item.changed.mock.calls.at(-1)).toEqual(['pose-jump'])
    item.changed.mockClear()
    item.controller.sync(item.product.presentation.finishes[0]!.id, true, {}, true)
    expect(item.changed.mock.calls.at(-1)).toEqual(['pose-jump'])
  } finally {
    item.dispose()
  }
})

it('distinguishes smooth view transitions from camera restores and reduced-motion jumps', async () => {
  const item = await loadedStage(),
    tweens = vi.spyOn(gsap, 'to'),
    view = item.product.presentation.views[0]!
  try {
    item.changed.mockClear()
    item.controller.command({ revision: 1, kind: 'view', id: view.id })
    const tween = tweens.mock.results.at(-1)!.value as gsap.core.Tween
    tween.progress(0.5)
    expect(item.changed.mock.calls).toContainEqual(['camera'])
    expect(item.changed.mock.calls).not.toContainEqual(['camera-cut'])
    item.changed.mockClear()
    item.controller.restoreCamera({ position: [4, 3, 5], target: [0, 0.5, 0] })
    item.camera.position.toArray().forEach((value, index) => {
      expect(value).toBeCloseTo([4, 3, 5][index]!, 12)
    })
    expect(item.changed.mock.calls.at(-1)).toEqual(['camera-cut'])
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    item.changed.mockClear()
    item.controller.command({ revision: 2, kind: 'view', id: view.id })
    expect(item.changed.mock.calls.at(-1)).toEqual(['camera-cut'])
    item.changed.mockClear()
    const action = item.product.presentation.actions.find((value) => value.kind === 'progress')!
    item.controller.motionCommand({ revision: 3, operation: 'play', id: action.id, value: 1 })
    expect(item.adapter.pose[action.id]).toBe(1)
    expect(item.changed.mock.calls).toEqual([['pose-jump']])
  } finally {
    item.dispose()
  }
})

it('does not emit late scene changes or load new resources after disposal', async () => {
  const item = await loadedStage()
  item.dispose()
  item.changed.mockClear()
  const loads = vi.mocked(loadAdapter).mock.calls.length
  item.controller.restoreCamera({ position: [5, 3, 2], target: [0, 0, 0] })
  item.controller.resetMotion()
  item.controller.setActive(true)
  item.controller.enableInteraction()
  await item.controller.load(item.product, vi.fn())
  expect(item.changed).not.toHaveBeenCalled()
  expect(vi.mocked(loadAdapter).mock.calls).toHaveLength(loads)
})

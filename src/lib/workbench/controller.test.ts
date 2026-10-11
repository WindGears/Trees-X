// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { PerspectiveCamera, Scene, type WebGLRenderer } from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { createStageController } from './controller'

afterEach(() => vi.restoreAllMocks())

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

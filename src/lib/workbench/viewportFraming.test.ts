import { afterEach, expect, test, vi } from 'vitest'
import { PerspectiveCamera } from 'three'
import { createViewportFraming } from './viewportFraming'

afterEach(() => vi.unstubAllGlobals())

test('floating panels change projection without changing observation pose or shrinking the product', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  const camera = new PerspectiveCamera(38, 1.44, 0.05, 250)
  camera.position.set(4, 3, 6)
  camera.lookAt(0, 1, 0)
  const position = camera.position.toArray(),
    rotation = camera.quaternion.toArray()
  const invalidate = vi.fn()
  const framing = createViewportFraming(invalidate)
  framing.update(camera, 1440, 1000, true, false, false)
  const fullZoom = camera.zoom
  framing.update(camera, 1440, 1000, true, true, false)
  expect(camera.view?.offsetX).toBeGreaterThan(0)
  expect(camera.zoom).toBe(fullZoom)
  expect(camera.position.toArray()).toEqual(position)
  expect(camera.quaternion.toArray()).toEqual(rotation)
  framing.update(camera, 1440, 1000, true, false, true)
  expect(camera.view?.offsetX).toBeLessThan(0)
  framing.update(camera, 1440, 1000, true, false, false)
  expect(camera.zoom).toBe(fullZoom)
  framing.dispose()
})

test('management projection keeps its original framing and invalid sizes cannot corrupt the camera', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  const camera = new PerspectiveCamera(),
    invalidate = vi.fn()
  const framing = createViewportFraming(invalidate)
  framing.update(camera, 1440, 924, false, false, false)
  expect(camera.view?.offsetX).toBe(0)
  expect(camera.view?.offsetY).toBe(28)
  const matrix = camera.projectionMatrix.toArray()
  framing.update(camera, 0, 0, true, true, false)
  expect(camera.projectionMatrix.toArray()).toEqual(matrix)
  expect(invalidate).toHaveBeenCalledTimes(1)
  framing.dispose()
})

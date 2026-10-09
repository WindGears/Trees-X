import { expect, test } from 'vitest'
import { createCameraCaptureSession, type CameraSnapshot } from './cameraCapture'
const snapshot = (): CameraSnapshot => ({
  slug: 'form-01',
  revision: 3,
  position: [1, 2, 3],
  target: [0, 1, 0],
})
test('capture is gated by current selection, readiness and visibility and returns detached numeric arrays', () => {
  const state = { slug: 'form-01', revision: 3, ready: false, active: true }
  const session = createCameraCaptureSession(() => state),
    original = snapshot()
  session.register(() => original)
  expect(session.capture()).toBeUndefined()
  state.ready = true
  const result = session.capture()!
  result.position[0] = 100
  expect(original.position[0]).toBe(1)
  state.active = false
  expect(session.capture()).toBeUndefined()
  state.active = true
  state.revision++
  expect(session.capture()).toBeUndefined()
})
test('old unregister and stale results cannot replace or clear a restored scene reader', () => {
  const state = { slug: 'form-01', revision: 3, ready: true, active: true }
  const session = createCameraCaptureSession(() => state),
    oldCleanup = session.register(snapshot)
  state.revision = 4
  const cleanup = session.register(() => ({ ...snapshot(), revision: 4 }))
  oldCleanup()
  expect(session.registered.value).toBe(true)
  expect(session.capture()?.revision).toBe(4)
  cleanup()
  expect(session.capture()).toBeUndefined()
  session.register(() => {
    state.revision++
    return snapshot()
  })
  expect(session.capture()).toBeUndefined()
  session.clear()
  expect(session.registered.value).toBe(false)
})

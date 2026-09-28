// @vitest-environment happy-dom
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { effectScope, ref } from 'vue'
import { createGestureBridge } from '@/lib/gesture/bridge'
import { useGestureSession } from './useGestureSession'
import { hand } from '@/lib/gesture/fixtures'

let scope = effectScope()
const stopTrack = vi.fn()
const track = { stop: stopTrack, addEventListener: vi.fn() }
const stream = { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream
let worker: FakeWorker
class FakeWorker {
  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror: (() => void) | null = null
  terminate = vi.fn()
  postMessage = vi.fn()
  constructor() {
    // Captures the test double created by the session.
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    worker = this
  }
  send(data: unknown) {
    this.onmessage?.({ data })
  }
}
beforeEach(() => {
  scope = effectScope()
  vi.useFakeTimers()
  stopTrack.mockClear()
  vi.stubGlobal('Worker', FakeWorker)
  vi.stubGlobal('isSecureContext', true)
  vi.stubGlobal('location', { href: 'http://localhost/' })
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
  })
})
afterEach(() => {
  scope.stop()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
function create() {
  const video = document.createElement('video')
  Object.defineProperty(video, 'srcObject', { configurable: true, writable: true, value: null })
  vi.spyOn(video, 'play').mockResolvedValue()
  const bridge = createGestureBridge(),
    active = ref(true)
  bridge.confirmation.value = 'pinch'
  const session = scope.run(() => useGestureSession(ref(video), active, bridge))!
  return { session, bridge, active, video }
}
it('confirms a moving fingertip and discards in-flight input after manual takeover', async () => {
  const { session, bridge, video } = create()
  const shell = document.createElement('div'),
    host = document.createElement('div')
  shell.className = 'viewer-shell'
  host.className = 'canvas-host'
  shell.append(host, video)
  vi.spyOn(host, 'getBoundingClientRect').mockReturnValue({ width: 1000, height: 600 } as DOMRect)
  bridge.hotspot.value = { x: 0.5, y: 0.5, visible: true }
  bridge.mode.value = 'select' // reset epoch 1; start resets again to epoch 2.
  await session.start()
  worker.send({ type: 'ready' })
  const send = (points: ReturnType<typeof hand>, time: number) =>
    worker.send({ type: 'result', points, time, epoch: 2, aspect: 4 / 3, inferenceMs: 5 })
  send(hand(), 0)
  send(hand(), 140)
  send(hand(0, true, 0.06), 210)
  send(hand(0, true, 0.15), 350)
  expect(bridge.phase.value).toBe('locked')
  send(hand(0, false, 0.15), 420)
  send(hand(0, false, 0.15), 490)
  expect(bridge.selected.value).toBe(true)
  bridge.selected.value = false
  send(hand(), 1400)
  send(hand(), 1540)
  send(hand(0, true), 1610)
  send(hand(0, true), 1750)
  bridge.takeMouse()
  send(hand(), 1820)
  send(hand(), 1890)
  expect(bridge.selected.value).toBe(false)
  expect(bridge.pointer.value).toBeNull()
})
it('does not request permission until explicit start, and releases the session', async () => {
  const { session, bridge } = create()
  expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled()
  await session.start()
  worker.send({ type: 'ready' })
  expect(bridge.owner.value).toBe('gesture')
  session.stop()
  expect(stopTrack).toHaveBeenCalledOnce()
  expect(worker.terminate).toHaveBeenCalledOnce()
  worker.send({ type: 'ready' })
  expect(session.status.value).toBe('off')
})
it('stops a camera that arrives after cancellation', async () => {
  let resolve!: (value: MediaStream) => void
  vi.mocked(navigator.mediaDevices.getUserMedia).mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done
      }),
  )
  const { session } = create()
  const pending = session.start()
  session.stop()
  resolve(stream)
  await pending
  expect(stopTrack).toHaveBeenCalledOnce()
  expect(session.status.value).toBe('off')
})
it('shows denied permission without breaking manual mode', async () => {
  vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValue(
    new DOMException('denied', 'NotAllowedError'),
  )
  const { session, bridge } = create()
  await session.start()
  expect(session.status.value).toBe('error')
  expect(session.message.value).toContain('权限')
  expect(bridge.owner.value).toBe('mouse')
})
it('releases resources on background and ignores late results', async () => {
  const { session, bridge } = create()
  await session.start()
  worker.send({ type: 'ready' })
  Object.defineProperty(document, 'hidden', { configurable: true, value: true })
  document.dispatchEvent(new Event('visibilitychange'))
  worker.send({ type: 'result', points: [], time: 10, inferenceMs: 1 })
  expect(stopTrack).toHaveBeenCalledOnce()
  expect(bridge.owner.value).toBe('mouse')
  expect(session.status.value).toBe('off')
  Object.defineProperty(document, 'hidden', { configurable: true, value: false })
})
it('allows only one in-flight frame and closes a bitmap resolved after stopping', async () => {
  const { session, video } = create()
  Object.defineProperty(video, 'readyState', { value: 4 })
  Object.defineProperty(video, 'currentTime', { configurable: true, value: 1 })
  let resolve!: (bitmap: ImageBitmap) => void
  const createBitmap = vi.fn(
    () =>
      new Promise<ImageBitmap>((done) => {
        resolve = done
      }),
  )
  vi.stubGlobal('createImageBitmap', createBitmap)
  await session.start()
  worker.send({ type: 'ready' })
  await vi.advanceTimersByTimeAsync(500)
  expect(createBitmap).toHaveBeenCalledOnce()
  session.stop()
  const close = vi.fn()
  resolve({ close } as unknown as ImageBitmap)
  await Promise.resolve()
  expect(close).toHaveBeenCalledOnce()
  expect(worker.postMessage.mock.calls.some(([data]) => data.type === 'frame')).toBe(false)
})

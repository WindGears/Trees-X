// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { effectScope, ref } from 'vue'
import { gsap } from 'gsap'
import { createGestureBridge } from '@/lib/gesture/bridge'
import { useGestureMotion } from './useGestureMotion'

const scopes: ReturnType<typeof effectScope>[] = []
afterEach(() => {
  for (const scope of scopes) scope.stop()
  scopes.length = 0
  vi.restoreAllMocks()
})
function setup() {
  const callbacks = new Set<gsap.TickerCallback>()
  vi.spyOn(gsap.ticker, 'add').mockImplementation((callback) => {
    callbacks.add(callback)
    return callback
  })
  vi.spyOn(gsap.ticker, 'remove').mockImplementation((callback) => {
    callbacks.delete(callback)
  })
  const bridge = createGestureBridge(),
    active = ref(true),
    reduced = ref(false),
    scope = effectScope()
  scopes.push(scope)
  bridge.rotate = vi.fn()
  scope.run(() => useGestureMotion(active, reduced, bridge))
  bridge.owner.value = 'gesture'
  let now = 0
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  const send = (time: number) => {
    now = time
    bridge.submitRotation({ time, velocity: 1, delta: 0.07, kind: 'moving' }, time)
  }
  const tick = (time: number) => {
    now = time
    for (const callback of callbacks) callback(time / 1000, 16, 1, 0)
  }
  return { bridge, active, reduced, scope, callbacks, send, tick }
}
it('uses one ticker and immediately cancels on all ownership/lifecycle changes', () => {
  const s = setup()
  s.send(0)
  s.tick(16)
  s.send(70)
  s.tick(86)
  expect(s.callbacks.size).toBe(1)
  expect(s.bridge.rotate).toHaveBeenCalled()
  for (const stop of [
    () => s.bridge.takeMouse(),
    () => {
      s.active.value = false
    },
    () => {
      s.bridge.mode.value = 'select'
    },
    () => {
      s.reduced.value = true
    },
  ]) {
    s.bridge.owner.value = 'gesture'
    s.active.value = true
    s.bridge.mode.value = 'rotate'
    s.reduced.value = false
    s.send(100)
    s.tick(116)
    stop()
    expect(s.callbacks.size).toBe(0)
    expect(s.bridge.motion.velocity).toBe(0)
  }
  s.scope.stop()
  expect(s.callbacks.size).toBe(0)
})
it('honors reduced motion with direct input and no inertia ticker', () => {
  const s = setup()
  s.reduced.value = true
  s.send(0)
  expect(s.bridge.rotate).toHaveBeenCalledWith(0.07)
  expect(s.callbacks.size).toBe(0)
  s.tick(100)
  expect(s.bridge.rotate).toHaveBeenCalledOnce()
})

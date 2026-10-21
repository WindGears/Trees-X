import { expect, it } from 'vitest'
import { uniform } from 'three/tsl'
import { createSsrRaySequence } from './ssrRaySequence'

it('decorrelates native rays and retries the same samples until a complete frame commits', () => {
  const first = { _noiseIndex: uniform(12) },
    second = { _noiseIndex: uniform(25) }
  const owner = createSsrRaySequence([first, second])
  const nativeDraw = () => {
    for (const effect of [first, second])
      effect._noiseIndex.value = (effect._noiseIndex.value + 1) % 0x7fffffff
    return [first._noiseIndex.value, second._noiseIndex.value]
  }
  owner.prepare()
  expect(nativeDraw()).toEqual([0, 104729])
  owner.cancelFrame()
  owner.prepare()
  expect(nativeDraw()).toEqual([0, 104729])
  owner.commitFrame()
  owner.prepare()
  expect(nativeDraw()).toEqual([1, 104730])
  expect(owner.snapshot().frames).toBe(1)
  owner.commitFrame()
  owner.dispose()
  owner.dispose()
  expect([first._noiseIndex.value, second._noiseIndex.value]).toEqual([12, 25])
  expect(() => owner.prepare()).toThrow('disposed')
})

it('rejects duplicate ownership, aliased effects/uniforms, revision and malformed seams', () => {
  const first = { _noiseIndex: uniform(0) },
    second = { _noiseIndex: uniform(0) }
  expect(() => createSsrRaySequence([first, first])).toThrow('distinct')
  expect(() => createSsrRaySequence([first, { _noiseIndex: first._noiseIndex }])).toThrow('shared')
  expect(() => createSsrRaySequence([first, {}])).toThrow('contract')
  expect(() => createSsrRaySequence([first, second], '186')).toThrow('r185')
  const owner = createSsrRaySequence([first, second])
  expect(() => createSsrRaySequence([first, second])).toThrow('owned')
  expect(() => owner.commitFrame()).toThrow('prepared')
  owner.dispose()
  createSsrRaySequence([first, second]).dispose()
})

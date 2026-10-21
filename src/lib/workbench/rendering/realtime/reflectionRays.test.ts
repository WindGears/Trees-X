import { afterEach, expect, it, vi } from 'vitest'
import { DataTexture, PerspectiveCamera } from 'three'
import SSRNode from 'three/addons/tsl/display/SSRNode.js'
import { texture, vec3, float } from 'three/tsl'
import { createReflectionRays } from './reflectionRays'

const factory = vi.hoisted(() => ({ calls: 0, malformedAt: 0 }))
vi.mock('three/addons/tsl/display/SSRNode.js', async (original) => {
  const module = await original<typeof import('three/addons/tsl/display/SSRNode.js')>()
  return {
    ...module,
    ssr: (...args: Parameters<typeof module.ssr>) => {
      const effect = module.ssr(...args)
      if (++factory.calls === factory.malformedAt) Reflect.set(effect, '_noiseIndex', null)
      return effect
    },
  }
})
afterEach(() => {
  factory.calls = 0
  factory.malformedAt = 0
  vi.restoreAllMocks()
})
function inputs() {
  const map = texture(new DataTexture())
  return {
    beauty: map,
    depth: map,
    normal: vec3(0, 0, 1),
    roughness: float(0.2),
    albedo: map,
    nativeSingle: map,
    camera: new PerspectiveCamera(),
  }
}

it('owns distinct native SSR targets while sharing the existing G-buffer inputs', () => {
  const dispose = vi.spyOn(SSRNode.prototype, 'dispose'),
    owner = createReflectionRays(inputs(), 2, true)
  expect(owner.textures).toHaveLength(2)
  expect(owner.textures[0]?.value).not.toBe(owner.textures[1]?.value)
  owner.prepare()
  owner.cancelFrame()
  expect(owner.snapshot().frames).toBe(0)
  owner.prepare()
  owner.commitFrame()
  expect(owner.snapshot()).toMatchObject({
    requested: 2,
    actual: 2,
    frames: 1,
    seeds: [0, 104729],
    error: null,
  })
  owner.dispose()
  owner.dispose()
  expect(dispose).toHaveBeenCalledTimes(2)
})

it('releases partial enhancements before reporting a usable single-ray fallback', () => {
  factory.malformedAt = 2
  const dispose = vi.spyOn(SSRNode.prototype, 'dispose'),
    owner = createReflectionRays(inputs(), 2, true)
  expect(dispose).toHaveBeenCalledTimes(2)
  expect(owner.snapshot()).toMatchObject({ requested: 2, actual: 1 })
  expect(owner.snapshot().error).toContain('noise contract')
  owner.prepare()
  owner.commitFrame()
  expect(owner.snapshot().frames).toBe(1)
  owner.dispose()
  expect(dispose).toHaveBeenCalledTimes(3)
})

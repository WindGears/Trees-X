import { execFileSync } from 'node:child_process'
import { it, expect, vi } from 'vitest'
import { DataTexture, PerspectiveCamera } from 'three'
import { float, sample, texture, vec3, vec4 } from 'three/tsl'
import { createReflectionRays } from '../reflectionRays'
import { createWorldReflectionFactory } from './factory'

it('matches the pinned upstream sources and reproducible reviewed patches', () => {
  const result = execFileSync(process.execPath, ['scripts/car-world-ssr-source.mjs', '--check'], {
    encoding: 'utf8',
    windowsHide: true,
  })
  expect(result).toContain('matches pinned upstream')
})

it('uses the existing two-ray clock/classification and never releases borrowed inputs', () => {
  const image = new DataTexture(),
    map = texture(image)
  const dispose = vi.spyOn(image, 'dispose')
  const factory = createWorldReflectionFactory(() => vec4(0))
  const effects: ReturnType<typeof factory>[] = []
  const owner = createReflectionRays(
    {
      beauty: map,
      depth: map,
      normal: sample(() => vec3(0, 1, 0)),
      roughness: float(0.2),
      albedo: map,
      nativeSingle: map,
      camera: new PerspectiveCamera(),
    },
    2,
    true,
    {
      factory: (...args) => {
        const effect = factory(...args)
        effects.push(effect)
        return effect
      },
    },
  )
  const targetDisposals = effects.map((effect) => vi.spyOn(effect.getRenderTarget(), 'dispose'))
  owner.prepare()
  owner.cancelFrame()
  expect(owner.snapshot().frames).toBe(0)
  owner.prepare()
  owner.commitFrame()
  expect(owner.snapshot()).toMatchObject({ actual: 2, frames: 1, error: null, seeds: [0, 104729] })
  owner.dispose()
  owner.dispose()
  targetDisposals.forEach((spy) => expect(spy).toHaveBeenCalledTimes(1))
  expect(dispose).not.toHaveBeenCalled()
  image.dispose()
})

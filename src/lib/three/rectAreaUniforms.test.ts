import { describe, expect, it, vi } from 'vitest'
import { Texture, UniformsLib } from 'three'
import { acquireRectAreaUniforms } from './rectAreaUniforms'

const textures = () => {
  const library = UniformsLib as unknown as Record<string, unknown>
  return ['LTC_FLOAT_1', 'LTC_FLOAT_2', 'LTC_HALF_1', 'LTC_HALF_2'].map((name) => {
    const value = library[name]
    if (!(value instanceof Texture)) throw new Error('Missing actual area-light texture')
    return value
  })
}

describe('area-light library ownership', () => {
  it('keeps native LTC textures shared across studios, releases the last owner once, and reloads independently', () => {
    const first = acquireRectAreaUniforms(),
      original = textures(),
      disposal = original.map((texture) => vi.spyOn(texture, 'dispose')),
      second = acquireRectAreaUniforms()
    try {
      expect(textures()).toEqual(original)
      first()
      first()
      disposal.forEach((spy) => expect(spy).not.toHaveBeenCalled())
      expect(textures()).toEqual(original)
      second()
      second()
      disposal.forEach((spy) => expect(spy).toHaveBeenCalledTimes(1))
      const next = acquireRectAreaUniforms()
      try {
        const reloaded = textures()
        expect(reloaded.every((texture) => !original.includes(texture))).toBe(true)
        expect(reloaded.map((texture) => [texture.image.width, texture.image.height])).toEqual(
          Array.from({ length: 4 }, () => [64, 64]),
        )
      } finally {
        next()
      }
      disposal.forEach((spy) => expect(spy).toHaveBeenCalledTimes(1))
    } finally {
      first()
      second()
    }
  })
})

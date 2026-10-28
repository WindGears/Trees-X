import { FramebufferTexture } from 'three'
import { describe, expect, it, vi } from 'vitest'
import { createReflectionViewportScope } from './reflectionViewport'

describe('reflection native transmission viewport isolation', () => {
  it('keeps beauty and reflection sizes independent after resize without reallocating each copy', () => {
    const beauty = new FramebufferTexture(1440, 1000),
      reflection = beauty.clone(),
      source = beauty.source,
      scope = createReflectionViewportScope(),
      copy = vi.fn(),
      renderer = { copyFramebufferToTexture: copy },
      dispose = vi.spyOn(reflection, 'dispose')
    expect(reflection.source).toBe(source)
    scope.run(renderer, () => renderer.copyFramebufferToTexture(reflection))
    const version = reflection.version
    beauty.image.width = 1920
    beauty.image.height = 1080
    expect(reflection.image).toEqual({ width: 1440, height: 1000 })
    reflection.image.width = 1920
    reflection.image.height = 1080
    reflection.needsUpdate = true
    scope.run(renderer, () => renderer.copyFramebufferToTexture(reflection))
    expect(reflection.version).toBe(version + 1)
    expect(renderer.copyFramebufferToTexture).toBe(copy)
    scope.dispose()
    scope.dispose()
    expect(reflection.source).toBe(source)
    expect(dispose).not.toHaveBeenCalled()
    expect(() => scope.run(renderer, () => undefined)).toThrow('unavailable')
  })

  it('restores the method on failure and preserves another owner on cleanup', () => {
    const texture = new FramebufferTexture(2, 2),
      replacement = new FramebufferTexture(3, 3).source,
      scope = createReflectionViewportScope(),
      copy = vi.fn<(texture: FramebufferTexture) => void>(() => {
        throw new Error('copy failed')
      }),
      renderer = { copyFramebufferToTexture: copy }
    expect(() => scope.run(renderer, () => renderer.copyFramebufferToTexture(texture))).toThrow(
      'copy failed',
    )
    expect(renderer.copyFramebufferToTexture).toBe(copy)
    texture.source = replacement
    scope.dispose()
    expect(texture.source).toBe(replacement)
    expect(() => createReflectionViewportScope('186')).toThrow('reviewed r185')
  })

  it('drops disposed borrowed textures and rejects nested capture', () => {
    const texture = new FramebufferTexture(2, 2),
      scope = createReflectionViewportScope(),
      renderer = { copyFramebufferToTexture: vi.fn() }
    scope.run(renderer, () => renderer.copyFramebufferToTexture(texture))
    texture.dispose()
    const source = texture.source
    expect(() => scope.run(renderer, () => scope.run(renderer, () => undefined))).toThrow(
      'unavailable',
    )
    scope.dispose()
    expect(texture.source).toBe(source)
  })
})

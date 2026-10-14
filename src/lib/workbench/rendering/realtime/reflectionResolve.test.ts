import { describe, expect, it, vi } from 'vitest'
import { PerspectiveCamera, Texture } from 'three'
import { texture } from 'three/tsl'
import type { WebGPURenderer } from 'three/webgpu'
import { createReflectionResolve } from './reflectionResolve'

const factories = vi.hoisted(() => ({ spatial: vi.fn(), history: vi.fn() }))
vi.mock('./signedSpatial', () => ({ createSignedReflectionSpatial: factories.spatial }))
vi.mock('./signedHistory', () => ({ createSignedReflectionHistory: factories.history }))

describe('reflection resolver construction rollback', () => {
  it('releases the completed spatial owner when history initialization rejects', () => {
    const source = new Texture(),
      node = texture(source),
      dispose = vi.fn(),
      sourceDispose = vi.spyOn(source, 'dispose')
    factories.spatial.mockReturnValue({ raw: node, node, dispose })
    factories.history.mockImplementation(() => {
      throw new Error('native depth rejected')
    })
    expect(() =>
      createReflectionResolve(
        {} as WebGPURenderer,
        node,
        node,
        node,
        node,
        node,
        new PerspectiveCamera(),
      ),
    ).toThrow('native depth rejected')
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(sourceDispose).not.toHaveBeenCalled()
    source.dispose()
  })
})

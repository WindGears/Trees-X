import { BoxGeometry, Mesh, MeshPhysicalMaterial, Texture } from 'three'
import {
  EnvironmentNode,
  PMREMGenerator,
  PMREMNode,
  RenderTarget,
  type WebGPURenderer,
} from 'three/webgpu'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ownEnvironmentPmrem } from './environmentPMREM'

function nativeCache(renderer: WebGPURenderer) {
  const method: unknown = Reflect.get(EnvironmentNode.prototype, '_getPMREMNodeCache')
  if (typeof method !== 'function') throw new Error('Expected native r185 cache method')
  const cache: unknown = Reflect.apply(method, new EnvironmentNode(), [renderer])
  if (!(cache instanceof WeakMap)) throw new Error('Expected native r185 cache')
  return cache as WeakMap<Texture, unknown>
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.doUnmock('three')
  vi.resetModules()
})

describe('owned WebGPU environment PMREM bridge', () => {
  it('releases native output once before the cached generator and removes its cache entry', () => {
    const renderer = {} as WebGPURenderer,
      texture = new Texture(),
      output = new RenderTarget(),
      pingPong = new RenderTarget(),
      geometry = new BoxGeometry(),
      blurMaterial = new MeshPhysicalMaterial(),
      sourceGeometry = new BoxGeometry(),
      sourceMaterial = new MeshPhysicalMaterial(),
      sourceMap = new Texture()
    sourceMaterial.map = sourceMap
    const order: string[] = [],
      outputDispose = vi.fn(() => order.push('output')),
      geometryDispose = vi.fn(),
      materialDispose = vi.fn(),
      pingPongDispose = vi.fn(() => order.push('ping-pong')),
      sourceGeometryDispose = vi.fn(),
      sourceMaterialDispose = vi.fn(),
      sourceMapDispose = vi.fn()
    output.addEventListener('dispose', outputDispose)
    geometry.addEventListener('dispose', geometryDispose)
    blurMaterial.addEventListener('dispose', materialDispose)
    pingPong.addEventListener('dispose', pingPongDispose)
    sourceGeometry.addEventListener('dispose', sourceGeometryDispose)
    sourceMaterial.addEventListener('dispose', sourceMaterialDispose)
    sourceMap.addEventListener('dispose', sourceMapDispose)
    // This is the same ownership split as native _getPMREMFromTexture(): the
    // source dispose listener owns output, while PMREMNode owns generator.
    texture.addEventListener('dispose', () => output.dispose())
    const owner = ownEnvironmentPmrem(renderer, texture)
    const node = new PMREMNode(texture),
      generator = new PMREMGenerator(renderer)
    Reflect.set(generator, '_lodMeshes', [new Mesh(geometry)])
    Reflect.set(generator, '_blurMaterial', blurMaterial)
    Reflect.set(generator, '_pingPongRenderTarget', pingPong)
    Reflect.set(node, '_generator', generator)
    node.addEventListener('dispose', () => order.push('node'))
    // Registration can occur after ownership is created, as in native setup().
    nativeCache(renderer).set(texture, node)
    owner.dispose()
    owner.dispose()
    expect(owner.texture).toBe(texture)
    expect(outputDispose).toHaveBeenCalledTimes(1)
    expect(geometryDispose).toHaveBeenCalledTimes(1)
    expect(materialDispose).toHaveBeenCalledTimes(1)
    expect(pingPongDispose).toHaveBeenCalledTimes(1)
    expect(order).toEqual(['output', 'node', 'ping-pong'])
    expect(nativeCache(renderer).has(texture)).toBe(false)
    expect(sourceGeometryDispose).not.toHaveBeenCalled()
    expect(sourceMaterialDispose).not.toHaveBeenCalled()
    expect(sourceMapDispose).not.toHaveBeenCalled()
    sourceGeometry.dispose()
    sourceMaterial.dispose()
    sourceMap.dispose()
  })

  it('releases a canceled or unrendered texture without requiring a prepared PMREM', () => {
    const renderer = {} as WebGPURenderer,
      texture = new Texture(),
      textureDispose = vi.fn()
    texture.addEventListener('dispose', textureDispose)
    const owner = ownEnvironmentPmrem(renderer, texture)
    owner.dispose()
    owner.dispose()
    expect(textureDispose).toHaveBeenCalledTimes(1)
    expect(nativeCache(renderer).has(texture)).toBe(false)
  })

  it('cleans the generator and cache even if a texture dispose listener throws', () => {
    const renderer = {} as WebGPURenderer,
      texture = new Texture(),
      node = new PMREMNode(texture),
      generatorDispose = vi.fn()
    Reflect.set(node, '_generator', { dispose: generatorDispose })
    nativeCache(renderer).set(texture, node)
    texture.addEventListener('dispose', () => {
      throw new Error('Injected texture listener error')
    })
    const owner = ownEnvironmentPmrem(renderer, texture)
    expect(() => owner.dispose()).toThrow('Injected texture listener error')
    expect(generatorDispose).toHaveBeenCalledTimes(1)
    expect(nativeCache(renderer).has(texture)).toBe(false)
    expect(() => owner.dispose()).not.toThrow()
  })

  it('rejects an unexpected cached node while still releasing texture and deleting the entry', () => {
    const renderer = {} as WebGPURenderer,
      texture = new Texture(),
      textureDispose = vi.fn(),
      unknownDispose = vi.fn()
    texture.addEventListener('dispose', textureDispose)
    const owner = ownEnvironmentPmrem(renderer, texture)
    nativeCache(renderer).set(texture, { dispose: unknownDispose })
    expect(() => owner.dispose()).toThrow('受检 PMREMNode')
    expect(textureDispose).toHaveBeenCalledTimes(1)
    expect(unknownDispose).not.toHaveBeenCalled()
    expect(nativeCache(renderer).has(texture)).toBe(false)
  })

  it('checks the private cache method and return shape before borrowing them', () => {
    const renderer = {} as WebGPURenderer,
      texture = new Texture()
    const prototype = EnvironmentNode.prototype as unknown as {
      _getPMREMNodeCache(renderer: WebGPURenderer): unknown
    }
    vi.spyOn(prototype, '_getPMREMNodeCache').mockReturnValue(new Map())
    expect(() => ownEnvironmentPmrem(renderer, texture)).toThrow('缓存形状不兼容')
    texture.dispose()
  })

  it('rejects unchecked Three revisions before touching the private renderer cache', async () => {
    vi.doMock('three', () => ({ REVISION: '184' }))
    const checked = await import('./environmentPMREM')
    const texture = new Texture(),
      renderer = {} as WebGPURenderer
    expect(() => checked.ownEnvironmentPmrem(renderer, texture)).toThrow('Three r185')
    texture.dispose()
  })
})

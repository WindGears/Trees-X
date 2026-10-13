import { BoxGeometry, Color, Group, Mesh, MeshPhysicalMaterial, Texture } from 'three'
import { MeshPhysicalNodeMaterial, PhysicalLightingModel } from 'three/webgpu'
import { describe, expect, it, vi } from 'vitest'
import { createRealtimeMaterials, realtimeMaterialSupported } from './materials'

describe('realtime Physical signal bridge', () => {
  it('borrows shared maps and restores source identity without disposing loader assets', () => {
    const source = new MeshPhysicalMaterial({ clearcoat: 0.8 })
    const texture = new Texture()
    source.normalMap = texture
    const sourceDispose = vi.fn(),
      textureDispose = vi.fn()
    source.addEventListener('dispose', sourceDispose)
    texture.addEventListener('dispose', textureDispose)
    const geometry = new BoxGeometry(),
      root = new Group()
    const first = new Mesh(geometry, source),
      second = new Mesh(geometry, source)
    root.add(first, second)
    const prototype = PhysicalLightingModel.prototype.indirectSpecular
    const bridge = createRealtimeMaterials(root)
    expect(bridge.count).toBe(1)
    expect(first.material).toBe(second.material)
    expect(first.material).toBeInstanceOf(MeshPhysicalNodeMaterial)
    expect((first.material as unknown as MeshPhysicalNodeMaterial).normalMap).toBe(texture)
    expect((first.material as unknown as MeshPhysicalNodeMaterial).clearcoat).toBe(0.8)
    expect(PhysicalLightingModel.prototype.indirectSpecular).toBe(prototype)
    const runtimeDispose = vi.fn()
    first.material.addEventListener('dispose', runtimeDispose)
    bridge.dispose()
    bridge.dispose()
    expect(runtimeDispose).toHaveBeenCalledTimes(1)
    expect(sourceDispose).not.toHaveBeenCalled()
    expect(textureDispose).not.toHaveBeenCalled()
    expect(first.material).toBe(source)
    expect(second.material).toBe(source)
    source.dispose()
    texture.dispose()
    geometry.dispose()
  })

  it('reflects appearance and map updates while source and runtime remain independent', () => {
    const source = new MeshPhysicalMaterial({ clearcoat: 0.4, color: '#202020' })
    const geometry = new BoxGeometry(),
      root = new Group(),
      mesh = new Mesh(geometry, source)
    root.add(mesh)
    const bridge = createRealtimeMaterials(root)
    const runtime = mesh.material as unknown as MeshPhysicalNodeMaterial
    const originalVersion = runtime.version
    expect(bridge.sync()).toBe(false)
    source.color.set('#bbaa44')
    source.normalScale.set(0.2, 0.3)
    source.roughness = 0.31
    expect(bridge.sync()).toBe(true)
    expect(runtime.color.equals(new Color('#bbaa44'))).toBe(true)
    expect(runtime.color).not.toBe(source.color)
    expect(runtime.normalScale).not.toBe(source.normalScale)
    expect(runtime.normalScale.equals(source.normalScale)).toBe(true)
    expect(runtime.roughness).toBe(0.31)
    expect(runtime.version).toBe(originalVersion)
    const texture = new Texture()
    source.normalMap = texture
    expect(bridge.sync()).toBe(true)
    expect(runtime.normalMap).toBe(texture)
    expect(runtime.version).toBeGreaterThan(originalVersion)
    expect(bridge.sync()).toBe(false)
    bridge.dispose()
    expect(bridge.sync()).toBe(false)
    source.dispose()
    texture.dispose()
    geometry.dispose()
  })

  it('keeps anisotropy, transmission and transparent surfaces on their full native branch', () => {
    const root = new Group(),
      geometry = new BoxGeometry()
    const sources = [
      new MeshPhysicalMaterial({ anisotropy: 0.22 }),
      new MeshPhysicalMaterial({ transmission: 0.85 }),
      new MeshPhysicalMaterial({ transparent: true, opacity: 0.7 }),
      new MeshPhysicalMaterial({ sheen: 0.1 }),
      new MeshPhysicalMaterial({ iridescence: 0.1 }),
      new MeshPhysicalMaterial({ ior: 1.8 }),
      new MeshPhysicalMaterial({ specularColor: '#8899aa' }),
      new MeshPhysicalMaterial({ specularIntensity: 0.6 }),
      new MeshPhysicalMaterial({ specularIntensityMap: new Texture() }),
      new MeshPhysicalMaterial({ specularColorMap: new Texture() }),
      new MeshPhysicalMaterial({ envMap: new Texture() }),
    ]
    const meshes = sources.map((source) => new Mesh(geometry, source))
    root.add(...meshes)
    const bridge = createRealtimeMaterials(root)
    expect(bridge.count).toBe(0)
    sources.forEach((source, index) => {
      expect(realtimeMaterialSupported(source)).toBe(false)
      expect(meshes[index]!.material).toBe(source)
    })
    bridge.dispose()
    sources.forEach((source) => {
      source.specularIntensityMap?.dispose()
      source.specularColorMap?.dispose()
      source.envMap?.dispose()
      source.dispose()
    })
    geometry.dispose()
  })

  it('protects known transparent decal holes without changing native BRDF or source assets', () => {
    const texture = new Texture(),
      alphaMap = new Texture(),
      source = new MeshPhysicalMaterial({
        name: 'decal-6',
        map: texture,
        alphaMap,
        transparent: true,
        depthWrite: false,
        clearcoat: 0.28,
        roughness: 0.6,
      })
    const sourceVersion = source.version,
      sourceDispose = vi.fn(),
      textureDispose = vi.fn(),
      alphaDispose = vi.fn(),
      geometryDispose = vi.fn()
    source.addEventListener('dispose', sourceDispose)
    texture.addEventListener('dispose', textureDispose)
    alphaMap.addEventListener('dispose', alphaDispose)
    const geometry = new BoxGeometry(),
      root = new Group(),
      first = new Mesh(geometry, source),
      second = new Mesh(geometry, source)
    geometry.addEventListener('dispose', geometryDispose)
    root.add(first, second)
    const bridge = createRealtimeMaterials(root)
    const runtime = first.material as unknown as MeshPhysicalNodeMaterial
    const runtimeDispose = vi.fn()
    runtime.addEventListener('dispose', runtimeDispose)
    expect(second.material).toBe(runtime)
    expect(runtime).not.toBe(source)
    expect(runtime.map).toBe(texture)
    expect(runtime.alphaMap).toBe(alphaMap)
    expect(runtime.transparent).toBe(true)
    expect(runtime.depthWrite).toBe(false)
    expect(runtime.alphaTest).toBe(1 / 255)
    expect(source.alphaTest).toBe(0)
    expect(source.version).toBe(sourceVersion)
    expect(runtime.setupLightingModel().constructor).toBe(PhysicalLightingModel)
    expect(runtime.useClearcoat).toBe(true)
    expect(realtimeMaterialSupported(source)).toBe(false)
    expect(bridge.stats()).toMatchObject({
      supported: 0,
      runtime: 1,
      nativeTransparent: 1,
      protectedDecals: 1,
    })
    expect(bridge.sync()).toBe(false)
    source.alphaTest = 0.15
    expect(bridge.sync()).toBe(true)
    expect(runtime.alphaTest).toBe(0.15)
    source.alphaTest = 0
    source.opacity = 0.7
    expect(bridge.sync()).toBe(true)
    expect(runtime.alphaTest).toBe(1 / 255)
    expect(runtime.opacity).toBe(0.7)
    expect(source.alphaTest).toBe(0)
    bridge.restore()
    bridge.dispose()
    expect(first.material).toBe(source)
    expect(second.material).toBe(source)
    expect(runtimeDispose).toHaveBeenCalledTimes(1)
    expect(sourceDispose).not.toHaveBeenCalled()
    expect(textureDispose).not.toHaveBeenCalled()
    expect(alphaDispose).not.toHaveBeenCalled()
    expect(geometryDispose).not.toHaveBeenCalled()
    source.dispose()
    texture.dispose()
    alphaMap.dispose()
    geometry.dispose()
  })

  it('does not add an alpha cutoff to unknown glass or unnamed transparent assets', () => {
    const texture = new Texture(),
      geometry = new BoxGeometry(),
      root = new Group()
    const sources = ['glass', 'decal-999', 'decal-6'].map(
      (name) => new MeshPhysicalMaterial({ name, map: texture, transparent: true }),
    )
    // A known name without its textured alpha channel is not a recovered decal.
    sources[2]!.map = null
    const meshes = sources.map((source) => new Mesh(geometry, source))
    root.add(...meshes)
    const bridge = createRealtimeMaterials(root)
    expect(bridge.count).toBe(0)
    meshes.forEach((mesh, index) => expect(mesh.material).toBe(sources[index]))
    sources.forEach((source) => expect(source.alphaTest).toBe(0))
    bridge.dispose()
    sources.forEach((source) => source.dispose())
    texture.dispose()
    geometry.dispose()
  })

  it('does not overwrite a material subsequently replaced by the model owner', () => {
    const source = new MeshPhysicalMaterial(),
      replacement = new MeshPhysicalMaterial()
    const geometry = new BoxGeometry(),
      root = new Group(),
      mesh = new Mesh(geometry, source)
    root.add(mesh)
    const bridge = createRealtimeMaterials(root)
    mesh.material = replacement
    bridge.dispose()
    expect(mesh.material).toBe(replacement)
    source.dispose()
    replacement.dispose()
    geometry.dispose()
  })

  it('reinstalls after product changes without retaining or disposing old source assets', () => {
    const source = new MeshPhysicalMaterial(),
      next = new MeshPhysicalMaterial()
    const geometry = new BoxGeometry(),
      root = new Group(),
      mesh = new Mesh(geometry, [source, source])
    const original = mesh.material
    const sourceDispose = vi.fn()
    source.addEventListener('dispose', sourceDispose)
    root.add(mesh)
    const bridge = createRealtimeMaterials()
    bridge.install(root)
    expect(bridge.count).toBe(1)
    const runtime = mesh.material
    expect(runtime).not.toBe(original)
    expect(runtime[0]).toBe(runtime[1])
    const runtimeDispose = vi.fn()
    runtime[0]!.addEventListener('dispose', runtimeDispose)
    bridge.restore()
    expect(mesh.material).toBe(original)
    expect(bridge.stats().runtime).toBe(0)
    expect(runtimeDispose).toHaveBeenCalledTimes(1)
    mesh.material = [next]
    bridge.install(root)
    expect(bridge.count).toBe(1)
    bridge.dispose()
    bridge.install(root)
    expect(bridge.count).toBe(0)
    expect(mesh.material[0]).toBe(next)
    expect(sourceDispose).not.toHaveBeenCalled()
    source.dispose()
    next.dispose()
    geometry.dispose()
  })
})

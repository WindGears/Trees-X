import { BoxGeometry, Color, Group, Mesh, MeshPhysicalMaterial, Texture } from 'three'
import {
  MeshPhysicalNodeMaterial,
  Node,
  PhysicalLightingModel,
  type NodeBuilder,
} from 'three/webgpu'
import {
  diffuseColor,
  getCurrentStack,
  metalness,
  setCurrentStack,
  specularColor,
  specularF90,
  stack,
  uniform,
  vec3,
} from 'three/tsl'
import { describe, expect, it, vi } from 'vitest'
import { createRealtimeMaterials, realtimeMaterialSupported } from './materials'

describe('realtime Physical signal bridge', () => {
  it.each([0, 0.8])(
    'constructs the bundled TSL finish graph with native dielectric response and source AO at clearcoat %s',
    (clearcoat) => {
      const source = new MeshPhysicalMaterial({ clearcoat }),
        geometry = new BoxGeometry(),
        root = new Group(),
        mesh = new Mesh(geometry, source)
      root.add(mesh)
      const bridge = createRealtimeMaterials(root),
        runtime = mesh.material as unknown as MeshPhysicalNodeMaterial,
        model = runtime.setupLightingModel(),
        previousStack = getCurrentStack(),
        flow = stack(),
        sourceAo = uniform(0.37)
      if (!(model instanceof PhysicalLightingModel)) throw new Error('Expected physical lighting')
      const multiscattering = vi.spyOn(model, 'computeMultiscattering')
      try {
        setCurrentStack(flow)
        model.clearcoatSpecularDirect = vec3(0)
        model.clearcoatSpecularIndirect = vec3(0)
        const builder = {
          context: {
            radiance: vec3(1),
            ambientOcclusion: sourceAo,
            reflectedLight: { indirectDiffuse: vec3(0.25), indirectSpecular: vec3(0.4) },
            outgoingLight: vec3(1).toVar(),
          },
        } as unknown as NodeBuilder
        // Construct the actual production nodes without compiling or executing
        // shaders. A second TSL runtime lacks these bundled method chains.
        expect(() => model.finish(builder)).not.toThrow()
        expect(multiscattering).toHaveBeenCalledExactlyOnceWith(
          expect.any(Node),
          expect.any(Node),
          specularF90,
          specularColor,
        )
        const assignments = flow.nodes.filter((node) => {
          const target: unknown = Reflect.get(node, 'targetNode')
          return target instanceof Node && Reflect.get(target, 'name') === 'treesDiffuseResponse'
        })
        expect(assignments).toHaveLength(1)
        const response: unknown = Reflect.get(assignments[0]!, 'sourceNode')
        if (!(response instanceof Node)) throw new Error('Missing native diffuse response graph')
        const dependencies = new Set<Node>()
        response.traverse((node) => dependencies.add(node))
        expect(dependencies).toContain(diffuseColor)
        expect(dependencies).toContain(metalness)
        expect(dependencies).toContain(sourceAo)
        expect(dependencies).toContain(multiscattering.mock.calls[0]![0])
        expect(dependencies).toContain(multiscattering.mock.calls[0]![1])
      } finally {
        setCurrentStack(previousStack)
        multiscattering.mockRestore()
        bridge.dispose()
        source.dispose()
        geometry.dispose()
      }
    },
  )

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

  it('keeps known transparent decals native without clipping any low-alpha edge', () => {
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
    expect(first.material).toBe(source)
    expect(second.material).toBe(source)
    expect(source.map).toBe(texture)
    expect(source.alphaMap).toBe(alphaMap)
    expect(source.transparent).toBe(true)
    expect(source.depthWrite).toBe(false)
    expect(source.alphaTest).toBe(0)
    expect(source.version).toBe(sourceVersion)
    expect(source.clearcoat).toBe(0.28)
    expect(realtimeMaterialSupported(source)).toBe(false)
    expect(bridge.stats()).toMatchObject({
      supported: 0,
      runtime: 0,
      nativeTransparent: 1,
      protectedDecals: 0,
    })
    expect(bridge.sync()).toBe(false)
    source.alphaTest = 0.15
    expect(bridge.sync()).toBe(false)
    expect((first.material as MeshPhysicalMaterial).alphaTest).toBe(0.15)
    source.alphaTest = 0
    source.opacity = 0.7
    expect(bridge.sync()).toBe(false)
    expect((first.material as MeshPhysicalMaterial).opacity).toBe(0.7)
    expect(source.alphaTest).toBe(0)
    bridge.restore()
    bridge.dispose()
    expect(first.material).toBe(source)
    expect(second.material).toBe(source)
    expect(sourceDispose).not.toHaveBeenCalled()
    expect(textureDispose).not.toHaveBeenCalled()
    expect(alphaDispose).not.toHaveBeenCalled()
    expect(geometryDispose).not.toHaveBeenCalled()
    source.dispose()
    texture.dispose()
    alphaMap.dispose()
    geometry.dispose()
  })

  it('never treats known names, unknown glass or unnamed transparent assets as alpha masks', () => {
    const texture = new Texture(),
      geometry = new BoxGeometry(),
      root = new Group()
    const recovered = [
      ...Array.from({ length: 50 }, (_, index) => `decal-${index + 6}`),
      'decal-62',
    ]
    const sources = ['glass', 'decal-999', '', ...recovered].map(
      (name) => new MeshPhysicalMaterial({ name, map: texture, transparent: true }),
    )
    const meshes = sources.map((source) => new Mesh(geometry, source))
    root.add(...meshes)
    const bridge = createRealtimeMaterials(root)
    expect(bridge.count).toBe(0)
    expect(bridge.stats()).toMatchObject({
      runtime: 0,
      nativeTransparent: 54,
      protectedDecals: 0,
    })
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

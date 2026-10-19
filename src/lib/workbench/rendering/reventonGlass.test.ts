import { BoxGeometry, Color, Group, Mesh, MeshPhysicalMaterial, Texture } from 'three'
import {
  MeshPhysicalNodeMaterial,
  PhysicalLightingModel,
  RenderTarget,
  type NodeBuilder,
} from 'three/webgpu'
import { getCurrentStack, setCurrentStack, stack, transmission } from 'three/tsl'
import { describe, expect, it, vi } from 'vitest'
import { prepareReventonMaterials } from '@/lib/reventon/materials'
import { ownReventonViewport, prepareGpuReventonMaterials } from './reventonGlass'

function fixture() {
  const model = new Group(),
    geometry = new BoxGeometry(),
    texture = new Texture(),
    glass = new MeshPhysicalMaterial({
      transmission: 1,
      thickness: 0,
      roughness: 0.04,
      map: texture,
    }),
    unrelated = new MeshPhysicalMaterial({ transmission: 0.5, thickness: 0.3 }),
    first = new Mesh(geometry, glass),
    second = new Mesh(geometry, [unrelated, glass])
  glass.name = 'Reventon / fixed / 15103'
  model.add(first, second)
  prepareReventonMaterials(model)
  return { model, geometry, texture, glass, unrelated, first, second }
}

describe('car WebGPU thin glazing', () => {
  it('borrows maps and source identities, shares derived materials, and restores without releasing loader resources', () => {
    const f = fixture(),
      sourceDispose = vi.spyOn(f.glass, 'dispose'),
      mapDispose = vi.spyOn(f.texture, 'dispose'),
      geometryDispose = vi.spyOn(f.geometry, 'dispose'),
      originalArray = f.second.material,
      bridge = prepareGpuReventonMaterials(f.model),
      runtime = f.first.material as unknown as MeshPhysicalNodeMaterial,
      runtimeDispose = vi.spyOn(runtime, 'dispose')
    expect(runtime).toBeInstanceOf(MeshPhysicalNodeMaterial)
    expect(runtime).not.toBe(f.glass)
    expect(f.second.material[0]).toBe(f.unrelated)
    expect(f.second.material[1]).toBe(runtime)
    expect(runtime.map).toBe(f.texture)
    expect(runtime.specularIntensity).toBe(0.22)
    expect(runtime.transmission).toBe(1)
    expect(runtime.thickness).toBe(0)
    expect(runtime.ior).toBe(f.glass.ior)
    const version = runtime.version
    f.glass.color.set('#81969a')
    f.glass.emissive.set('#537382')
    f.glass.emissiveIntensity = 0.13
    bridge.sync()
    expect(runtime.color.equals(f.glass.color)).toBe(true)
    expect(runtime.emissive.equals(f.glass.emissive)).toBe(true)
    expect(runtime.emissiveIntensity).toBe(0.13)
    expect(runtime.version).toBe(version)
    bridge.dispose()
    bridge.dispose()
    expect(f.first.material).toBe(f.glass)
    expect(f.second.material).toBe(originalArray)
    expect(runtimeDispose).toHaveBeenCalledTimes(1)
    expect(sourceDispose).not.toHaveBeenCalled()
    expect(mapDispose).not.toHaveBeenCalled()
    expect(geometryDispose).not.toHaveBeenCalled()
    f.geometry.dispose()
    f.glass.dispose()
    f.unrelated.dispose()
    f.texture.dispose()
  })

  it('sets only the local transmission backdrop before native reflection and never rewrites reflection roughness', () => {
    const f = fixture(),
      bridge = prepareGpuReventonMaterials(f.model),
      runtime = f.first.material as unknown as MeshPhysicalNodeMaterial,
      lighting = runtime.setupLightingModel(),
      previous = getCurrentStack(),
      flow = stack(),
      native = vi.spyOn(PhysicalLightingModel.prototype, 'start').mockImplementation(() => {}),
      context: Record<string, unknown> = {},
      builder = { context } as unknown as NodeBuilder
    try {
      setCurrentStack(flow)
      expect(() => lighting.start(builder)).not.toThrow()
      expect(native).toHaveBeenCalledExactlyOnceWith(builder)
      expect(context.backdropAlpha).toBe(transmission)
      expect(context.backdrop).toBeDefined()
      const names = flow.nodes.map((node) => {
        const target: unknown = Reflect.get(node, 'targetNode')
        return target && typeof target === 'object' ? Reflect.get(target, 'name') : undefined
      })
      expect(names).not.toContain('Roughness')
      expect(names).not.toContain('roughness')
      // Nonzero volumes deliberately return to the original native lighting model.
      f.glass.thickness = 0.3
      bridge.sync()
      expect(runtime.setupLightingModel().constructor).toBe(PhysicalLightingModel)
    } finally {
      native.mockRestore()
      setCurrentStack(previous)
      bridge.dispose()
      f.geometry.dispose()
      f.glass.dispose()
      f.unrelated.dispose()
      f.texture.dispose()
    }
  })

  it('owns every per-target viewport clone and rejects unreviewed Three revisions', () => {
    const viewport = ownReventonViewport(),
      target = new RenderTarget(),
      another = new RenderTarget(),
      sourceDispose = vi.spyOn(viewport.node.value, 'dispose'),
      first = viewport.node.getTextureForReference(target),
      second = viewport.node.getTextureForReference(another),
      firstDispose = vi.spyOn(first, 'dispose'),
      secondDispose = vi.spyOn(second, 'dispose')
    expect(viewport.node.getTextureForReference(target)).toBe(first)
    expect(first).not.toBe(second)
    expect(viewport.node.generateMipmaps).toBe(true)
    viewport.dispose()
    viewport.dispose()
    expect(sourceDispose).toHaveBeenCalledTimes(1)
    expect(firstDispose).toHaveBeenCalledTimes(1)
    expect(secondDispose).toHaveBeenCalledTimes(1)
    expect(() => prepareGpuReventonMaterials(new Group(), '186')).toThrow('r185')
    target.dispose()
    another.dispose()
  })

  it('leaves custom thick glazing and unrelated materials in their original native identities', () => {
    const f = fixture()
    f.glass.thickness = 1
    const bridge = prepareGpuReventonMaterials(f.model)
    expect(f.first.material).toBe(f.glass)
    expect(f.second.material[0]).toBe(f.unrelated)
    expect(f.glass.color).toBeInstanceOf(Color)
    bridge.dispose()
    f.geometry.dispose()
    f.glass.dispose()
    f.unrelated.dispose()
    f.texture.dispose()
  })
})

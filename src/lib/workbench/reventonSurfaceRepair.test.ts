import {
  BoxGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  SRGBColorSpace,
  Texture,
} from 'three'
import { describe, expect, it, vi } from 'vitest'
import { ownedResources } from './ownedResources'
import { prepareReventonSurfaces } from './reventonSurfaceRepair'

function fixture(materials: MeshStandardMaterial[]) {
  const model = new Group(),
    geometry = new BoxGeometry()
  const nested = new Group()
  model.add(nested)
  nested.add(new Mesh(geometry, materials))
  return { model, geometry }
}

function named(id: string, group = 'fixed') {
  const material = new MeshPhysicalMaterial()
  material.name = `Reventon / ${group} / ${id}`
  return material
}

describe('registered Reventon surface repair', () => {
  it('replaces only the stained colour bake, retaining authored surface maps and their owner', () => {
    const trim = named('18581', 'door_-1')
    const colour = new Texture(),
      normal = new Texture(),
      roughness = new Texture(),
      occlusion = new Texture()
    colour.colorSpace = SRGBColorSpace
    colour.channel = 1
    normal.channel = 1
    occlusion.channel = 2
    trim.map = colour
    trim.normalMap = normal
    trim.roughnessMap = roughness
    trim.aoMap = occlusion
    trim.roughness = 0.61
    trim.normalScale.set(0.8, 0.9)
    trim.aoMapIntensity = 0.7
    const disposed = vi.fn()
    for (const texture of [colour, normal, roughness, occlusion])
      texture.addEventListener('dispose', disposed)
    trim.addEventListener('dispose', disposed)
    const { model, geometry } = fixture([trim])
    geometry.addEventListener('dispose', disposed)
    prepareReventonSurfaces(model)
    expect(trim.map).toBeNull()
    expect(trim.color.toArray()).toEqual([0.025, 0.026, 0.028])
    expect(trim.normalMap).toBe(normal)
    expect(trim.roughnessMap).toBe(roughness)
    expect(trim.aoMap).toBe(occlusion)
    expect(trim.roughness).toBe(0.61)
    expect(trim.normalScale.toArray()).toEqual([0.8, 0.9])
    expect(trim.aoMapIntensity).toBe(0.7)
    expect(colour.colorSpace).toBe(SRGBColorSpace)
    expect(colour.channel).toBe(1)
    expect(occlusion.channel).toBe(2)
    expect(disposed).not.toHaveBeenCalled()
  })

  it('releases the removed colour map and retained source resources exactly once through their loader owner', () => {
    const trim = named('18581'),
      overlay = named('18821'),
      colour = new Texture(),
      normal = new Texture(),
      roughness = new Texture(),
      occlusion = new Texture(),
      overlayColour = new Texture()
    trim.map = colour
    trim.normalMap = normal
    trim.roughnessMap = roughness
    trim.aoMap = occlusion
    overlay.transparent = true
    overlay.map = overlayColour
    overlay.normalMap = normal
    const { model, geometry } = fixture([trim, overlay])
    model.add(new Mesh(geometry, [trim, overlay]))
    const resources = ownedResources()
    const disposal = [
      colour,
      normal,
      roughness,
      occlusion,
      overlayColour,
      trim,
      overlay,
      geometry,
    ].map((resource) => vi.spyOn(resource, 'dispose'))
    resources.track(model)
    prepareReventonSurfaces(model)
    expect(trim.map).toBeNull()
    expect(overlay.map).toBe(overlayColour)
    disposal.forEach((spy) => expect(spy).not.toHaveBeenCalled())
    resources.dispose()
    resources.dispose()
    disposal.forEach((spy) => expect(spy).toHaveBeenCalledTimes(1))
  })

  it('corrects only the five actual transparent overlay IDs, preserving images and double-sided coverage', () => {
    const overlays = ['18110', '18821', '18981', '19061', '19141'].map((id) => {
      const material = named(id, 'door_1')
      material.transparent = true
      material.side = DoubleSide
      material.map = new Texture()
      return material
    })
    const maps = overlays.map((material) => material.map)
    prepareReventonSurfaces(fixture(overlays).model)
    overlays.forEach((material, index) => {
      expect(material.map).toBe(maps[index])
      expect(material.side).toBe(DoubleSide)
      expect(material.transparent).toBe(true)
      expect(material.forceSinglePass).toBe(true)
      expect(material.depthWrite).toBe(false)
      expect(material.polygonOffset).toBe(true)
      expect(material.polygonOffsetFactor).toBe(-1)
      expect(material.polygonOffsetUnits).toBe(-1)
      expect(material.alphaTest).toBe(0.02)
    })
  })

  it('leaves opaque or masked surfaces, clear glazing and unrelated assets unchanged', () => {
    const opaque = named('18110'),
      masked = named('18821'),
      glazing = named('15103'),
      unrelated = named('18581')
    masked.alphaTest = 0.5
    glazing.transparent = true
    glazing.transmission = 1
    unrelated.name = 'Other product / fixed / 18581'
    unrelated.map = new Texture()
    const original = [opaque, masked, glazing, unrelated].map((material) => ({
      map: material.map,
      color: material.color.toArray(),
      forceSinglePass: material.forceSinglePass,
      depthWrite: material.depthWrite,
      polygonOffset: material.polygonOffset,
      alphaTest: material.alphaTest,
    }))
    prepareReventonSurfaces(fixture([opaque, masked, glazing, unrelated]).model)
    expect(
      [opaque, masked, glazing, unrelated].map((material) => ({
        map: material.map,
        color: material.color.toArray(),
        forceSinglePass: material.forceSinglePass,
        depthWrite: material.depthWrite,
        polygonOffset: material.polygonOffset,
        alphaTest: material.alphaTest,
      })),
    ).toEqual(original)
    expect(glazing.transmission).toBe(1)
  })

  it('is idempotent for repeated initialization and material instances shared across meshes', () => {
    const trim = named('18581'),
      overlay = named('19061')
    trim.map = new Texture()
    overlay.transparent = true
    const { model, geometry } = fixture([trim, overlay])
    model.add(new Mesh(geometry, [trim, overlay]))
    prepareReventonSurfaces(model)
    const versions = [trim.version, overlay.version]
    expect(versions).toEqual([1, 2]) // alphaTest itself and the repair each invalidate overlay shader.
    prepareReventonSurfaces(model)
    expect([trim.version, overlay.version]).toEqual(versions)
  })
})

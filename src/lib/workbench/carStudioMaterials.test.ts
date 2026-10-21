import { BoxGeometry, Group, Mesh, MeshPhysicalMaterial, Texture } from 'three'
import { describe, expect, it, vi } from 'vitest'
import { applyCarStudioMaterials } from './carStudioMaterials'

describe('reversible car studio calibration', () => {
  it('uses source semantic IDs without modifying maps, physical specular or geometry', () => {
    const model = new Group(),
      geometry = new BoxGeometry(),
      map = new Texture(),
      ids = ['15023', '20159', '15103', '21865', '16262', '18029', '18581', '19771', '99999'],
      materials = ids.map((id) => {
        const material = new MeshPhysicalMaterial({
          roughness: 0.5,
          clearcoat: 0,
          specularIntensity: 1,
        })
        material.name = `Reventon / fixed / ${id}`
        material.map = map
        material.normalMap = map
        if (id === '15103' || id === '21865') {
          material.transmission = 1
          material.specularIntensity = 0.22
          material.ior = 1.329
        }
        model.add(new Mesh(geometry, material))
        return material
      }),
      originals = materials.map((m) => ({
        roughness: m.roughness,
        clearcoat: m.clearcoat,
        specularIntensity: m.specularIntensity,
      })),
      disposeMap = vi.spyOn(map, 'dispose'),
      disposeGeometry = vi.spyOn(geometry, 'dispose'),
      owner = applyCarStudioMaterials(model, [materials[0]!.name])
    expect(materials[0]!.roughness).toBe(0.34)
    expect(materials[0]!.clearcoat).toBe(0.42)
    expect(materials[1]!.clearcoat).toBe(0.65)
    expect(materials[2]!.specularIntensity).toBe(0.38)
    expect(materials[3]!.specularIntensity).toBe(0.38)
    expect(materials[2]!.transmission).toBe(1)
    expect(materials[2]!.ior).toBe(1.329)
    expect(materials[4]!.roughness).toBe(0.21)
    expect(materials[5]!.roughness).toBe(0.35)
    expect(materials[6]!.roughness).toBe(0.94)
    expect(materials[6]!.sheen).toBe(0.1)
    expect(materials[6]!.sheenColor.toArray()).toEqual([0.4, 0.4, 0.4])
    expect(materials[7]!.roughness).toBe(0.62)
    expect(materials[8]!.roughness).toBe(0.5)
    for (const [index, material] of materials.entries()) {
      expect(material.map).toBe(map)
      expect(material.normalMap).toBe(map)
      if (index !== 2 && index !== 3) expect(material.specularIntensity).toBe(1)
    }
    owner.dispose()
    owner.dispose()
    materials.forEach((m, index) => expect(m).toMatchObject(originals[index]!))
    expect(materials[6]!.sheen).toBe(0)
    expect(materials[6]!.sheenColor.toArray()).toEqual([0, 0, 0])
    expect(disposeMap).not.toHaveBeenCalled()
    expect(disposeGeometry).not.toHaveBeenCalled()
    map.dispose()
    geometry.dispose()
    materials.forEach((m) => m.dispose())
  })

  it('deduplicates shared material identities and leaves unrelated/transparent trim untouched', () => {
    const model = new Group(),
      geometry = new BoxGeometry(),
      shared = new MeshPhysicalMaterial({ roughness: 0.45 }),
      trim = new MeshPhysicalMaterial({ roughness: 0.45, transparent: true }),
      custom = new MeshPhysicalMaterial({ roughness: 0.45 })
    shared.name = 'Reventon / fixed / 15023'
    trim.name = 'Reventon / door_1 / 18581'
    custom.name = 'Custom / fixed / 20159'
    for (const material of [shared, shared, trim, custom]) model.add(new Mesh(geometry, material))
    const owner = applyCarStudioMaterials(model, [shared.name])
    expect(shared.roughness).toBe(0.34)
    expect(trim.roughness).toBe(0.45)
    expect(custom.roughness).toBe(0.45)
    owner.dispose()
    expect(shared.roughness).toBe(0.45)
    geometry.dispose()
    shared.dispose()
    trim.dispose()
    custom.dispose()
  })
})

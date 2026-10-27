import { describe, expect, it } from 'vitest'
import { Group, Mesh, MeshPhysicalMaterial } from 'three'
import { MeshPhysicalNodeMaterial } from 'three/webgpu'
import { usesCabinAreaSpecular, usesLocalAreaSpecular } from './receiver'

describe('audited local cabin area highlights', () => {
  it('requires a local owner, original identity and an opaque leather material', () => {
    const root = new Group(),
      mesh = new Mesh(),
      material = new MeshPhysicalMaterial()
    root.add(mesh)
    material.name = 'Reventon / door_-1 / 19771'
    material.userData.source_vpb_material_id = 19771
    expect(usesCabinAreaSpecular(mesh, material)).toBe(false)
    root.userData.carStudioCabinLighting = 'local'
    expect(usesCabinAreaSpecular(mesh, material)).toBe(true)
    expect(usesLocalAreaSpecular(mesh, material)).toBe(true)
    // The interior is still a finite, box-projected receiver, not a boundary wall.
    expect(usesLocalAreaSpecular(mesh)).toBe(false)
    const runtime = new MeshPhysicalNodeMaterial().copy(material)
    expect(usesCabinAreaSpecular(mesh, runtime)).toBe(true)
    material.transparent = true
    expect(usesCabinAreaSpecular(mesh, material)).toBe(false)
    material.transparent = false
    material.userData.source_vpb_material_id = 20159
    expect(usesCabinAreaSpecular(mesh, material)).toBe(false)
    delete root.userData.carStudioCabinLighting
    expect(usesCabinAreaSpecular(mesh, runtime)).toBe(false)
    material.dispose()
    runtime.dispose()
    mesh.geometry.dispose()
    for (const entry of Array.isArray(mesh.material) ? mesh.material : [mesh.material])
      entry.dispose()
  })
})

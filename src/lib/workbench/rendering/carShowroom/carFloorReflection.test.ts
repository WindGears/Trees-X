import { Group, Mesh, MeshPhysicalMaterial, PlaneGeometry, Scene, Vector3 } from 'three'
import { describe, expect, it, vi } from 'vitest'
import { createCarFloorReflection } from './carFloorReflection'

describe('car-only floor reflection ownership', () => {
  it('uses full floor geometry including joints, with an upward mirror plane and independent disposal', () => {
    const source = new PlaneGeometry(12, 14).rotateX(-Math.PI / 2),
      floor = new Mesh(source, new MeshPhysicalMaterial()),
      product = new Group(),
      scene = new Scene()
    floor.position.y = -0.01
    const reflection = createCarFloorReflection(floor, product)
    scene.add(floor, product, reflection.mesh)
    scene.updateMatrixWorld(true)
    expect(reflection.mesh.geometry).not.toBe(source)
    expect(Array.from(reflection.mesh.geometry.attributes.position!.array)).toEqual(
      Array.from(source.attributes.position!.array),
    )
    expect(
      new Vector3(0, 0, 1).transformDirection(reflection.mesh.children[0]!.matrixWorld).y,
    ).toBeCloseTo(1)
    expect(reflection.mesh.position.y).toBeCloseTo(-0.0096)
    const originalDispose = vi.spyOn(source, 'dispose'),
      ownDispose = vi.spyOn(reflection.mesh.geometry, 'dispose'),
      materialDispose = vi.spyOn(reflection.mesh.material, 'dispose')
    reflection.dispose()
    reflection.dispose()
    expect(originalDispose).not.toHaveBeenCalled()
    expect(ownDispose).toHaveBeenCalledTimes(1)
    expect(materialDispose).toHaveBeenCalledTimes(1)
    expect(product.parent).toBe(scene)
    expect(reflection.mesh.parent).toBeNull()
    source.dispose()
    floor.material.dispose()
  })
})

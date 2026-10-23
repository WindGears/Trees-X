import { Mesh, Raycaster, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { createColdStudioGeometry } from './geometry'
import { coldStudioConfig } from './config'

describe('studio architectural wall cladding', () => {
  it('uses real inset joints, bevels and depth on all four walls', () => {
    const room = createColdStudioGeometry(),
      ray = new Raycaster(),
      panels = room.fadeMeshes.filter((m) => m.userData.showroomId.endsWith('wall panels')),
      trims = room.fadeMeshes.filter((m) => m.userData.showroomId.endsWith('wall trim'))
    expect(panels).toHaveLength(4)
    expect(trims).toHaveLength(4)
    for (const mesh of panels) {
      expect(mesh.userData.showroomSurface).toBe('wall')
      expect(mesh.userData.traceSupport).toBe(true)
      const normals = mesh.geometry.getAttribute('normal')
      expect(Array.from(normals.array).some((v) => Math.abs(v) > 0.1 && Math.abs(v) < 0.99)).toBe(
        true,
      )
    }
    const front = panels.find((m) => m.userData.showroomId === 'front wall panels')!,
      wall = room.root.children.find((m) => m.userData.showroomId === 'front wall') as Mesh,
      length = 18 - coldStudioConfig.coveRadius * 4,
      bays = Math.round(length / 3.2),
      span = (length - 0.28) / bays,
      localJoint = -length / 2 + 0.14 + span
    ray.set(new Vector3(-localJoint, 2, 0), new Vector3(0, 0, 1))
    expect(ray.intersectObject(front)).toHaveLength(0)
    expect(ray.intersectObject(wall)[0]?.distance).toBeCloseTo(11)
    ray.set(new Vector3(-localJoint - span / 2, 2, 0), new Vector3(0, 0, 1))
    expect(ray.intersectObject(front)[0]?.distance).toBeCloseTo(10.915, 4)
    room.dispose()
  })
})

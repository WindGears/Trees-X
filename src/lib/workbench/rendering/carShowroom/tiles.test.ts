import { describe, expect, it } from 'vitest'
import { Raycaster, Vector3 } from 'three'
import { createColdStudioGeometry } from './geometry'
import { coldStudioConfig } from './config'

describe('real stone slabs', () => {
  it('has physical gaps above a recessed bed, without coplanar grid overlays', () => {
    const room = createColdStudioGeometry()
    const bed = room.root.children.find((n) => n.userData.showroomId === 'recessed tile joints')!
    const ray = new Raycaster(new Vector3(0, 2, 0.21), new Vector3(0, -1, 0))
    expect(ray.intersectObject(room.floor)).toHaveLength(0)
    const joint = ray.intersectObject(bed)
    expect(joint).toHaveLength(1)
    expect(joint[0]!.point.y).toBeCloseTo(coldStudioConfig.groundY - 0.003)
    ray.ray.origin.x = 0.21
    const tile = ray.intersectObject(room.floor)
    expect(tile).toHaveLength(1)
    expect(tile[0]!.point.y).toBeCloseTo(coldStudioConfig.groundY)
    expect(tile[0]!.face!.normal.y).toBeGreaterThan(0.99)
    room.dispose()
  })
  it('has one ceiling surface at interior rays, including the fan quadrants', () => {
    const room = createColdStudioGeometry()
    const ceiling = room.root.children.find((n) => n.userData.showroomId === 'ceiling')!
    const ray = new Raycaster()
    for (
      let x = coldStudioConfig.roomBox.min[0] + 1.31;
      x < coldStudioConfig.roomBox.max[0] - 1;
      x += 1.13
    )
      for (
        let z = coldStudioConfig.roomBox.min[2] + 1.29;
        z < coldStudioConfig.roomBox.max[2] - 1;
        z += 1.27
      ) {
        ray.set(new Vector3(x, coldStudioConfig.roomBox.max[1] - 0.2, z), new Vector3(0, 1, 0))
        const hits = ray.intersectObject(ceiling)
        expect(hits).toHaveLength(1)
        expect(hits[0]!.point.y).toBeCloseTo(coldStudioConfig.roomBox.max[1])
        expect(hits[0]!.face!.normal.y).toBeLessThan(-0.99)
      }
    room.dispose()
  })
})

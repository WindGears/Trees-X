import { describe, it, expect } from 'vitest'
import { Raycaster, Vector3 } from 'three'
import { createColdStudioGeometry } from './geometry'
import { coldStudioConfig } from './config'

describe('studio floor and cove boundary', () => {
  it('has one upward-facing support surface at edges and all rounded corners', () => {
    const room = createColdStudioGeometry(),
      ray = new Raycaster(),
      radius = coldStudioConfig.coveRadius
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        for (let i = 1; i < 20; i++) {
          const t = ((i / 20) * Math.PI) / 2,
            x = sx * (9 - radius * 2 + radius * 1.5 * Math.cos(t)),
            z = sz * (11 - radius * 2 + radius * 1.5 * Math.sin(t))
          ray.set(new Vector3(x, 6, z), new Vector3(0, -1, 0))
          const hits = ray.intersectObjects([
            room.floor,
            ...room.fadeMeshes.filter((m) => m.name.includes('floor cove')),
          ])
          expect(hits).toHaveLength(1)
          expect(hits[0]!.face!.normal.y).toBeGreaterThan(0)
        }
      }
    room.dispose()
  })
})

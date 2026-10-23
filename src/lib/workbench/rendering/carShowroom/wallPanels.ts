import { BufferGeometry } from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { CarShowroomConfig } from './config'

/** Shallow architectural cladding, in front of the continuous structural shell.
 * Real open joints expose that shell; bevels catch light without baked highlights.
 * Four paint meshes and four trim meshes are owned by the room, never per-frame.
 */
export function createWallPanels(config: CarShowroomConfig) {
  const [minX, , minZ] = config.roomBox.min,
    [maxX, top, maxZ] = config.roomBox.max,
    corner = config.coveRadius * 2,
    bottom = config.groundY + config.coveRadius + 0.035,
    height = top - bottom - 0.15,
    sides = [
      { id: 'back', length: maxX - minX - corner * 2, x: (minX + maxX) / 2, z: minZ, angle: 0 },
      {
        id: 'right',
        length: maxZ - minZ - corner * 2,
        x: maxX,
        z: (minZ + maxZ) / 2,
        angle: -Math.PI / 2,
      },
      {
        id: 'front',
        length: maxX - minX - corner * 2,
        x: (minX + maxX) / 2,
        z: maxZ,
        angle: Math.PI,
      },
      {
        id: 'left',
        length: maxZ - minZ - corner * 2,
        x: minX,
        z: (minZ + maxZ) / 2,
        angle: Math.PI / 2,
      },
    ]
  function box(width: number, tall: number, depth: number, x: number, y: number, z: number) {
    const geometry = new RoundedBoxGeometry(width, tall, depth, 1, 0.008),
      position = geometry.getAttribute('position'),
      normal = geometry.getAttribute('normal'),
      uv = geometry.getAttribute('uv')
    // Local metric projection keeps spray grain the same physical size on every bay.
    for (let i = 0; i < position.count; i++) {
      const nx = Math.abs(normal.getX(i)),
        ny = Math.abs(normal.getY(i)),
        nz = Math.abs(normal.getZ(i))
      const u = nx > nz ? position.getZ(i) + z : position.getX(i) + x
      const v = ny > Math.max(nx, nz) ? position.getZ(i) + z : position.getY(i) + y
      uv.setXY(i, u / 1.5, v / 1.5)
    }
    geometry.translate(x, y, z)
    return geometry
  }
  function combine(parts: BufferGeometry[], side: (typeof sides)[number]) {
    const merged = mergeGeometries(parts, false)
    for (const part of parts) part.dispose()
    if (!merged) throw new Error('Cold studio wall cladding could not be assembled')
    merged.rotateY(side.angle)
    merged.translate(side.x, 0, side.z)
    merged.computeBoundingBox()
    merged.computeBoundingSphere()
    return merged
  }
  return sides.flatMap((side) => {
    const bayCount = Math.max(1, Math.round(side.length / 3.2)),
      span = (side.length - 0.28) / bayCount,
      paint = Array.from({ length: bayCount }, (_, i) =>
        box(
          span - 0.018,
          height,
          0.06,
          -side.length / 2 + 0.14 + span * (i + 0.5),
          bottom + height / 2,
          0.055,
        ),
      ),
      trim = [
        box(side.length, 0.12, 0.1, 0, top - 0.06, 0.065),
        ...[-1, 1].map((sign) =>
          box(0.12, top - bottom, 0.1, sign * (side.length / 2 - 0.06), (top + bottom) / 2, 0.065),
        ),
      ]
    return [
      { id: `${side.id} wall panels`, surface: 'wall' as const, geometry: combine(paint, side) },
      { id: `${side.id} wall trim`, surface: 'trim' as const, geometry: combine(trim, side) },
    ]
  })
}

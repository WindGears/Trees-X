import { BoxGeometry } from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { CarShowroomConfig } from './config'

/** Flush ceiling mounting grid. Room owns the merged geometry and its material. */
export function createCeilingFrame(config: CarShowroomConfig) {
  const [minX, , minZ] = config.roomBox.min,
    [maxX, top, maxZ] = config.roomBox.max,
    width = maxX - minX,
    depth = maxZ - minZ,
    parts: BoxGeometry[] = []
  function rail(w: number, d: number, x: number, z: number) {
    const geometry = new BoxGeometry(w, 0.16, d)
    geometry.translate(x, top - 0.08, z)
    parts.push(geometry)
  }
  for (const x of [minX + 0.1, 0, maxX - 0.1]) rail(0.2, depth, x, 0)
  const key = config.lights.key
  for (const z of [
    minZ + 0.1,
    key.position[2] - key.height / 2 - 0.14,
    key.position[2] + key.height / 2 + 0.14,
    maxZ - 0.1,
  ])
    rail(width, 0.2, 0, z)
  const merged = mergeGeometries(parts, false)
  for (const part of parts) part.dispose()
  if (!merged) throw new Error('Cold studio ceiling frame could not be assembled')
  return merged
}

import { BufferGeometry, Float32BufferAttribute } from 'three'
type Point = [number, number]

/** Clip each real stone slab to the exact floor boundary. No coplanar decal grid. */
export function createStoneTiles(cap: BufferGeometry, size: number) {
  const p = cap.getAttribute('position'),
    outline: Point[] = []
  for (let i = 1; i < p.count; i++) outline.push([p.getX(i), p.getZ(i)])
  const positions: number[] = [],
    normals: number[] = [],
    uv: number[] = [],
    indices: number[] = []
  const minX = Math.min(...outline.map((p) => p[0])),
    maxX = Math.max(...outline.map((p) => p[0])),
    minZ = Math.min(...outline.map((p) => p[1])),
    maxZ = Math.max(...outline.map((p) => p[1]))
  function clip(poly: Point[], axis: 0 | 1, edge: number, sign: number) {
    const result: Point[] = []
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]!,
        b = poly[(i + 1) % poly.length]!,
        da = (a[axis] - edge) * sign,
        db = (b[axis] - edge) * sign
      if (da >= 0) result.push(a)
      if (da >= 0 !== db >= 0) {
        const t = da / (da - db)
        result.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
      }
    }
    return result
  }
  for (let x = Math.floor(minX / size); x < Math.ceil(maxX / size); x++)
    for (let z = Math.floor(minZ / size); z < Math.ceil(maxZ / size); z++) {
      const gap = 0.002,
        x0 = x * size + gap / 2,
        x1 = (x + 1) * size - gap / 2,
        z0 = z * size + gap / 2,
        z1 = (z + 1) * size - gap / 2
      let polygon = clip(outline, 0, x0, 1)
      polygon = clip(polygon, 0, x1, -1)
      polygon = clip(polygon, 1, z0, 1)
      polygon = clip(polygon, 1, z1, -1)
      if (polygon.length < 3) continue
      const start = positions.length / 3,
        rotation = (((x * 13 + z * 7) % 4) + 4) % 4
      for (const [px, pz] of polygon) {
        positions.push(px, 0, pz)
        normals.push(0, 1, 0)
        let u = (px - x * size) / size,
          v = (pz - z * size) / size
        for (let r = 0; r < rotation; r++) [u, v] = [1 - v, u]
        uv.push(u, v)
      }
      for (let i = 1; i < polygon.length - 1; i++) indices.push(start, start + i + 1, start + i)
    }
  const result = new BufferGeometry()
  result.setAttribute('position', new Float32BufferAttribute(positions, 3))
  result.setAttribute('normal', new Float32BufferAttribute(normals, 3))
  result.setAttribute('uv', new Float32BufferAttribute(uv, 2))
  result.setIndex(indices)
  result.computeBoundingBox()
  result.computeBoundingSphere()
  return result
}

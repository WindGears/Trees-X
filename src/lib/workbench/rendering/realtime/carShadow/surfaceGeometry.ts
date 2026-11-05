import { BufferAttribute, BufferGeometry } from 'three'

export interface QueryRange {
  start: number
  count: number
  materialIndex: number
}

/** Query-only copies. Split material boundaries, never weld/change source geometry. */
export function cloneCarSurfaceGeometry(source: BufferGeometry, ranges: readonly QueryRange[]) {
  const position = source.getAttribute('position')
  if (!position || position.itemSize < 3) throw new Error('Car query requires POSITION vec3')
  const normal = source.getAttribute('normal'),
    tangent = source.getAttribute('tangent')
  const uv = source.getAttribute('uv'),
    uv1 = source.getAttribute('uv1')
  const bevel = source.getAttribute('treesPaintBevel')
  const flags = (normal ? 1 : 0) | (uv ? 2 : 0) | (uv1 ? 4 : 0) | (tangent ? 8 : 0)
  for (const [attribute, size] of [
    [normal, 3],
    [tangent, 4],
    [uv, 2],
    [uv1, 2],
  ] as const) {
    if (attribute && (attribute.count !== position.count || attribute.itemSize < size)) {
      throw new Error('Car query surface attribute does not match POSITION')
    }
  }
  const vertices = new Map<string, number>()
  const original: number[] = [],
    slots: number[] = [],
    indices: number[] = []
  for (const range of ranges) {
    if (
      !Number.isInteger(range.materialIndex) ||
      range.materialIndex < 0 ||
      range.materialIndex > 65535 ||
      !Number.isSafeInteger(range.start) ||
      !Number.isSafeInteger(range.count) ||
      range.start < 0 ||
      range.count < 0 ||
      range.start + range.count > (source.index?.count ?? position.count) ||
      range.start % 3 ||
      range.count % 3
    )
      throw new Error('Car query requires aligned triangles and valid material slots')
    for (let i = range.start; i < range.start + range.count; i++) {
      const sourceVertex = source.index ? source.index.getX(i) : i
      if (!Number.isInteger(sourceVertex) || sourceVertex < 0 || sourceVertex >= position.count)
        throw new Error('Car query index outside POSITION')
      const key = `${sourceVertex}:${range.materialIndex}`
      let vertex = vertices.get(key)
      if (vertex === undefined) {
        vertex = original.length
        vertices.set(key, vertex)
        original.push(sourceVertex)
        slots.push(range.materialIndex)
      }
      indices.push(vertex)
    }
  }
  const positions = new Float32Array(original.length * 3)
  const normals = new Float32Array(original.length * 3)
  const tangents = new Float32Array(original.length * 4)
  const uvs = new Float32Array(original.length * 4)
  const metadata = new Float32Array(original.length * 4)
  original.forEach((index, vertex) => {
    positions.set([position.getX(index), position.getY(index), position.getZ(index)], vertex * 3)
    if (normal)
      normals.set([normal.getX(index), normal.getY(index), normal.getZ(index)], vertex * 3)
    if (tangent)
      tangents.set(
        [tangent.getX(index), tangent.getY(index), tangent.getZ(index), tangent.getW(index)],
        vertex * 4,
      )
    uvs.set(
      [uv?.getX(index) ?? 0, uv?.getY(index) ?? 0, uv1?.getX(index) ?? 0, uv1?.getY(index) ?? 0],
      vertex * 4,
    )
    metadata.set([slots[vertex]!, flags, bevel?.getX(index) ?? 0, 0], vertex * 4)
  })
  for (const array of [positions, normals, tangents, uvs, metadata]) {
    if (!array.every(Number.isFinite))
      throw new Error('Car query surface contains non-finite values')
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new BufferAttribute(normals, 3))
  geometry.setAttribute('tangent', new BufferAttribute(tangents, 4))
  geometry.setAttribute('queryUv', new BufferAttribute(uvs, 4))
  geometry.setAttribute('queryMeta', new BufferAttribute(metadata, 4))
  geometry.setIndex(new BufferAttribute(new Uint32Array(indices), 1))
  return geometry
}

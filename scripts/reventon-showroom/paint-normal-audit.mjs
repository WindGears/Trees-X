import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { Vector3 } from 'three'

// Read-only source geometry audit, not a visibility or screen-space diagnosis.
const directory = 'public/models/reventon-runtime-v2'
const manifest = JSON.parse(await readFile(`${directory}/workbench-manifest.json`, 'utf8'))
const bytes = await readFile(`${directory}/${manifest.entry}`)
const sha256 = createHash('sha256').update(bytes).digest('hex')
assert.equal(sha256, manifest.files.find((f) => f.path === manifest.entry).sha256)
assert.equal(bytes.readUInt32LE(0), 0x46546c67)
assert.equal(bytes.readUInt32LE(4), 2)
assert.equal(bytes.readUInt32LE(8), bytes.length)
const jsonLength = bytes.readUInt32LE(12)
assert.equal(bytes.readUInt32LE(16), 0x4e4f534a)
assert.equal(bytes.readUInt32LE(24 + jsonLength), 0x004e4942)
const document = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString())
const binary = bytes.subarray(
  28 + jsonLength,
  28 + jsonLength + bytes.readUInt32LE(20 + jsonLength),
)
function accessor(index) {
  const a = document.accessors[index],
    view = document.bufferViews[a.bufferView]
  assert.equal(view.buffer, 0)
  assert.equal(view.extensions?.EXT_meshopt_compression, undefined)
  assert.equal(a.sparse, undefined)
  assert.ok(['SCALAR', 'VEC3'].includes(a.type))
  const count = a.type === 'VEC3' ? 3 : 1
  const size = a.componentType === 5123 ? 2 : 4
  assert.ok([5123, 5125, 5126].includes(a.componentType))
  const stride = view.byteStride ?? size * count
  const offset = (view.byteOffset ?? 0) + (a.byteOffset ?? 0)
  const end = (view.byteOffset ?? 0) + view.byteLength
  assert.ok(end <= binary.length)
  return (item, channel = 0) => {
    assert.ok(Number.isInteger(item) && item >= 0 && item < a.count)
    assert.ok(Number.isInteger(channel) && channel >= 0 && channel < count)
    const location = offset + item * stride + channel * size
    assert.ok(location + size <= end)
    return a.componentType === 5126
      ? binary.readFloatLE(location)
      : a.componentType === 5123
        ? binary.readUInt16LE(location)
        : binary.readUInt32LE(location)
  }
}
const groups = []
for (const mesh of document.meshes)
  for (const primitive of mesh.primitives) {
    const material = document.materials[primitive.material]
    if (material.extras?.source_vpb_material_id !== 20159) continue
    const p = accessor(primitive.attributes.POSITION),
      n = accessor(primitive.attributes.NORMAL)
    const ix = accessor(primitive.indices)
    const summary = {
      mesh: mesh.name,
      triangles: document.accessors[primitive.indices].count / 3,
      vertices: document.accessors[primitive.attributes.POSITION].count,
      badNormalLength: 0,
      nonFiniteNormals: 0,
      degenerate: 0,
      oppositeAverageNormal: 0,
      anyOppositeNormal: 0,
      highNormalVariation: 0,
      totalArea: 0,
      oppositeArea: 0,
      highVariationArea: 0,
      minNormalLength: Infinity,
      maxNormalLength: 0,
      duplicatePositionTriangles: 0,
    }
    for (let i = 0; i < summary.vertices; i++) {
      const length = Math.hypot(n(i, 0), n(i, 1), n(i, 2))
      if (!Number.isFinite(length)) summary.nonFiniteNormals++
      if (Math.abs(length - 1) > 0.001) summary.badNormalLength++
      summary.minNormalLength = Math.min(summary.minNormalLength, length)
      summary.maxNormalLength = Math.max(summary.maxNormalLength, length)
    }
    const seen = new Set()
    for (let t = 0; t < summary.triangles; t++) {
      const indices = [0, 1, 2].map((c) => ix(t * 3 + c))
      const points = indices.map((i) => new Vector3(p(i, 0), p(i, 1), p(i, 2)))
      const normals = indices.map((i) => new Vector3(n(i, 0), n(i, 1), n(i, 2)).normalize())
      const face = points[1].clone().sub(points[0]).cross(points[2].clone().sub(points[0]))
      const area = face.length() / 2
      const key = points
        .map((v) =>
          v
            .toArray()
            .map((x) => Math.round(x * 1e6))
            .join(','),
        )
        .sort()
        .join(';')
      if (seen.has(key)) summary.duplicatePositionTriangles++
      seen.add(key)
      summary.totalArea += area
      if (area < 1e-12) {
        summary.degenerate++
        continue
      }
      face.normalize()
      const dots = normals.map((v) => v.dot(face))
      if (dots.some((v) => v < 0)) summary.anyOppositeNormal++
      if (dots.reduce((a, b) => a + b, 0) < 0) {
        summary.oppositeAverageNormal++
        summary.oppositeArea += area
      }
      if (
        Math.min(
          normals[0].dot(normals[1]),
          normals[1].dot(normals[2]),
          normals[0].dot(normals[2]),
        ) < 0.5
      ) {
        summary.highNormalVariation++
        summary.highVariationArea += area
      }
    }
    groups.push(summary)
  }
assert.equal(groups.length, 4)
const report = {
  sha256,
  groups,
  caveat:
    'All paint triangles in local asset coordinates, including hidden interior/backfaces. Area has not been weighted by camera visibility; duplicate position keys use 1e-6 precision and ignore material seams. Does not justify altering authored normals or deleting faces.',
}
await mkdir('artifacts/car-showroom/silver-surface-isolation', { recursive: true })
await writeFile(
  'artifacts/car-showroom/silver-surface-isolation/normal-audit.json',
  JSON.stringify(report, null, 2),
)
console.log(JSON.stringify(groups, null, 2))

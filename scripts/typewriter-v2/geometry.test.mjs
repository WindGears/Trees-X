import assert from 'node:assert/strict'
import test from 'node:test'
import { readAccessor, metricScale } from './glb.mjs'
import { projectLocal } from './projection.mjs'
import { orthogonalizeTangents } from './tangents.mjs'

test('reads strided source attributes without flattening interleaved values into geometry', () => {
  const data = Float32Array.from([1, 2, 3, 999, 4, 5, 6, 999])
  const doc = {
    binary: Buffer.from(data.buffer),
    json: {
      accessors: [{ bufferView: 0, componentType: 5126, count: 2, type: 'VEC3' }],
      bufferViews: [{ byteOffset: 0, byteStride: 16, byteLength: 32 }],
    },
  }
  assert.deepEqual([...readAccessor(doc, 0)], [1, 2, 3, 4, 5, 6])
})

test('local projection preserves source corner order and avoids zero UV area on orthogonal strip faces', () => {
  const positions = Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1])
  const indices = Uint32Array.from([0, 1, 2, 0, 2, 3, 0, 3, 1])
  const out = projectLocal({ mesh: 273, positions, indices })
  assert.deepEqual(
    [...out.indices].map((i) => out.remap[i]),
    [...indices],
  )
  for (let i = 0; i < out.indices.length; i += 3) {
    const [a, b, c] = [out.indices[i] * 2, out.indices[i + 1] * 2, out.indices[i + 2] * 2]
    const u = out.uv
    const area = (u[b] - u[a]) * (u[c + 1] - u[a + 1]) - (u[c] - u[a]) * (u[b + 1] - u[a + 1])
    assert.ok(Math.abs(area) > 0)
  }
})

test('metric UV density follows surface dimensions and rejects collapsed coordinates', () => {
  const indices = Uint32Array.from([0, 1, 2]),
    uv = Float32Array.from([0, 0, 1, 0, 0, 1])
  const p = Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0])
  assert.equal(metricScale(p, uv, indices, 0.04, 0.16), 4)
  assert.equal(
    metricScale(
      Float32Array.from(p, (v) => v * 2),
      uv,
      indices,
      0.04,
      0.16,
    ),
    8,
  )
  assert.throws(() => metricScale(p, new Float32Array(6), indices, 0.04, 0.16), /zero-area/)
})

test('valid Mikk directions and their handedness remain bit-identical with unnormalized source normals', () => {
  const tangents = Float32Array.from([1, 0, 0, -1, 0, 1, 0, 1])
  const normals = Float32Array.from([0, 0, 2, 0, 0, -3])
  const original = tangents.slice(),
    sourceNormals = normals.slice()
  assert.equal(orthogonalizeTangents(tangents, normals), 0)
  assert.deepEqual(tangents, original)
  assert.deepEqual(normals, sourceNormals)
})

test('zero and parallel fallback tangents become deterministic unit directions without changing w or normals', () => {
  const tangents = Float32Array.from([0, 0, 0, -1, 0, 0, 9, 1, 1, 1, 1, -1])
  const normals = Float32Array.from([0, 0, 1, 0, 0, 2, 1, 1, 1])
  const sourceNormals = normals.slice(),
    again = tangents.slice()
  assert.equal(orthogonalizeTangents(tangents, normals), 3)
  assert.equal(orthogonalizeTangents(again, normals), 3)
  assert.deepEqual(tangents, again)
  assert.deepEqual(normals, sourceNormals)
  assert.deepEqual([tangents[3], tangents[7], tangents[11]], [-1, 1, -1])
  for (let vertex = 0; vertex < 3; vertex++) {
    const direction = tangents.subarray(vertex * 4, vertex * 4 + 3)
    const normal = normals.subarray(vertex * 3, vertex * 3 + 3)
    assert.ok(Math.abs(Math.hypot(...direction) - 1) < 1e-6)
    assert.ok(
      Math.abs(direction.reduce((sum, value, index) => sum + value * normal[index], 0)) < 1e-6,
    )
  }
  assert.equal(orthogonalizeTangents(tangents, normals), 0, 'The repair must be idempotent')
})

test('nonorthogonal tangents are projected while zero source normals reject authoring', () => {
  const tangent = Float32Array.from([2, 0, 2, -1])
  assert.equal(orthogonalizeTangents(tangent, Float32Array.from([0, 0, 3])), 1)
  assert.deepEqual([...tangent], [1, 0, 0, -1])
  assert.throws(
    () => orthogonalizeTangents(Float32Array.from([1, 0, 0, 1]), new Float32Array(3)),
    /zero source normal/,
  )
})

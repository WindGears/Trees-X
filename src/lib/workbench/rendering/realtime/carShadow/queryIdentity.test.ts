import { expect, it } from 'vitest'
import { BoxGeometry, Group, Mesh, MeshPhysicalMaterial } from 'three'
import { StructTypeNode } from 'three/webgpu'
import { carQuerySources } from './queryIdentity'
import { collectCarShadowGeometry } from './geometry'
import { validateCarHitLayout } from './nearestHit'

it('uses actual transform slots, rejects missing/duplicate entries, and borrows semantic sources', () => {
  const geometry = new BoxGeometry()
  const material = new MeshPhysicalMaterial()
  const a = new Mesh(geometry, material)
  const b = new Mesh(geometry, material)
  const owner = collectCarShadowGeometry(new Group().add(a, b))
  const entries = [
    { slot: 0, object: owner.bindings[1]!.proxy, root: 0, instanceId: 0 },
    { slot: 1, object: owner.bindings[0]!.proxy, root: 0, instanceId: 0 },
  ]
  const runtime = {
    bvh: {},
    _getTransformMap: () => new Map(entries.map((value, i) => [i, value])),
  }
  expect(carQuerySources(runtime, owner.bindings).get(0)).toBe(b)
  expect(carQuerySources(runtime, owner.bindings).get(1)).toBe(a)
  entries[1]!.slot = 0
  expect(() => carQuerySources(runtime, owner.bindings)).toThrow('verified transform slot')
  entries.pop()
  expect(() => carQuerySources(runtime, owner.bindings)).toThrow('incomplete')
  expect(() => carQuerySources({}, owner.bindings)).toThrow('unavailable')
  owner.dispose()
  geometry.dispose()
  material.dispose()
})

it('refuses a closest-point or changed ray result layout instead of silently reading wrong members', () => {
  // StructTypeNode declarations lag r185's named runtime layout.
  const RuntimeType = StructTypeNode as unknown as new (
    layout: Record<string, string>,
  ) => StructTypeNode
  const fields = {
    indices: 'vec4u',
    normal: 'vec3f',
    didHit: 'bool',
    barycoord: 'vec3f',
    objectIndex: 'uint',
    side: 'float',
    dist: 'float',
  }
  expect(() => validateCarHitLayout(new RuntimeType(fields))).not.toThrow()
  expect(() => validateCarHitLayout(new RuntimeType({ ...fields, indices: 'vec3f' }))).toThrow(
    'layout changed',
  )
  expect(() => validateCarHitLayout(new RuntimeType({ ...fields, faceIndices: 'vec4u' }))).toThrow(
    'layout changed',
  )
})

import { expect, it } from 'vitest'
import {
  BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
  MeshPhysicalMaterial,
  PlaneGeometry,
} from 'three'
import { cloneCarSurfaceGeometry } from './surfaceGeometry'
import { collectCarShadowGeometry } from './geometry'

it('splits only shared material boundaries and preserves ordered triangle values and source buffers', () => {
  const source = new PlaneGeometry(2, 2)
  const originalIndex = Array.from(source.index!.array)
  source.setAttribute('uv1', source.getAttribute('uv').clone())
  source.setAttribute('treesPaintBevel', new BufferAttribute(new Float32Array([0, 1, 0, 1]), 1))
  const derived = cloneCarSurfaceGeometry(source, [
    { start: 0, count: 3, materialIndex: 2 },
    { start: 3, count: 3, materialIndex: 7 },
  ])
  expect(derived.getAttribute('position').count).toBe(6)
  for (let corner = 0; corner < 6; corner++) {
    const a = source.index!.getX(corner),
      b = derived.index!.getX(corner)
    for (const name of ['position', 'normal']) {
      for (let channel = 0; channel < 3; channel++) {
        expect(derived.getAttribute(name).getComponent(b, channel)).toBe(
          source.getAttribute(name).getComponent(a, channel),
        )
      }
    }
    expect(derived.getAttribute('queryUv').getX(b)).toBe(source.getAttribute('uv').getX(a))
    expect(derived.getAttribute('queryUv').getZ(b)).toBe(source.getAttribute('uv1').getX(a))
    expect(derived.getAttribute('queryMeta').getX(b)).toBe(corner < 3 ? 2 : 7)
    expect(derived.getAttribute('queryMeta').getY(b)).toBe(7)
    expect(derived.getAttribute('queryMeta').getZ(b)).toBe(
      source.getAttribute('treesPaintBevel').getX(a),
    )
  }
  expect(Array.from(source.index!.array)).toEqual(originalIndex)
  expect(source.getAttribute('position').count).toBe(4)
  derived.dispose()
  source.dispose()
})

it('shares surface copies across material instances but not different group slot layouts', () => {
  const source = new PlaneGeometry()
  source.addGroup(0, 3, 0)
  source.addGroup(3, 3, 1)
  const a = new MeshPhysicalMaterial(),
    b = new MeshPhysicalMaterial()
  const owner = collectCarShadowGeometry(
    new Group().add(new Mesh(source, [a, b]), new Mesh(source, [b, a])),
    true,
  )
  expect(owner.geometries).toHaveLength(1)
  expect(owner.geometries[0]!.getAttribute('queryMeta')).toBeDefined()
  owner.dispose()
  source.dispose()
  a.dispose()
  b.dispose()
})

it('keeps missing UV/normal explicit and rejects malformed indices and nonfinite data', () => {
  const source = new BufferGeometry()
  source.setAttribute(
    'position',
    new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3),
  )
  const ranges = [{ start: 0, count: 3, materialIndex: 0 }]
  const derived = cloneCarSurfaceGeometry(source, ranges)
  expect(derived.getAttribute('queryMeta').getY(0)).toBe(0)
  expect(Array.from(derived.getAttribute('normal').array)).toEqual(Array(9).fill(0))
  expect(() => cloneCarSurfaceGeometry(source, [{ start: 1, count: 3, materialIndex: 0 }])).toThrow(
    'aligned',
  )
  source.getAttribute('position').setX(0, NaN)
  expect(() => cloneCarSurfaceGeometry(source, ranges)).toThrow('non-finite')
  derived.dispose()
  source.dispose()
})

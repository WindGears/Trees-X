import { describe, expect, it, vi } from 'vitest'
import {
  BufferAttribute,
  BufferGeometry,
  Group,
  InstancedMesh,
  InterleavedBuffer,
  InterleavedBufferAttribute,
  Matrix4,
  Mesh,
  MeshPhysicalMaterial,
  Texture,
} from 'three'
import { carShadowOpaqueMaterial, collectCarShadowGeometry } from './geometry'

function geometry() {
  const result = new BufferGeometry()
  result.setAttribute(
    'position',
    new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3),
  )
  result.setAttribute('normal', new BufferAttribute(new Float32Array(9), 3))
  result.setIndex([0, 1, 2, 2, 1, 0])
  return result
}

describe('car key shadow opaque geometry ownership', () => {
  it('excludes transmission, blending, cutouts and hidden materials without guessing from names', () => {
    expect(carShadowOpaqueMaterial(new MeshPhysicalMaterial())).toBe(true)
    for (const material of [
      new MeshPhysicalMaterial({ transparent: true }),
      new MeshPhysicalMaterial({ opacity: 0.5 }),
      new MeshPhysicalMaterial({ transmission: 1 }),
      new MeshPhysicalMaterial({ alphaTest: 0.01 }),
      new MeshPhysicalMaterial({ alphaMap: new Texture() }),
      new MeshPhysicalMaterial({ visible: false }),
    ]) {
      expect(carShadowOpaqueMaterial(material)).toBe(false)
      material.dispose()
    }
  })

  it('shares a derivative only for the same original geometry and eligible rendered ranges', () => {
    const source = geometry()
    source.addGroup(0, 3, 0)
    source.addGroup(3, 3, 1)
    const opaque = new MeshPhysicalMaterial()
    const glass = new MeshPhysicalMaterial({ transmission: 1 })
    const a = new Mesh(source, [opaque, glass])
    const b = new Mesh(source, [opaque, glass])
    const c = new Mesh(source, [glass, opaque])
    const root = new Group().add(a, b, c)
    const sourcePosition = source.getAttribute('position').array
    const sourceIndex = source.index!.array
    const sourceDispose = vi.spyOn(source, 'dispose')
    const materialDispose = vi.spyOn(opaque, 'dispose')
    const owner = collectCarShadowGeometry(root)
    expect(owner.geometries).toHaveLength(2)
    expect(owner.bindings).toHaveLength(3)
    expect(owner.triangles).toBe(3)
    expect(owner.bindings[0]!.proxy.geometry).toBe(owner.bindings[1]!.proxy.geometry)
    expect(owner.bindings[0]!.proxy.geometry).not.toBe(owner.bindings[2]!.proxy.geometry)
    expect(owner.bindings[0]!.proxy.geometry.getAttribute('position').array).not.toBe(
      sourcePosition,
    )
    expect(Array.from(owner.geometries[0]!.index!.array)).toEqual([0, 1, 2])
    expect(Array.from(owner.geometries[1]!.index!.array)).toEqual([2, 1, 0])
    expect(owner.geometries[0]!.getAttribute('normal')).toBeUndefined()
    expect(owner.bindings.every(({ proxy }) => proxy.parent === null)).toBe(true)
    const proxyDisposers = owner.bindings.map(({ proxy }) => vi.spyOn(proxy, 'dispose'))
    const identity = new Matrix4()
    for (const binding of owner.bindings) {
      expect(binding.proxy.isInstancedMesh).toBe(true)
      expect(binding.proxy.count).toBe(1)
      binding.proxy.getMatrixAt(0, identity)
      expect(identity.equals(new Matrix4())).toBe(true)
      expect('isInstancedMesh' in binding.source).toBe(false)
    }
    owner.dispose()
    owner.dispose()
    expect(proxyDisposers.every((dispose) => dispose.mock.calls.length === 1)).toBe(true)
    expect(sourceDispose).not.toHaveBeenCalled()
    expect(materialDispose).not.toHaveBeenCalled()
    expect(source.getAttribute('position').array).toBe(sourcePosition)
    expect(source.index!.array).toBe(sourceIndex)
    expect(root.children).toEqual([a, b, c])
  })

  it('honours draw ranges, ignores groups for a single material, and clones interleaved positions', () => {
    const source = geometry()
    source.setAttribute(
      'position',
      new InterleavedBufferAttribute(
        new InterleavedBuffer(new Float32Array([99, 0, 0, 0, 99, 1, 0, 0, 99, 0, 1, 0]), 4),
        3,
        1,
      ),
    )
    source.addGroup(0, 3, 12)
    source.setDrawRange(3, 3)
    const parent = new Group()
    parent.position.set(2, 3, 4)
    parent.visible = false
    const mesh = new Mesh(source, new MeshPhysicalMaterial())
    parent.add(mesh)
    const owner = collectCarShadowGeometry(parent)
    expect(Array.from(owner.geometries[0]!.getAttribute('position').array)).toEqual([
      0, 0, 0, 1, 0, 0, 0, 1, 0,
    ])
    expect(Array.from(owner.geometries[0]!.index!.array)).toEqual([2, 1, 0])
    expect(owner.bindings[0]!.proxy.visible).toBe(false)
    expect(owner.bindings[0]!.proxy.matrixWorld.elements.slice(12, 15)).toEqual([2, 3, 4])
    owner.dispose()
  })

  it('rejects instancing and deformations explicitly rather than silently tracing the wrong shape', () => {
    const material = new MeshPhysicalMaterial()
    const source = geometry()
    expect(() => collectCarShadowGeometry(new InstancedMesh(source, material, 2))).toThrow(
      'rigid Mesh',
    )
    source.morphAttributes.position = [new BufferAttribute(new Float32Array(9), 3)]
    expect(() => collectCarShadowGeometry(new Mesh(source, material))).toThrow('rigid Mesh')
  })
})

import { BufferGeometry, Float32BufferAttribute, Group, Mesh } from 'three'
import { MeshPhysicalNodeMaterial } from 'three/webgpu'
import { describe, expect, it, vi } from 'vitest'
import { bevelStudyGeometry, installPaintBevelStudy } from './paintBevelStudy'

function sourceGeometry() {
  const geometry = new BufferGeometry()
  geometry.setAttribute(
    'position',
    new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 0.003, 0, 0, 1, 0], 3),
  )
  geometry.setAttribute(
    'normal',
    new Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3),
  )
  geometry.setAttribute('uv', new Float32BufferAttribute([0, 0, 1, 0, 0, 0.003, 0, 1], 2))
  geometry.setIndex([0, 1, 2, 0, 1, 3])
  return geometry
}

describe('explicit paint bevel surface study', () => {
  it('owns metadata for an already non-indexed source too', () => {
    const indexed = sourceGeometry(),
      source = indexed.toNonIndexed()
    source.userData.note = 'preserved'
    const { geometry } = bevelStudyGeometry(source)
    geometry.userData.paintBevelStudy = { selected: 1 }
    expect(source.userData).toEqual({ note: 'preserved' })
    expect(geometry.userData.note).toBe('preserved')
    geometry.dispose()
    source.dispose()
    indexed.dispose()
  })
  it('selects thin triangles without altering triangle positions, normals, UV or source buffers', () => {
    const source = sourceGeometry(),
      { geometry, stats } = bevelStudyGeometry(source)
    expect(stats.selected).toBe(1)
    expect(stats.triangles).toBe(2)
    expect(stats.selectedArea / stats.totalArea).toBeLessThan(0.01)
    const outputIndex = geometry.index!
    expect(
      Array.from(outputIndex.array, (i) => geometry.getAttribute('treesPaintBevel').getX(i)),
    ).toEqual([1, 1, 1, 0, 0, 0])
    expect(source.index?.count).toBe(6)
    expect(source.getAttribute('treesPaintBevel')).toBeUndefined()
    for (const name of ['position', 'normal', 'uv']) {
      const before = source.getAttribute(name),
        after = geometry.getAttribute(name)
      for (let i = 0; i < 6; i++)
        for (let j = 0; j < before.itemSize; j++)
          expect(after.array[outputIndex.getX(i) * before.itemSize + j]).toBe(
            before.array[source.index!.getX(i) * before.itemSize + j],
          )
    }
    geometry.dispose()
    source.dispose()
  })

  it('reuses vertices inside each selection and splits only the shared boundary', () => {
    const source = sourceGeometry()
    source.setIndex([0, 1, 2, 0, 1, 2, 0, 1, 3])
    const { geometry, stats } = bevelStudyGeometry(source)
    expect(stats.selected).toBe(2)
    expect(geometry.getAttribute('position').count).toBe(6)
    expect(geometry.index!.count).toBe(9)
    expect(Array.from(geometry.index!.array).slice(0, 3)).toEqual(
      Array.from(geometry.index!.array).slice(3, 6),
    )
    expect(geometry.index!.getX(0)).not.toBe(geometry.index!.getX(6))
    expect(source.getAttribute('position').count).toBe(4)
    geometry.dispose()
    source.dispose()
  })

  it('is opt-in, restores source before releasing only its derived geometry, and is idempotent', () => {
    const root = new Group(),
      source = sourceGeometry(),
      material = new MeshPhysicalNodeMaterial()
    const mesh = new Mesh(source, material)
    root.add(mesh)
    material.name = 'Reventon / fixed / 20159'
    material.userData.source_vpb_material_id = 20159
    material.roughness = 0.19
    root.userData.adapter = 'reventon-v1'
    root.userData.carStudioQuality = 'studio'
    installPaintBevelStudy(root, null)()
    expect(mesh.geometry).toBe(source)
    const restore = installPaintBevelStudy(root, 'finish')
    const derived = mesh.geometry,
      dispose = vi.spyOn(derived, 'dispose'),
      sourceDispose = vi.spyOn(source, 'dispose')
    expect(derived).not.toBe(source)
    expect(material.roughness).toBe(0.19)
    expect(material.roughnessNode).not.toBeNull()
    restore()
    restore()
    expect(mesh.geometry).toBe(source)
    expect(material.roughnessNode).toBeNull()
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(sourceDispose).not.toHaveBeenCalled()
    material.dispose()
    source.dispose()
  })

  it('handles shared paint material and repeated install without stacking derived geometry', () => {
    const root = new Group(),
      source = sourceGeometry(),
      material = new MeshPhysicalNodeMaterial()
    material.name = 'Reventon / fixed / 20159'
    material.userData.source_vpb_material_id = 20159
    root.userData.adapter = 'reventon-v1'
    root.userData.carStudioQuality = 'studio'
    const a = new Mesh(source, material),
      b = new Mesh(source, material)
    root.add(a, b)
    const restore = installPaintBevelStudy(root, 'finish'),
      ga = a.geometry,
      gb = b.geometry
    expect(ga).not.toBe(source)
    expect(gb).not.toBe(source)
    installPaintBevelStudy(root, 'finish')()
    expect(a.geometry).toBe(ga)
    expect(b.geometry).toBe(gb)
    restore()
    expect(a.geometry).toBe(source)
    expect(b.geometry).toBe(source)
    expect(material.colorNode).toBeNull()
    expect(material.roughnessNode).toBeNull()
    material.dispose()
    source.dispose()
  })
})

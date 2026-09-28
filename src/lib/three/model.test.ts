import { describe, expect, it, vi } from 'vitest'
import { Box3, BoxGeometry, Group, Mesh, MeshStandardMaterial, Texture, Vector3 } from 'three'
import { disposeModel, inspectModel, normalizeModel } from './model'

describe('model lifecycle and budgets', () => {
  it('centers offset models and fits the longest side without changing proportions', () => {
    const root = new Group()
    root.position.set(10, 2, -3)
    const mesh = new Mesh(new BoxGeometry(2, 4, 1), new MeshStandardMaterial())
    mesh.position.set(3, 6, -2)
    root.add(mesh)
    normalizeModel(root)
    const box = new Box3().setFromObject(root)
    const size = box.getSize(new Vector3())
    expect(box.getCenter(new Vector3()).length()).toBeLessThan(0.00001)
    expect(size.y).toBeCloseTo(2.8)
    expect(size.x / size.y).toBeCloseTo(0.5)
    disposeModel(root)
  })

  it('disposes shared geometry, material and texture exactly once', () => {
    const geometry = new BoxGeometry()
    const texture = new Texture()
    const material = new MeshStandardMaterial({ map: texture, roughnessMap: texture })
    const root = new Group()
    root.add(new Mesh(geometry, material), new Mesh(geometry, [material, material]))
    const spies = [geometry, texture, material].map((resource) => vi.spyOn(resource, 'dispose'))
    disposeModel(root)
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1)
  })

  it('counts geometry once per visible instance and rejects over-budget models', () => {
    const root = new Group()
    const mesh = new Mesh(new BoxGeometry(), new MeshStandardMaterial())
    root.add(mesh, mesh.clone())
    expect(inspectModel(root)).toEqual({ meshes: 2, triangles: 24 })
    disposeModel(root)
    const oversized = new Mesh(new BoxGeometry(1, 1, 1, 160, 160, 1), new MeshStandardMaterial())
    expect(() => inspectModel(oversized)).toThrow('超过 10 万三角形')
    disposeModel(oversized)
  })

  it('rejects empty models', () => {
    expect(() => inspectModel(new Group())).toThrow('没有可显示的网格')
    expect(() => normalizeModel(new Group())).toThrow('尺寸无效')
  })
})

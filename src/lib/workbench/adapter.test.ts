import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { Mesh, Vector3, type Material, type BufferGeometry } from 'three'
import { parseProduct } from './api'
import { createSampleAdapter } from './adapter'
const samples: unknown[] = JSON.parse(
  readFileSync('server/src/main/resources/samples/products.json', 'utf8'),
)

describe('procedural sample ownership and operations', () => {
  it.each(samples.map(parseProduct))(
    '$slug has real geometry, stable node identities and reversible actions',
    (product) => {
      const adapter = createSampleAdapter(product)
      const original = new Map(
        [...adapter.nodes].map(([id, node]) => [
          id,
          { position: node.position.clone(), rotation: node.rotation.clone() },
        ]),
      )
      const geometry = new Set<BufferGeometry>(),
        materials = new Set<Material>()
      adapter.root.traverse((object) => {
        if (object instanceof Mesh) {
          expect(object.geometry.getAttribute('position').count).toBeGreaterThan(0)
          geometry.add(object.geometry)
          for (const material of Array.isArray(object.material)
            ? object.material
            : [object.material])
            materials.add(material)
        }
      })
      expect(geometry.size).toBeGreaterThan(5)
      expect(adapter.root.userData.workbenchProduct).toBe(product.slug)
      for (const hotspot of product.presentation.hotspots)
        expect(adapter.point(hotspot.node, new Vector3())).toBeDefined()
      adapter.pose.explosion = 1
      for (const action of product.presentation.actions) adapter.pose[action.id] = 1
      adapter.apply()
      expect(
        [...adapter.nodes].some(([id, node]) => !node.position.equals(original.get(id)!.position)),
      ).toBe(true)
      for (const action of product.presentation.actions) {
        const node = adapter.nodes.get(action.node)!,
          before = original.get(action.node)!
        expect(
          !node.rotation.equals(before.rotation) || !node.position.equals(before.position),
        ).toBe(true)
      }
      for (const id of Object.keys(adapter.pose)) adapter.pose[id] = 0
      adapter.apply()
      adapter.apply()
      for (const [id, node] of adapter.nodes) {
        expect(node.position.equals(original.get(id)!.position)).toBe(true)
        expect(node.rotation.equals(original.get(id)!.rotation)).toBe(true)
      }
      const dispose = [...geometry, ...materials].map((resource) => vi.spyOn(resource, 'dispose'))
      adapter.dispose()
      adapter.dispose()
      dispose.forEach((spy) => expect(spy).toHaveBeenCalledTimes(1))
      expect(adapter.root.children).toHaveLength(0)
      const replacement = createSampleAdapter(product)
      expect(replacement.root).not.toBe(adapter.root)
      replacement.dispose()
    },
  )
  it('rejects a config referencing unavailable nodes and releases partial construction', () => {
    const product = parseProduct(samples[0])
    product.presentation.hotspots[0]!.node = 'missing'
    expect(() => createSampleAdapter(product)).toThrow('缺少部件')
  })
})

import { Mesh, MeshStandardMaterial, Vector3 } from 'three'
import type { Group } from 'three'
import type { Product, ProductFinish } from '@/data/products'

/** Owns only the appearance clone; loader continues to own original GLB resources. */
export function createModelPresentation(root: Group, product: Product) {
  const chassis = root.getObjectByName(product.finishNode)
  if (!(chassis instanceof Mesh) || !(chassis.material instanceof MeshStandardMaterial)) {
    throw new Error('模型缺少可切换配色的外壳，请检查模型配置。')
  }
  const original = chassis.material
  const material = original.clone()
  chassis.material = material
  const parts = product.structure.flatMap(({ nodes, offset }) =>
    nodes.flatMap((name) => {
      const node = root.getObjectByName(name)
      if (!node) return []
      const displacement = new Vector3(...offset)
      if (product.structureSpace === 'world' && node.parent) {
        node.parent.updateWorldMatrix(true, false)
        const start = new Vector3().applyMatrix4(node.parent.matrixWorld)
        const end = start.clone().add(displacement)
        node.parent.worldToLocal(end)
        node.parent.worldToLocal(start)
        displacement.copy(end).sub(start)
      }
      return [{ node, origin: node.position.clone(), offset: displacement }]
    }),
  )
  let disposed = false
  return {
    setFinish(finish: ProductFinish) {
      if (disposed) return
      if (finish.original) {
        material.color.copy(original.color)
        material.roughness = original.roughness
      } else {
        material.color.setRGB(...finish.color)
        material.roughness = finish.roughness
      }
    },
    setExpansion(progress: number) {
      if (disposed) return
      const amount = Math.max(0, Math.min(1, progress))
      for (const part of parts)
        part.node.position.copy(part.origin).addScaledVector(part.offset, amount)
      root.updateMatrixWorld(true)
    },
    dispose() {
      if (disposed) return
      disposed = true
      for (const part of parts) part.node.position.copy(part.origin)
      chassis.material = original
      material.dispose()
    },
  }
}

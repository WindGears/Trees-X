import { Vector3, type Group, type Object3D, type Texture } from 'three'
import { modelKit } from './modelKit'
import { sampleBuilders } from './samples'
import type { WorkbenchProduct } from './types'

export interface SceneAdapter {
  root: Group
  nodes: Map<string, Object3D>
  pose: Record<string, number>
  environment?: Texture
  apply(): void
  setFinish(color: string): void
  point(node: string, result: Vector3): Vector3 | undefined
  dispose(): void
}

export function createSampleAdapter(product: WorkbenchProduct): SceneAdapter {
  const kit = modelKit()
  try {
    if (product.presentation.source.kind !== 'procedural') throw new Error('样板适配器不能读取 GLB')
    const animate = sampleBuilders[product.presentation.source.key](kit)
    for (const item of [...product.presentation.hotspots, ...product.presentation.actions]) {
      if (!kit.nodes.has(item.node)) throw new Error('样板缺少部件：' + item.node)
    }
    kit.root.name = 'workbench-' + product.slug
    kit.root.userData.workbenchProduct = product.slug
    kit.root.userData.sourceKind = 'procedural'
    const pose: Record<string, number> = { explosion: 0 }
    for (const action of product.presentation.actions) pose[action.id] = 0
    const apply = () => {
      kit.resetPositions(pose.explosion ?? 0)
      animate(pose)
      kit.root.updateMatrixWorld(true)
    }
    apply()
    return {
      root: kit.root,
      nodes: kit.nodes,
      pose,
      apply,
      setFinish(color: string) {
        kit.finish.color.set(color)
      },
      point(node: string, result: Vector3) {
        return kit.nodes.get(node)?.getWorldPosition(result)
      },
      dispose: kit.dispose,
    }
  } catch (error) {
    kit.dispose()
    throw error
  }
}

import { Vector3 } from 'three'
import { modelKit } from './modelKit'
import { sampleBuilders } from './samples'
import type { WorkbenchProduct } from './types'

export function createSampleAdapter(product: WorkbenchProduct) {
  const kit = modelKit()
  try {
    const animate = sampleBuilders[product.presentation.source.key](kit)
    for (const item of [...product.presentation.hotspots, ...product.presentation.actions]) {
      if (!kit.nodes.has(item.node)) throw new Error('样板缺少部件：' + item.node)
    }
    kit.root.name = 'workbench-' + product.slug
    kit.root.userData.workbenchProduct = product.slug
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
export type SceneAdapter = ReturnType<typeof createSampleAdapter>

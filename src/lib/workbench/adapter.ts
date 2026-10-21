import { Vector3, type Group, type Object3D, type Texture, type Scene } from 'three'
import { modelKit } from './modelKit'
import { sampleBuilders } from './samples'
import type { Vec3, WorkbenchProduct } from './types'
import { bindMotionPose } from './motionPose'
import type { WorkbenchRenderer } from './rendering/rendererTypes'
import type { StudioMoodUpdate } from './studio/mood'

export interface SceneAdapter {
  root: Group
  nodes: Map<string, Object3D>
  pose: Record<string, number>
  environment?: Texture
  traceBackground?: Texture
  apply(): void
  setFinish(color: string): void
  point(node: string, result: Vector3, anchor?: Vec3): Vector3 | undefined
  dispose(): void
  attach?(scene: Scene, renderer: WorkbenchRenderer): void
  beforeRender?(): void
  /** Native preparation is serialized by the scene host; the adapter keeps
   * ownership until the awaited work settles, even after cancellation. */
  prepare?(signal?: AbortSignal): Promise<void>
  setStudioMood?(update: StudioMoodUpdate): void
  select?(node?: string): void
  nodeForHit?(object: Object3D, instanceId?: number): Object3D | undefined
}

export function createSampleAdapter(product: WorkbenchProduct): SceneAdapter {
  const kit = modelKit()
  try {
    if (product.presentation.source.kind !== 'procedural') throw new Error('样板适配器不能读取 GLB')
    const animate = sampleBuilders[product.presentation.source.key](
      kit,
      new Set(product.presentation.actions.filter((a) => a.kind !== 'progress').map((a) => a.id)),
    )
    for (const item of [...product.presentation.hotspots, ...product.presentation.actions]) {
      if (!kit.nodes.has(item.node)) throw new Error('样板缺少部件：' + item.node)
    }
    kit.root.name = 'workbench-' + product.slug
    kit.root.userData.workbenchProduct = product.slug
    kit.root.userData.sourceKind = 'procedural'
    const pose: Record<string, number> = { explosion: 0 }
    for (const action of product.presentation.actions) pose[action.id] = 0
    const applyMotion = bindMotionPose(product.presentation, kit.nodes)
    const mappedStructure = Boolean(product.presentation.structureActionId)
    const apply = () => {
      kit.resetPositions(mappedStructure ? 0 : (pose.explosion ?? 0))
      animate(pose)
      applyMotion(pose)
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
      point(node: string, result: Vector3, anchor?: Vec3) {
        const target = kit.nodes.get(node)
        return anchor
          ? target?.localToWorld(result.fromArray(anchor))
          : target?.getWorldPosition(result)
      },
      dispose: kit.dispose,
    }
  } catch (error) {
    kit.dispose()
    throw error
  }
}

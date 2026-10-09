import { Quaternion, Vector3, type Object3D } from 'three'
import { progressActions } from './motionConfig'
import type { ProductPresentation } from './types'

export const clampProgress = (value: number) => Math.min(1, Math.max(0, value))

// Bind once, before any action. Only the declared component of each local pose is owned here.
export function bindMotionPose(p: ProductPresentation, nodes: Map<string, Object3D>) {
  const tracks = progressActions(p).flatMap((action) =>
    (action.motion.tracks ?? []).map((track) => {
      const node = nodes.get(track.node)
      if (!node) throw new Error('进度动作缺少部件：' + track.node)
      const position = node.position.clone(),
        quaternion = node.quaternion.clone()
      return {
        id: action.id,
        track,
        node,
        position,
        quaternion,
        offset: track.type === 'translate' ? new Vector3(...track.offset) : undefined,
        target:
          track.type === 'rotate'
            ? quaternion
                .clone()
                .multiply(
                  new Quaternion().setFromAxisAngle(
                    new Vector3(...track.axis).normalize(),
                    track.angle,
                  ),
                )
            : undefined,
      }
    }),
  )
  return (pose: Record<string, number>) => {
    for (const binding of tracks) {
      const { track, node } = binding
      const progress = clampProgress(
        ((pose[binding.id] ?? 0) - track.range[0]) / (track.range[1] - track.range[0]),
      )
      if (binding.offset)
        node.position.copy(binding.position).addScaledVector(binding.offset, progress)
      else if (binding.target)
        node.quaternion.slerpQuaternions(binding.quaternion, binding.target, progress)
    }
  }
}

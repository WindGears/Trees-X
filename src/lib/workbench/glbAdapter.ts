import {
  InstancedMesh,
  Group,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
  type Object3D,
} from 'three'
import type { SceneAdapter } from './adapter'
import type { GlbSource, WorkbenchProduct } from './types'
import { bindMotionPose } from './motionPose'
import { progressActions } from './motionConfig'

export function bindGlb(
  product: WorkbenchProduct,
  source: GlbSource,
  model: Group,
  release: () => void,
): SceneAdapter {
  const root = new Group(),
    nodes = new Map<string, Object3D>()
  const materials = new Map<string, Set<MeshStandardMaterial>>()
  const duplicates = new Set<string>()
  let triangles = 0
  model.traverse((node) => {
    if (node.name) {
      if (nodes.has(node.name)) duplicates.add(node.name)
      nodes.set(node.name, node)
    }
    if (node instanceof Mesh) {
      node.castShadow = true
      node.receiveShadow = true
      triangles +=
        ((node.geometry.index?.count ?? node.geometry.getAttribute('position')?.count ?? 0) / 3) *
        (node instanceof InstancedMesh ? node.count : 1)
      for (const mat of Array.isArray(node.material) ? node.material : [node.material]) {
        if (!(mat instanceof MeshStandardMaterial)) continue
        const set = materials.get(mat.name) ?? new Set<MeshStandardMaterial>()
        set.add(mat)
        materials.set(mat.name, set)
      }
    }
  })
  const requireNode = (name: string) => {
    const node = nodes.get(name)
    if (!node || duplicates.has(name)) throw new Error('模型部件缺失或名称重复：' + name)
    return node
  }
  for (const hotspot of product.presentation.hotspots) requireNode(hotspot.node)
  const finishes = source.finishMaterials.flatMap((name) => {
    const set = materials.get(name)
    if (!set) throw new Error('模型缺少可试色材质：' + name)
    return [...set]
  })
  const actions = product.presentation.actions
    .filter((a) => a.kind !== 'progress')
    .map((action) => {
      if (!action.behavior) throw new Error('模型动作尚未绑定')
      return {
        id: action.id,
        node: requireNode(action.node),
        behavior: action.behavior,
        axis: 'axis' in action.behavior ? new Vector3(...action.behavior.axis) : undefined,
      }
    })
  const explosion = source.explode.map((item) => ({
    node: requireNode(item.node),
    offset: new Vector3(...item.offset),
  }))
  const moving = new Set([...actions.map((a) => a.node), ...explosion.map((e) => e.node)])
  for (const a of progressActions(product.presentation)) {
    requireNode(a.node)
    for (const t of a.motion.tracks ?? []) requireNode(t.node)
  }
  const applyMotion = bindMotionPose(product.presentation, nodes)
  const rest = [...moving].map((node) => ({
    node,
    position: node.position.clone(),
    quaternion: node.quaternion.clone(),
  }))
  root.add(model)
  root.position.fromArray(source.transform.position)
  root.rotation.set(...source.transform.rotation)
  root.scale.setScalar(source.transform.scale)
  root.name = 'workbench-' + product.slug
  root.userData.workbenchProduct = product.slug
  root.userData.sourceKind = 'glb'
  root.userData.assetBundle = source.bundle.id + '@' + source.bundle.version
  root.userData.triangles = triangles
  const pose: Record<string, number> = { explosion: 0 }
  product.presentation.actions.forEach((a) => {
    pose[a.id] = 0
  })
  const rotation = new Quaternion()
  let disposed = false
  const apply = () => {
    for (const b of rest) {
      b.node.position.copy(b.position)
      b.node.quaternion.copy(b.quaternion)
    }
    for (const b of explosion) b.node.position.addScaledVector(b.offset, pose.explosion ?? 0)
    for (const action of actions) {
      const b = action.behavior
      if (b.type === 'typewriter-strike') continue // The registered rig owns this composed action.
      const amount = (pose[action.id] ?? 0) * b.amount
      if (b.type === 'rotate' && action.axis)
        action.node.quaternion.multiply(rotation.setFromAxisAngle(action.axis, amount))
      else if (action.axis) action.node.position.addScaledVector(action.axis, amount)
    }
    applyMotion(pose)
    root.updateMatrixWorld(true)
  }
  apply()
  return {
    root,
    nodes,
    pose,
    apply,
    point(node, result, anchor) {
      const target = nodes.get(node)
      return anchor
        ? target?.localToWorld(result.fromArray(anchor))
        : target?.getWorldPosition(result)
    },
    setFinish(color) {
      finishes.forEach((material) => material.color.set(color))
    },
    dispose() {
      if (disposed) return
      disposed = true
      root.removeFromParent()
      release()
      root.clear()
      nodes.clear()
    },
  }
}

import {
  AnimationMixer,
  Box3,
  Color,
  LineSegments,
  LoopOnce,
  Mesh,
  MeshStandardMaterial,
  type AnimationClip,
  type Group,
  type Material,
  type Object3D,
} from 'three'
import { bindGlb } from './glbAdapter'
import { parsePianoRig, samplePianoCurve } from './pianoRig'
import type { GlbSource, WorkbenchProduct } from './types'

export function bindPiano(
  product: WorkbenchProduct,
  source: GlbSource,
  model: Group,
  animations: AnimationClip[],
  data: unknown,
  release: () => void,
) {
  const rig = parsePianoRig(data),
    adapter = bindGlb(product, source, model, release)
  const clip = animations.find((c) => c.name === rig.clip)
  if (!clip || Math.abs(clip.duration - rig.duration) > 0.001 || !clip.tracks.length)
    throw new Error('钢琴结构动画缺失或时长不一致')
  const program = product.presentation.actions.find((a) => a.motion?.program?.type === rig.type)
  if (!program) throw new Error('钢琴结构程序未绑定')
  const parts = new Map(rig.parts.map((p) => [p.node, p]))
  const partMeshes = new Map(
    rig.parts.map((part) => {
      const meshes: Mesh[] = []
      for (const name of [...part.section, ...part.flat])
        adapter.nodes.get(name)?.traverse((child) => {
          if (child instanceof Mesh) {
            if (!child.geometry.boundingBox) child.geometry.computeBoundingBox()
            meshes.push(child)
          }
        })
      return [part.node, meshes] as const
    }),
  )
  const surfaces = rig.surfaces.map((s) => {
    const node = adapter.nodes.get(s.node)
    if (!node) throw new Error('钢琴缺少表面：' + s.node)
    const meshes: (Mesh | LineSegments)[] = []
    node.traverse((child) => {
      if (child instanceof Mesh || child instanceof LineSegments) meshes.push(child)
    })
    const materials: Material[] = meshes.flatMap((m) =>
      Array.isArray(m.material) ? m.material : [m.material],
    )
    if (!materials.length || (s.curves.length !== 1 && materials.length !== s.curves.length))
      throw new Error('钢琴表面材质槽与曲线不一致：' + s.node)
    return { ...s, node, meshes, materials }
  })
  const mixer = new AnimationMixer(model),
    action = mixer.clipAction(clip)
  action.setLoop(LoopOnce, 1)
  action.clampWhenFinished = true
  action.play()
  const selected = new Map<MeshStandardMaterial, { color: Color; intensity: number }>()
  const box = new Box3(),
    aggregate = new Box3()
  const visible = (node: Object3D) => {
    let current: Object3D | null = node
    while (current) {
      if (!current.visible) return false
      current = current.parent
    }
    return true
  }
  const select = (name?: string) => {
    for (const [m, state] of selected) {
      m.emissive.copy(state.color)
      m.emissiveIntensity = state.intensity
    }
    selected.clear()
    const p = name ? parts.get(name) : undefined
    for (const n of p ? [...p.section, ...p.flat] : [])
      adapter.nodes.get(n)?.traverse((child) => {
        if (!(child instanceof Mesh)) return
        for (const material of Array.isArray(child.material) ? child.material : [child.material])
          if (material instanceof MeshStandardMaterial && !selected.has(material)) {
            selected.set(material, {
              color: material.emissive.clone(),
              intensity: material.emissiveIntensity,
            })
            material.emissive.set('#624d24')
            material.emissiveIntensity = 0.35
          }
      })
  }
  const apply = () => {
    adapter.apply()
    const progress = adapter.pose[program.id] ?? 0
    action.enabled = true
    action.paused = false
    mixer.setTime(Math.max(0, Math.min(1, progress)) * rig.duration)
    for (const s of surfaces) {
      let maximum = 0
      s.materials.forEach((m, i) => {
        const opacity = samplePianoCurve(
          rig.curves[s.curves[s.curves.length === 1 ? 0 : i]!]!,
          progress,
        )
        const transparent = s.line || opacity < 0.998
        if (m.transparent !== transparent) {
          m.transparent = transparent
          m.needsUpdate = true
        }
        m.opacity = opacity
        m.depthWrite = !s.line && opacity >= 0.94
        maximum = Math.max(maximum, opacity)
      })
      s.node.visible = maximum > 0.00001
      for (const mesh of s.meshes) mesh.castShadow = !s.line && s.castShadow && maximum > 0.8
    }
    adapter.root.updateMatrixWorld(true)
  }
  model.traverse((node) => {
    if (!(node instanceof Mesh)) return
    for (const m of Array.isArray(node.material) ? node.material : [node.material])
      if (m instanceof MeshStandardMaterial && typeof m.userData.sourceEnvMapIntensity === 'number')
        m.envMapIntensity = m.userData.sourceEnvMapIntensity
  })
  adapter.root.userData.parts = rig.parts.length
  adapter.root.userData.adapter = source.adapter
  apply()
  let disposed = false
  return {
    ...adapter,
    apply,
    select,
    nodeForHit(node: Object3D) {
      let current: Object3D | null = node
      while (current) {
        if (typeof current.userData.pianoPart === 'string')
          return adapter.nodes.get(current.userData.pianoPart)
        current = current.parent
      }
      return node
    },
    point(name: string, result: import('three').Vector3, anchor?: [number, number, number]) {
      const part = parts.get(name)
      if (!part || anchor) return adapter.point(name, result, anchor)
      aggregate.makeEmpty()
      for (const mesh of partMeshes.get(name) ?? [])
        if (visible(mesh) && mesh.geometry.boundingBox)
          aggregate.union(box.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld))
      return aggregate.isEmpty()
        ? model.localToWorld(result.fromArray(part.restPoint))
        : aggregate.getCenter(result)
    },
    dispose() {
      if (disposed) return
      disposed = true
      select()
      action.stop()
      mixer.stopAllAction()
      mixer.uncacheRoot(model)
      mixer.uncacheClip(clip)
      adapter.dispose()
    },
  }
}

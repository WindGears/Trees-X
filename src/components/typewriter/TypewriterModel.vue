<script setup lang="ts">
import { onScopeDispose, watch } from 'vue'
import { useLoop, useTres } from '@tresjs/core'
import {
  Box3,
  BufferGeometry,
  Group,
  Mesh,
  Quaternion,
  Raycaster,
  Sphere,
  Vector2,
  Vector3,
} from 'three'
import { typewriterSpec } from '@/lib/typewriter/machine'
import { solveFlatLay } from '@/lib/typewriter/layout'
import { evaluateTransform } from '@/lib/typewriter/pipeline'
import { createTypewriterMaterials } from '@/lib/typewriter/materials'
import { clearGeometryCache } from '@/lib/typewriter/geometry'
import { studyBridge } from '@/lib/typewriter/bridge'
import { BAR_REST_PITCH, BAR_STRIKE_PITCH } from '@/lib/typewriter/dim'
import { smoothstep } from '@/lib/typewriter/spec'
import { useTypewriterStore } from '@/stores/typewriter'

/**
 * 打字机模型：唯一拥有 572 个零件网格、材质与几何缓存的组件。
 * 逐帧应用三态变换与击发 envelope；通过 studyBridge 提供拾取/投影。
 */

const store = useTypewriterStore()
const { scene, camera, renderer } = useTres()

const spec = typewriterSpec()
const layout = solveFlatLay(spec.parts)
studyBridge.flatWidth = layout.width
studyBridge.flatDepth = layout.depth

const materialSet = createTypewriterMaterials()
const root = new Group()
root.name = 'typewriter-study'

interface PartNode {
  mesh: Mesh
  /** 击发位移/转角方式 */
  strikeKind: 'cap' | 'lever' | 'link' | 'typebar' | 'carriageReturn' | null
}
const nodes = new Map<string, PartNode>()
const pickMeshes: Mesh[] = []

// 显式击发表：partId → 动画方式
const strikeKinds = new Map<string, NonNullable<PartNode['strikeKind']>>()
for (const link of spec.strike.values()) {
  strikeKinds.set(link.cap, 'cap')
  strikeKinds.set(link.ring, 'cap')
  strikeKinds.set(link.lever, 'lever')
  strikeKinds.set(link.link, 'link')
  strikeKinds.set(link.typebar, 'typebar')
}
strikeKinds.set(spec.spaceStrike.cap, 'cap')
strikeKinds.set(spec.spaceStrike.ring, 'cap')
strikeKinds.set(spec.spaceStrike.lever, 'lever')
strikeKinds.set(spec.returnStrike.arm, 'carriageReturn')
strikeKinds.set(spec.returnStrike.handle, 'carriageReturn')

for (const part of spec.parts) {
  const geo: BufferGeometry = part.make()
  const mesh = new Mesh(geo, materialSet.materials[part.material])
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.name = part.id
  mesh.userData.partId = part.id
  mesh.rotation.order = 'YXZ'
  root.add(mesh)
  nodes.set(part.id, { mesh, strikeKind: strikeKinds.get(part.id) ?? null })
  pickMeshes.push(mesh)
}
scene.value?.add(root)

// ---- 击发 envelope ----
const STRIKE_MS = 360
const activeStrikes = new Map<string, number>()
let typedCount = 0

function envelope(t: number): number {
  if (t < 0.22) return smoothstep(t / 0.22)
  if (t < 0.45) return 1
  return 1 - smoothstep((t - 0.45) / 0.55)
}

watch(
  () => store.strikingChar,
  (char) => {
    if (!char) return
    const now = performance.now()
    if (char === '\n') {
      // 回车：扳杆动画 + 滑架回位
      activeStrikes.set(spec.returnStrike.arm, now)
      activeStrikes.set(spec.returnStrike.handle, now)
      typedCount = 0
      return
    }
    if (char === ' ') {
      const s = spec.spaceStrike
      activeStrikes.set(s.cap, now)
      activeStrikes.set(s.ring, now)
      activeStrikes.set(s.lever, now)
      if (studyBridge.displayedProgress < 0.03) typedCount += 1
      return
    }
    const link = spec.strike.get(char)
    if (!link) return
    for (const id of [link.cap, link.ring, link.lever, link.link, link.typebar])
      activeStrikes.set(id, now)
    if (studyBridge.displayedProgress < 0.03) typedCount += 1
  },
)
watch(
  () => store.resetCount,
  () => {
    typedCount = 0
  },
)

// ---- 拾取 ----
const raycaster = new Raycaster()
const ndc = new Vector2()
let hovered: string | null = null

function setHover(id: string | null) {
  if (hovered === id) return
  if (hovered) {
    const node = nodes.get(hovered)
    const part = spec.byId.get(hovered)
    if (node && part) node.mesh.material = materialSet.materials[part.material]
  }
  hovered = id
  if (id) {
    const node = nodes.get(id)
    const part = spec.byId.get(id)
    if (node && part) node.mesh.material = materialSet.highlight[part.material]
  }
  store.hover(id)
}

studyBridge.pick = (clientX, clientY) => {
  const dom = renderer.domElement
  const cam = camera.value
  if (!dom || !cam) return null
  const rect = dom.getBoundingClientRect()
  ndc.set(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1,
  )
  raycaster.setFromCamera(ndc, cam)
  raycaster.far = 60
  const hits = raycaster.intersectObjects(pickMeshes, false)
  return hits.length ? (hits[0]!.object.userData.partId as string) : null
}

const projV = new Vector3()
const box = new Box3()
const sphere = new Sphere()

studyBridge.screenPos = (id) => {
  const node = nodes.get(id)
  const dom = renderer.domElement
  const cam = camera.value
  if (!node || !dom || !cam) return null
  node.mesh.getWorldPosition(projV)
  projV.project(cam)
  const rect = dom.getBoundingClientRect()
  return {
    x: rect.left + ((projV.x + 1) / 2) * rect.width,
    y: rect.top + ((1 - projV.y) / 2) * rect.height,
  }
}

studyBridge.partWorld = (id) => {
  const node = nodes.get(id)
  if (!node) return null
  box.setFromObject(node.mesh)
  box.getBoundingSphere(sphere)
  return {
    center: [sphere.center.x, sphere.center.y, sphere.center.z],
    radius: Math.max(0.05, sphere.radius),
  }
}

// ---- 逐帧变换 ----
const { onBeforeRender } = useLoop()
const strikeQ = new Quaternion()
const axisX = new Vector3(1, 0, 0)
const axisZ = new Vector3(0, 0, 1)

onBeforeRender(({ delta }) => {
  // 播放推进
  if (store.playing) {
    const next = store.progress + delta * 0.11 * store.playDirection
    if (next >= 1 || next <= 0) store.playing = false
    store.progress = Math.min(1, Math.max(0, next))
  }
  // 平滑进度
  const target = store.progress
  const cur = studyBridge.displayedProgress
  const smoothed =
    Math.abs(target - cur) < 0.0004 ? target : cur + (target - cur) * Math.min(1, delta * 7.5)
  studyBridge.displayedProgress = smoothed

  const now = performance.now()
  // 清理完成击发
  for (const [id, t0] of activeStrikes) if (now - t0 > STRIKE_MS) activeStrikes.delete(id)
  if (activeStrikes.size === 0 && store.strikingChar) store.clearStrike()
  const anyStrike = activeStrikes.size > 0

  const carriageShift = -typedCount * 0.055 * (1 - smoothstep(Math.min(1, smoothed / 0.12)))

  for (const part of spec.parts) {
    const node = nodes.get(part.id)!
    const t = evaluateTransform(part, layout.placements.get(part.id), smoothed)
    const mesh = node.mesh
    let px = t.p[0]
    if (part.group === 'carriage' && carriageShift !== 0) px += carriageShift
    mesh.position.set(px, t.p[1], t.p[2])
    mesh.rotation.set(t.r[0], t.r[1], t.r[2])

    if (anyStrike) {
      const t0 = activeStrikes.get(part.id)
      if (t0 !== undefined) {
        const env = envelope((now - t0) / STRIKE_MS)
        if (node.strikeKind === 'cap') {
          mesh.position.y -= 0.05 * env
        } else if (node.strikeKind === 'lever') {
          strikeQ.setFromAxisAngle(axisX, 0.14 * env)
          mesh.quaternion.multiply(strikeQ)
        } else if (node.strikeKind === 'link') {
          mesh.position.y -= 0.055 * env
        } else if (node.strikeKind === 'typebar') {
          strikeQ.setFromAxisAngle(axisX, (BAR_STRIKE_PITCH - BAR_REST_PITCH) * env * -1)
          mesh.quaternion.multiply(strikeQ)
        } else if (node.strikeKind === 'carriageReturn') {
          strikeQ.setFromAxisAngle(axisZ, 0.28 * env)
          mesh.quaternion.multiply(strikeQ)
        }
      }
    }
  }
})

// 悬停来自 TypewriterStudy 的 pointermove（节流后调用 setHover）
function applyHover(clientX: number, clientY: number) {
  setHover(studyBridge.pick(clientX, clientY))
}

onScopeDispose(() => {
  scene.value?.remove(root)
  setHover(null)
  studyBridge.pick = () => null
  studyBridge.screenPos = () => null
  studyBridge.partWorld = () => null
  materialSet.dispose()
  root.traverse((obj) => {
    if (obj instanceof Mesh) (obj.geometry as BufferGeometry).dispose()
  })
  clearGeometryCache()
})

defineExpose({ applyHover, setHover })
</script>

<template>
  <primitive :object="root" />
</template>

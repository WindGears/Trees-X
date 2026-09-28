<script setup lang="ts">
import { onScopeDispose, useTemplateRef, watch } from 'vue'
import { gsap } from 'gsap'
import { useTres } from '@tresjs/core'
import { OrbitControls } from '@tresjs/cientos'
import { MOUSE, Vector3 } from 'three'
import { useTypewriterStore } from '@/stores/typewriter'
import { studyBridge } from '@/lib/typewriter/bridge'
import { cameraPoseAt } from '@/lib/typewriter/pipeline'

const initialPos = new Vector3(3.6, 2.4, 4.4)
const initialLook = new Vector3(0, 0.62, 0.1)

/**
 * 相机装置：进度驱动的关键帧 + 检视聚焦 + 用户旋转/缩放增量。
 * 旋转仅右键/中键（左键留给拆解拖动），滚轮拆解由宿主层处理。
 */

const store = useTypewriterStore()
const controlsRef = useTemplateRef('controls')
const { camera, invalidate } = useTres()
const camTarget = new Vector3(0, 0.62, 0.1)
let camTween: gsap.core.Tween | undefined

function lerpCamera(pos: [number, number, number], look: [number, number, number], dur: number) {
  camTween?.kill()
  const c = camera.value
  if (!c) return
  const s = { x: c.position.x, y: c.position.y, z: c.position.z, tx: camTarget.x, ty: camTarget.y, tz: camTarget.z }
  camTween = gsap.to(s, {
    x: pos[0],
    y: pos[1],
    z: pos[2],
    tx: look[0],
    ty: look[1],
    tz: look[2],
    duration: dur,
    ease: 'power3.out',
    overwrite: true,
    onUpdate: () => {
      c.position.set(s.x, s.y, s.z)
      camTarget.set(s.tx, s.ty, s.tz)
      controlsRef.value?.instance?.target.copy(camTarget)
      controlsRef.value?.instance?.update()
      invalidate()
    },
  })
}

watch(
  () => store.progress,
  () => {
    if (store.selectedId) return
    const pose = cameraPoseAt(store.progress, studyBridge.flatWidth, studyBridge.flatDepth)
    lerpCamera(pose.position, pose.target, 0.65)
  },
)

watch(
  () => store.selectedId,
  (id) => {
    if (!id) {
      const pose = cameraPoseAt(store.progress, studyBridge.flatWidth, studyBridge.flatDepth)
      lerpCamera(pose.position, pose.target, 0.55)
      return
    }
    const info = studyBridge.partWorld(id)
    if (!info) return
    const [cx, cy, cz] = info.center
    const r = Math.max(info.radius * 3.2, 0.5)
    const dir = new Vector3(cx - camTarget.x, cy - camTarget.y + 0.4, cz - camTarget.z).normalize()
    lerpCamera([cx + dir.x * r, cy + Math.abs(dir.y) * r + 0.22, cz + dir.z * r], [cx, cy, cz], 0.55)
  },
)

studyBridge.zoom = (factor) => {
  const c = camera.value
  if (!c) return
  const dir = c.position.clone().sub(camTarget)
  const len = Math.min(22, Math.max(1.2, dir.length() * factor))
  c.position.copy(camTarget).addScaledVector(dir.normalize(), len)
  controlsRef.value?.instance?.update()
  invalidate()
}
studyBridge.resetCamera = () => {
  const pose = cameraPoseAt(store.progress, studyBridge.flatWidth, studyBridge.flatDepth)
  lerpCamera(pose.position, pose.target, 0.6)
}

onScopeDispose(() => {
  camTween?.kill()
  studyBridge.zoom = () => {}
  studyBridge.resetCamera = () => {}
})
</script>

<template>
  <TresPerspectiveCamera
    :position="initialPos"
    :fov="34"
    :near="0.05"
    :far="80"
    :look-at="initialLook"
  />
  <OrbitControls
    ref="controls"
    make-default
    :enable-damping="false"
    :enable-pan="false"
    :enable-zoom="false"
    :min-distance="1.2"
    :max-distance="22"
    :min-polar-angle="0.08"
    :max-polar-angle="2.9"
    :rotate-speed="0.6"
    :mouse-buttons="{ LEFT: undefined, MIDDLE: MOUSE.ROTATE, RIGHT: MOUSE.ROTATE }"
    @change="invalidate"
  />
</template>

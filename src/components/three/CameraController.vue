<script setup lang="ts">
import { inject, nextTick, onScopeDispose, toRef, useTemplateRef, watch } from 'vue'
import { gestureKey } from '@/lib/gesture/bridge'
import { useTres } from '@tresjs/core'
import { OrbitControls } from '@tresjs/cientos'
import { Vector3 } from 'three'
import { gsap } from 'gsap'
import { useProductStore } from '@/stores/product'
import { useAnimation } from '@/composables/useAnimation'
import { useGestureMotion } from '@/composables/useGestureMotion'
import { useProductFilm } from '@/composables/useProductFilm'

const props = defineProps<{ active: boolean; reducedMotion: boolean }>()
const store = useProductStore()
const bridge = inject(gestureKey)!
bridge.rotate = (delta) => {
  if (!delta || !props.active || bridge.owner.value !== 'gesture' || !camera.value) return
  const position = camera.value.position
  const angle = Math.atan2(position.x - orbitTarget.x, position.z - orbitTarget.z) - delta
  const radius = Math.hypot(position.x - orbitTarget.x, position.z - orbitTarget.z)
  position.x = orbitTarget.x + Math.sin(angle) * radius
  position.z = orbitTarget.z + Math.cos(angle) * radius
  controls.value?.instance?.update()
  invalidate()
}
const controls = useTemplateRef('controls')
const { camera, invalidate } = useTres()
const { run } = useAnimation()
let tween: gsap.core.Tween | undefined
const presets = {
  perspective: new Vector3(3.5, 2.2, 6.8),
  front: new Vector3(0, 0.1, 6.45),
  back: new Vector3(0, 0.35, -6.45),
  structure: new Vector3(4.6, 2.5, 6.5),
}
const destination = new Vector3()
const orbitTarget = new Vector3()
const origin = new Vector3()
const initialPosition = new Vector3(3.5, 1.65, 5.2)
bridge.getOrbitAngle = () =>
  camera.value
    ? Math.atan2(camera.value.position.x - orbitTarget.x, camera.value.position.z - orbitTarget.z)
    : 0
useGestureMotion(toRef(props, 'active'), toRef(props, 'reducedMotion'), bridge)

function stop() {
  tween?.kill()
  if (bridge.owner.value === 'animation') bridge.owner.value = 'mouse'
}
useProductFilm(
  bridge,
  {
    camera: () => camera.value,
    controls: () => controls.value?.instance ?? undefined,
    target: orbitTarget,
    invalidate,
    stopCamera: stop,
  },
  toRef(props, 'active'),
  toRef(props, 'reducedMotion'),
)
watch(
  bridge.owner,
  (owner) => {
    if (owner !== 'animation') {
      stop()
      if (owner === 'gesture') store.guideStep = null
    }
  },
  { flush: 'sync' },
)
function moveTo(target: Vector3, lookAt = orbitTarget, immediate = false) {
  bridge.stopFilm()
  const instance = camera.value
  if (!instance) return
  const resumeGesture =
    bridge.owner.value === 'gesture' &&
    bridge.mode.value === 'select' &&
    bridge.sessionRunning.value
  stop()
  bridge.settleVisual()
  bridge.reset(true)
  bridge.owner.value = 'animation'
  const inputRevision = bridge.inputRevision
  const pose = {
    x: instance.position.x,
    y: instance.position.y,
    z: instance.position.z,
    tx: orbitTarget.x,
    ty: orbitTarget.y,
    tz: orbitTarget.z,
  }
  run(() => {
    tween = gsap.to(pose, {
      x: target.x,
      y: target.y,
      z: target.z,
      tx: lookAt.x,
      ty: lookAt.y,
      tz: lookAt.z,
      duration: props.reducedMotion || immediate ? 0 : 0.8,
      ease: 'power3.out',
      overwrite: true,
      onComplete: () => {
        tween = undefined
        if (bridge.owner.value !== 'animation') return
        const resume =
          resumeGesture &&
          inputRevision === bridge.inputRevision &&
          props.active &&
          bridge.sessionRunning.value
        bridge.reset(true)
        bridge.owner.value = resume ? 'gesture' : 'mouse'
      },
      onUpdate: () => {
        instance.position.set(pose.x, pose.y, pose.z)
        orbitTarget.set(pose.tx, pose.ty, pose.tz)
        controls.value?.instance?.target.copy(orbitTarget)
        controls.value?.instance?.update()
        bridge.publishMotion(0, bridge.getOrbitAngle())
        invalidate()
      },
    })
  })
}
watch(
  () => [store.viewRequest, store.status],
  async (current, previous) => {
    if (store.status !== 'ready') return
    await nextTick()
    if (store.viewPreset === 'detail') {
      bridge.settleModel()
      const point = bridge.getFocusPoint()
      const part = store.activePart
      if (!point || !part) return
      const target = new Vector3(point.x, point.y, point.z)
      destination.copy(target).add(new Vector3(...part.cameraOffset))
      moveTo(destination, target)
    } else {
      const custom = store.product.camera?.[store.viewPreset]
      const position = custom && (Array.isArray(custom) ? custom : custom.position)
      const target = custom && !Array.isArray(custom) ? custom.target : undefined
      origin.set(...(target ?? [0, 0, 0]))
      moveTo(
        position ? destination.set(...position) : presets[store.viewPreset],
        origin,
        current[1] !== previous[1],
      )
    }
  },
  { flush: 'post' },
)
watch(
  () => store.zoomRequest,
  () => {
    if (!camera.value) return
    destination.copy(camera.value.position).sub(orbitTarget)
    const distance = Math.min(
      store.product.zoomRange?.[1] ?? 9,
      Math.max(
        store.product.zoomRange?.[0] ?? 2,
        destination.length() * (store.zoomDirection > 0 ? 0.82 : 1.22),
      ),
    )
    destination.setLength(distance)
    destination.add(orbitTarget)
    moveTo(destination)
  },
)
watch(
  () => props.active,
  (active) => {
    if (!active) stop()
    else invalidate()
  },
)
watch(
  () => props.reducedMotion,
  (reduced) => {
    if (reduced) tween?.progress(1)
  },
)
onScopeDispose(stop)
onScopeDispose(() => {
  bridge.rotate = () => {}
  bridge.getOrbitAngle = () => 0
})
function takeMouse() {
  stop()
  store.guideStep = null
  bridge.takeMouse()
}
</script>

<template>
  <TresPerspectiveCamera
    :position="initialPosition"
    :fov="34"
    :near="0.1"
    :far="40"
    :look-at="[0, 0, 0]"
  />
  <OrbitControls
    ref="controls"
    make-default
    :enabled="active"
    :enable-damping="false"
    :enable-pan="false"
    :enable-zoom="true"
    :min-distance="store.product.zoomRange?.[0] ?? 2"
    :max-distance="store.product.zoomRange?.[1] ?? 9"
    :min-polar-angle="0.35"
    :max-polar-angle="2.55"
    :rotate-speed="0.65"
    @change="invalidate"
    @start="takeMouse"
  />
</template>

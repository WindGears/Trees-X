<script setup lang="ts">
import { inject, markRaw, onScopeDispose } from 'vue'
import { useLoop, useTres } from '@tresjs/core'
import { RectAreaLight, Group } from 'three'
import { acquireRectAreaUniforms } from '@/lib/three/rectAreaUniforms'
import { gestureKey } from '@/lib/gesture/bridge'
import { gsap } from 'gsap'

const releaseUniforms = acquireRectAreaUniforms()
const bridge = inject(gestureKey)!
const { invalidate } = useTres()
const group = markRaw(new Group())
const key = new RectAreaLight('#e7efff', 3.2, 2, 5)
const edge = new RectAreaLight('#fff0d7', 5, 0.65, 4)
const ceiling = new RectAreaLight('#ffffff', 1.5, 4, 2)
key.position.set(-3, 2, 3)
edge.position.set(3, 1.3, -1.3)
ceiling.position.set(0, 5, 0.5)
for (const light of [key, edge, ceiling]) {
  light.lookAt(0, 0.3, 0)
  group.add(light)
}
const state = { reveal: 1 }
let timeline: gsap.core.Tween | undefined
const settle = () => {
  timeline?.kill()
  state.reveal = 1
  invalidate()
}
const unregister = bridge.registerVisual(settle, () => {
  settle()
  state.reveal = 0.08
  timeline = gsap.to(state, { reveal: 1, duration: 2.1, ease: 'power2.out', onUpdate: invalidate })
})
useLoop().onBeforeRender(() => {
  key.position.x = -3 + bridge.filmLighting.sweep * 1.8
  key.lookAt(0, 0.3, 0)
  key.intensity = 3.2 * state.reveal
  edge.intensity = 5 * (0.6 + state.reveal * 0.4)
})
onScopeDispose(() => {
  unregister()
  timeline?.kill()
  group.clear()
  group.removeFromParent()
  for (const light of [key, edge, ceiling]) light.dispose()
  releaseUniforms()
})
</script>
<template><primitive :object="group" :dispose="null" /></template>

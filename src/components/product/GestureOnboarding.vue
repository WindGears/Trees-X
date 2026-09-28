<script setup lang="ts">
import { inject, onScopeDispose, ref, useTemplateRef, watch } from 'vue'
import { Hand } from '@lucide/vue'
import { gsap } from 'gsap'
import { Button } from '@/components/ui/button'
import { gestureKey } from '@/lib/gesture/bridge'
import { useProductStore } from '@/stores/product'

const props = defineProps<{ running: boolean; tracked: boolean }>()
const store = useProductStore()
const bridge = inject(gestureKey)!
const skipped = ref(false)
const step = ref(0)
const demonstration = useTemplateRef('demonstration')
let angleStart: number | undefined
let tween: gsap.core.Tween | undefined
watch(
  () => props.tracked,
  (tracked) => {
    if (props.running && tracked && step.value === 0) {
      step.value = 1
      angleStart = bridge.getOrbitAngle()
    }
  },
)
const unobserve = bridge.observeMotion((_velocity, angle) => {
  if (
    step.value === 1 &&
    props.tracked &&
    bridge.owner.value === 'gesture' &&
    angleStart !== undefined &&
    Math.abs(Math.atan2(Math.sin(angle - angleStart), Math.cos(angle - angleStart))) > 0.12
  )
    step.value = 2
})
watch(bridge.phase, (phase) => {
  if (props.running && step.value === 2 && phase === 'confirmed') step.value = 3
})
watch(
  () => [store.panel, props.running, skipped.value],
  () => {
    tween?.kill()
    const hand = demonstration.value?.querySelector('svg')
    if (!hand) return
    gsap.set(hand, { x: 0, rotation: 0 })
    if (
      !['gesture', 'console'].includes(store.panel ?? '') ||
      props.running ||
      skipped.value ||
      matchMedia('(prefers-reduced-motion: reduce)').matches
    )
      return
    tween = gsap.fromTo(
      hand,
      { x: -36, rotation: -8 },
      { x: 36, rotation: 8, duration: 1.7, yoyo: true, repeat: -1, ease: 'sine.inOut' },
    )
  },
  { flush: 'post' },
)
function selectMode() {
  bridge.confirmation.value = 'dwell'
  bridge.mode.value = 'select'
  bridge.owner.value = 'gesture'
  bridge.reset()
}
onScopeDispose(() => {
  unobserve()
  tween?.kill()
})
</script>
<template>
  <div v-if="!skipped" class="gesture-onboarding">
    <template v-if="!running">
      <div ref="demonstration" class="gesture-demonstration" aria-hidden="true">
        <span class="gesture-demo-track"></span><Hand :size="64" />
      </div>
      <p>张开一只手，缓缓左右移动。想选择细节时，将指针停在目标上，等圆环走完。</p>
      <Button variant="ghost" @click="skipped = true">跳过动作示范</Button>
    </template>
    <div v-else class="gesture-coach" aria-label="手势初次引导" :data-onboarding-step="step">
      <ol>
        <li :class="{ current: step === 0, completed: step > 0 }">将一只手放入取景框</li>
        <li :class="{ current: step === 1, completed: step > 1 }">左右移动，转动商品</li>
        <li :class="{ current: step === 2, completed: step > 2 }">悬停片刻，确认一个目标</li>
      </ol>
      <Button
        v-if="step === 2 && bridge.mode.value !== 'select'"
        variant="outline"
        @click="selectMode"
        >试试悬停确认</Button
      >
      <p v-if="step === 3" role="status">已经学会了。现在可以自由探索。</p>
      <Button variant="ghost" @click="skipped = true">{{
        step === 3 ? '完成引导' : '跳过引导'
      }}</Button>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  watch,
  inject,
  isRef,
  nextTick,
  onMounted,
  onScopeDispose,
  onUnmounted,
  useTemplateRef,
} from 'vue'
import {
  BloomPmndrs,
  ChromaticAberrationPmndrs,
  EffectComposerPmndrs,
  ToneMappingPmndrs,
  VignettePmndrs,
} from '@tresjs/post-processing'
import { gsap } from 'gsap'
import { HalfFloatType, Vector2, WebGLRenderer } from 'three'
import type { ShallowRef } from 'vue'
import type { BloomEffect, ChromaticAberrationEffect } from 'postprocessing'
import { ToneMappingMode } from 'postprocessing'
import { useTres, useTresContext } from '@tresjs/core'
import { gestureKey } from '@/lib/gesture/bridge'
import { useProductStore } from '@/stores/product'
import { acquireComposerHandoff } from '@/lib/three/renderHandoff'

defineProps<{ resolutionScale: number; multisampling: number }>()
const emit = defineEmits<{ ready: [] }>()
type ExposedValue<T> = T | ShallowRef<T | null> | null
type EffectHandle<T> = { effect: ExposedValue<T> }
const bridge = inject(gestureKey)!
const store = useProductStore()
const { invalidate } = useTres()
const context = useTresContext()
if (context.renderer.instance instanceof WebGLRenderer) {
  const release = acquireComposerHandoff(
    {
      instance: context.renderer.instance,
      replaceRenderFunction: context.renderer.replaceRenderFunction,
    },
    () => context.scene.value,
    () => context.camera.activeCamera.value,
    invalidate,
  )
  onUnmounted(release)
}
const bloomHandle = useTemplateRef<EffectHandle<BloomEffect>>('bloom')
const chromaticHandle = useTemplateRef<EffectHandle<ChromaticAberrationEffect>>('chromatic')
const initialOffset = new Vector2(0, 0)
const state = { bloom: store.stage.bloom, aberration: 0 }
let timeline: gsap.core.Timeline | undefined

function resolve<T>(value: ExposedValue<T> | undefined): T | null {
  return isRef(value) ? value.value : (value ?? null)
}
function apply() {
  const bloom = resolve(bloomHandle.value?.effect)
  const chromatic = resolve(chromaticHandle.value?.effect)
  if (bloom) bloom.intensity = state.bloom
  if (chromatic) chromatic.offset.set(state.aberration, -state.aberration * 0.55)
  invalidate()
}
function settle() {
  timeline?.kill()
  timeline = undefined
  state.bloom = store.stage.bloom
  state.aberration = 0
  apply()
}
function replay() {
  timeline?.kill()
  state.bloom = store.stage.bloom
  state.aberration = 0.0055
  apply()
  timeline = gsap
    .timeline({ onUpdate: apply, onComplete: settle })
    .to(state, { bloom: store.stage.bloom + 0.7, duration: 0.55, ease: 'power2.out' }, 0.25)
    .to(state, { aberration: 0, duration: 1.2, ease: 'power2.out' }, 0)
    .to(state, { bloom: store.stage.bloom, duration: 1.05, ease: 'power2.inOut' }, 1.35)
}
watch(() => store.stage, settle)
const unregister = bridge.registerVisual(settle, replay)
onMounted(async () => {
  await nextTick()
  settle()
  emit('ready')
})
onScopeDispose(() => {
  unregister()
  timeline?.kill()
})
</script>

<template>
  <EffectComposerPmndrs
    :resolution-scale="resolutionScale"
    :multisampling="multisampling"
    :frame-buffer-type="HalfFloatType"
    disable-normal-pass
  >
    <BloomPmndrs
      ref="bloom"
      :intensity="store.stage.bloom"
      :luminance-threshold="0.98"
      :luminance-smoothing="0.06"
      mipmap-blur
    />
    <ChromaticAberrationPmndrs
      ref="chromatic"
      :offset="initialOffset"
      radial-modulation
      :modulation-offset="0.15"
    />
    <VignettePmndrs :offset="0.22" :darkness="0.58" />
    <ToneMappingPmndrs :mode="ToneMappingMode.ACES_FILMIC" />
  </EffectComposerPmndrs>
</template>

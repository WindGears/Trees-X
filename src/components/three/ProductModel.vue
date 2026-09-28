<script setup lang="ts">
import { computed, inject, onScopeDispose, ref, watch } from 'vue'
import { gsap } from 'gsap'
import { createModelPresentation } from '@/lib/three/presentation'
import { createSpeakerMaterials } from '@/lib/three/speakerMaterials'
import type { HologramOverlay } from '@/lib/three/hologram'
import { gestureKey } from '@/lib/gesture/bridge'
import { useLoop, useTres, useTresContext } from '@tresjs/core'
import type { Group } from 'three'
import { Box3, Mesh } from 'three'
import StageGround from './StageGround.vue'
import { useModelLoader } from '@/composables/useModelLoader'
import { useProductStore } from '@/stores/product'
import ModelHotspot from './ModelHotspot.vue'
import type { ModelEvent, ModelSelection } from '@/lib/three/modelSelection'

const props = defineProps<{
  selection: ModelSelection
  active: boolean
  reducedMotion: boolean
  cinematic: boolean
}>()
const emit = defineEmits<{
  state: [event: ModelEvent]
}>()
const selection = props.selection
const floorY = ref(-1.4)
const current = () =>
  store.product.id === selection.product.id && store.selectionRevision === selection.revision
const publish = (event: Omit<ModelEvent, 'productId' | 'revision'>) =>
  emit('state', { productId: selection.product.id, revision: selection.revision, ...event })
const store = useProductStore()
const { invalidate, scene } = useTres()
const context = useTresContext()
const bridge = inject(gestureKey)!
let presentation: ReturnType<typeof createModelPresentation> | undefined
let tween: gsap.core.Tween | undefined
let hologram: HologramOverlay | undefined
let hologramTimeline: gsap.core.Timeline | undefined
let rootModel: Group | undefined
let hologramRevision = 0
const expansion = { progress: 0 }
let filmSettingExpansion = false
let disposeSurfaces: (() => void) | undefined
const hologramState = { scan: 3, outline: 0.08, opacity: 0.14 }

function applyHologram() {
  hologram?.setScan(hologramState.scan)
  hologram?.setOutline(hologramState.outline)
  hologram?.setOpacity(hologramState.opacity)
  invalidate()
}
function settleHologram() {
  hologramTimeline?.kill()
  hologramTimeline = undefined
  Object.assign(hologramState, { scan: 3, outline: 0.08, opacity: 0.14 })
  hologram?.setWireframe(false)
  applyHologram()
}
function replayHologram() {
  if (!hologram) return
  hologramTimeline?.kill()
  Object.assign(hologramState, { scan: -1.75, outline: 0, opacity: 0 })
  hologram.setWireframe(false)
  applyHologram()
  hologramTimeline = gsap
    .timeline({ onUpdate: applyHologram, onComplete: settleHologram })
    .to(hologramState, { opacity: 1, duration: 0.12, ease: 'power1.out' }, 0.25)
    .to(hologramState, { scan: 1.75, duration: 1.1, ease: 'power2.inOut' }, 0.25)
    .to(hologramState, { outline: 1, duration: 0.18, ease: 'power2.out' }, 0.9)
    .call(() => hologram?.setWireframe(true), [], 0.9)
    .call(() => hologram?.setWireframe(false), [], 1.12)
    .call(() => hologram?.setWireframe(true), [], 1.32)
    .call(() => hologram?.setWireframe(false), [], 1.52)
    .to(hologramState, { outline: 0.08, opacity: 0.14, duration: 0.6 }, 1.8)
}
function disposeHologram() {
  hologramTimeline?.kill()
  hologramTimeline = undefined
  hologram?.dispose()
  hologram = undefined
  publish({ visualReady: false })
}
async function syncHologram() {
  const request = ++hologramRevision
  disposeHologram()
  if (!props.cinematic || !rootModel) return
  if (selection.product.id === 'form-01') {
    publish({ visualReady: true })
    return
  }
  const { createHologramOverlay } = await import('@/lib/three/hologram')
  if (request !== hologramRevision || !props.cinematic || !rootModel) return
  hologram = createHologramOverlay(rootModel)
  settleHologram()
  publish({ visualReady: true })
}
const unregisterVisual = bridge.registerVisual(settleHologram, replayHologram)
const { model, status, error } = useModelLoader(
  computed(() => selection.product.modelUrl),
  (root) => {
    rootModel = root
    floorY.value = new Box3().setFromObject(root).min.y
    root.traverse((object) => {
      if (object instanceof Mesh) {
        object.castShadow = true
        object.receiveShadow = true
      }
    })
    root.userData.productId = selection.product.id
    root.userData.selectionRevision = selection.revision
    if (selection.product.id === 'form-01') disposeSurfaces = createSpeakerMaterials(root)
    presentation = createModelPresentation(root, selection.product)
    presentation.setFinish(store.activeFinish)
    expansion.progress = store.exploded ? 1 : 0
    presentation.setExpansion(expansion.progress)
    const settle = () => tween?.progress(1)
    bridge.settleModel = settle
    const getExpansion = () => expansion.progress
    const setExpansion = (progress: number) => {
      tween?.kill()
      expansion.progress = progress
      presentation?.setExpansion(progress)
      filmSettingExpansion = true
      if (store.exploded !== progress > 0.001) store.exploded = progress > 0.001
      filmSettingExpansion = false
    }
    bridge.getModelExpansion = getExpansion
    bridge.setModelExpansion = setExpansion
    void syncHologram()
    return () => {
      tween?.kill()
      tween = undefined
      if (bridge.settleModel === settle) bridge.settleModel = () => {}
      if (bridge.getModelExpansion === getExpansion) bridge.getModelExpansion = () => 0
      if (bridge.setModelExpansion === setExpansion) bridge.setModelExpansion = () => {}
      hologramRevision += 1
      disposeHologram()
      rootModel = undefined
      presentation?.dispose()
      presentation = undefined
      disposeSurfaces?.()
      disposeSurfaces = undefined
    }
  },
)
watch(
  () => store.activeFinish,
  (finish) => {
    if (!current()) return
    presentation?.setFinish(finish)
    invalidate()
  },
)
watch(
  () => store.exploded,
  (expanded) => {
    if (!current() || filmSettingExpansion) return
    tween?.kill()
    tween = gsap.to(expansion, {
      progress: expanded ? 1 : 0,
      duration: props.reducedMotion || !props.active ? 0 : 0.9,
      ease: 'power3.inOut',
      onUpdate: () => {
        presentation?.setExpansion(expansion.progress)
        invalidate()
      },
    })
  },
  { flush: 'sync' },
)
watch(
  () => [props.active, props.reducedMotion],
  () => {
    if (!props.active || props.reducedMotion) tween?.progress(1)
  },
)
watch(
  status,
  (value) => {
    if (value !== 'ready') publish({ status: value })
    invalidate()
  },
  { immediate: true },
)
let delivered = false
// Only renderer success makes the product interactive, never a completed fetch alone.
const rendered = context.renderer.onRender(() => {
  if (delivered || status.value !== 'ready' || !model.value || !current()) return
  if (scene.value.getObjectByProperty('uuid', model.value.uuid) !== model.value) return
  delivered = true
  const meshes: string[] = []
  model.value.traverse((object) => {
    if (object.type === 'Mesh' && !object.name.endsWith('_Hologram')) meshes.push(object.name)
  })
  publish({ status: 'ready', meshes })
})
useLoop().onBeforeRender(() => {
  if (model.value && !delivered) invalidate()
})
onScopeDispose(rendered.off)
watch(error, (message) => publish({ error: message }))
watch(() => props.cinematic, syncHologram)
onScopeDispose(() => {
  unregisterVisual()
  hologramRevision += 1
  disposeHologram()
})
</script>

<template>
  <primitive v-if="model" :object="model" :dispose="null" />
  <StageGround v-if="model" :floor-y="floorY" />
  <ModelHotspot v-if="model" :model="model" :selection="selection" />
</template>

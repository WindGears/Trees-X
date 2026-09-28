<script setup lang="ts">
import {
  computed,
  defineAsyncComponent,
  inject,
  nextTick,
  onErrorCaptured,
  onScopeDispose,
  ref,
  useTemplateRef,
  watch,
} from 'vue'
import { gestureKey } from '@/lib/gesture/bridge'
import { TresCanvas } from '@tresjs/core'
import { ACESFilmicToneMapping, NoToneMapping, SRGBColorSpace } from 'three'
import { Gauge, Move, RotateCcw, Sparkles } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import ViewerControls from '@/components/product/ViewerControls.vue'
import ViewerStatus from '@/components/product/ViewerStatus.vue'
import GestureMotionFeedback from '@/components/product/GestureMotionFeedback.vue'
import GestureSelectionOverlay from '@/components/product/GestureSelectionOverlay.vue'
import ProductModel from './ProductModel.vue'
import CameraController from './CameraController.vue'
import Environment from './Environment.vue'
import SceneRenderDriver from './SceneRenderDriver.vue'
import { isCurrentModel, type ModelEvent } from '@/lib/three/modelSelection'
import { useThreeScene } from '@/composables/useThreeScene'
import { useVisualPerformance } from '@/composables/useVisualPerformance'
import { useProductStore } from '@/stores/product'
import type { EnvironmentStatus } from './Environment.vue'

const Effects = defineAsyncComponent(() => import('./Effects.vue'))
const CyberStage = defineAsyncComponent(() => import('./CyberStage.vue'))
const emit = defineEmits<{
  availabilityChange: [available: boolean]
}>()

const store = useProductStore()
const bridge = inject(gestureKey)!
const host = useTemplateRef('host')
const {
  supported,
  active: visible,
  reducedMotion,
  pixelRatio,
  cinematicCapable,
} = useThreeScene(host)
const active = computed(() => visible.value && !store.catalogOpen)
const error = ref('')
const canvasError = ref(false)
const canvasKey = ref(0)
const selection = computed(() => ({ product: store.product, revision: store.selectionRevision }))
const renderedMeshes = ref<string[]>([])
function modelState(event: ModelEvent) {
  if (!isCurrentModel(event, store.product.id, store.selectionRevision)) return
  if (event.error !== undefined) error.value = event.error
  if (event.status) store.status = event.status
  if (event.visualReady !== undefined) modelVisualReady.value = event.visualReady
  if (event.meshes) renderedMeshes.value = event.meshes
}
watch(
  selection,
  () => {
    error.value = ''
    modelVisualReady.value = false
    renderedMeshes.value = []
    store.status = 'loading'
  },
  { flush: 'sync' },
)
const available = computed(
  () => supported.value === true && store.status === 'ready' && !canvasError.value,
)
const effectiveQuality = computed(() =>
  cinematicCapable.value && store.quality === 'cinematic' ? 'cinematic' : 'eco',
)
const cinematicActive = computed(
  () => effectiveQuality.value === 'cinematic' && active.value && !canvasError.value,
)
const { tier, report } = useVisualPerformance(cinematicActive)
const renderProfile = computed(() => ({
  resolutionScale: 1,
  particleCount: store.product.id === 'form-01' ? 0 : 1600,
  multisampling: 8,
}))
const environmentStatus = ref<EnvironmentStatus>('room')
const effectsReady = ref(false)
const stageReady = ref(false)
const modelVisualReady = ref(false)
const visualReady = computed(
  () => cinematicActive.value && effectsReady.value && stageReady.value && modelVisualReady.value,
)
const playedProducts = new Set<string>()
let canvas: HTMLCanvasElement | undefined
function handleContextLoss(event: Event) {
  event.preventDefault()
  canvasError.value = true
  error.value = '三维画面已中断，请重新打开场景。'
}
function attachCanvas() {
  canvas?.removeEventListener('webglcontextlost', handleContextLoss)
  canvas = host.value?.querySelector('canvas') ?? undefined
  canvas?.addEventListener('webglcontextlost', handleContextLoss)
}
function retry() {
  error.value = ''
  if (canvasError.value) {
    canvasError.value = false
    store.status = 'loading'
    canvasKey.value++
  } else store.selectionRevision++
}
function toggleQuality() {
  bridge.takeMouse()
  if (!cinematicCapable.value) return
  store.quality = store.quality === 'cinematic' ? 'eco' : 'cinematic'
}
function replayIntro() {
  bridge.takeMouse()
  store.replayVisualIntro()
}
function qualityLabel() {
  if (effectiveQuality.value === 'cinematic')
    return environmentStatus.value === 'hdr' ? '电影画质 · HDR' : '电影画质 · 基础反射'
  if (reducedMotion.value) return '基础画质 · 减弱动态'
  return '基础画质'
}
watch(
  [available, cinematicActive, effectsReady, stageReady, modelVisualReady],
  async ([isAvailable, isCinematic, effects, stage, model]) => {
    if (
      playedProducts.has(store.product.id) ||
      !isAvailable ||
      !isCinematic ||
      !effects ||
      !stage ||
      !model
    )
      return
    const id = store.product.id
    playedProducts.add(id)
    await nextTick()
    if (store.product.id !== id || !active.value) return
    store.replayVisualIntro()
  },
  { flush: 'post' },
)
watch(
  cinematicActive,
  (enabled) => {
    if (enabled) return
    effectsReady.value = false
    stageReady.value = false
    modelVisualReady.value = false
    bridge.settleVisual()
  },
  { flush: 'sync' },
)
watch(
  () => store.visualIntroRequest,
  () => bridge.replayVisual(),
)
watch(
  [available, active],
  ([ready, visible]) => {
    bridge.sceneActive.value = ready && visible
  },
  {
    immediate: true,
  },
)
watch(available, (value) => emit('availabilityChange', value), { immediate: true })
onErrorCaptured((cause) => {
  console.error('Product viewer error:', cause)
  canvasError.value = true
  error.value = '三维场景暂时无法打开，请重试。'
  return false
})
onScopeDispose(() => {
  canvas?.removeEventListener('webglcontextlost', handleContextLoss)
  bridge.settleVisual()
})
</script>

<template>
  <div ref="host" class="viewer-shell">
    <div
      class="product-viewer"
      :data-visual-quality="effectiveQuality"
      :data-product-id="store.product.id"
      :data-rendered-meshes="renderedMeshes.join('|')"
      :data-intro-state="bridge.visualPhase.value"
      :data-intro-request="store.visualIntroRequest"
      :data-environment="environmentStatus"
      :data-composer-count="cinematicActive && effectsReady ? 1 : 0"
      :data-particle-count="cinematicActive ? renderProfile.particleCount : 0"
      :data-performance-tier="tier"
      :data-frame-median="report?.median.toFixed(2)"
      :data-frame-p95="report?.p95.toFixed(2)"
      :aria-busy="store.status === 'loading' && supported !== false && !canvasError"
    >
      <div class="scene-topline">
        <span>{{ store.product.name }} <span class="scene-dot">·</span> 360° VIEW</span>
        <div class="scene-quality-actions">
          <Button
            v-if="visualReady"
            variant="ghost"
            size="sm"
            aria-label="重播视觉演出"
            @click="replayIntro"
          >
            <RotateCcw :size="13" aria-hidden="true" /> 重播演出
          </Button>
          <Button
            variant="ghost"
            size="sm"
            :disabled="!cinematicCapable"
            :aria-pressed="effectiveQuality === 'cinematic'"
            :title="cinematicCapable ? '切换视觉画质' : qualityLabel()"
            @click="toggleQuality"
          >
            <Sparkles v-if="effectiveQuality === 'cinematic'" :size="13" aria-hidden="true" />
            <Gauge v-else :size="13" aria-hidden="true" />
            {{ qualityLabel() }}
          </Button>
        </div>
      </div>
      <div
        class="canvas-host"
        role="group"
        :aria-label="`${store.product.label ?? '桌面音箱'}三维模型。${store.activeFinish.name}，当前${store.exploded ? '外观结构展开' : '完整外观'}，使用下方按钮探索。`"
        @pointerdown="bridge.takeMouse()"
      >
        <TresCanvas
          v-if="supported && !canvasError"
          :key="canvasKey"
          alpha
          shadows
          :clear-alpha="0"
          :antialias="effectiveQuality === 'eco'"
          :dpr="effectiveQuality === 'cinematic' ? pixelRatio * renderProfile.resolutionScale : 1"
          render-mode="on-demand"
          :tone-mapping="cinematicActive ? NoToneMapping : ACESFilmicToneMapping"
          :output-color-space="SRGBColorSpace"
          :tone-mapping-exposure="1"
          power-preference="high-performance"
          @ready="attachCanvas"
        >
          <SceneRenderDriver :active="active" :cinematic="cinematicActive" />
          <CameraController :active="active && available" :reduced-motion="reducedMotion" />
          <Environment :cinematic="cinematicActive" @status="environmentStatus = $event" />
          <CyberStage
            v-if="cinematicActive"
            :key="`stage-${renderProfile.particleCount}`"
            :particle-count="renderProfile.particleCount"
            @ready="stageReady = true"
          />
          <ProductModel
            :key="`${selection.product.id}-${selection.revision}`"
            :selection="selection"
            :active="active"
            :reduced-motion="reducedMotion"
            :cinematic="cinematicActive"
            @state="modelState"
          />
          <Effects
            v-if="cinematicActive"
            :key="`effects-${renderProfile.resolutionScale}-${renderProfile.multisampling}`"
            :resolution-scale="renderProfile.resolutionScale"
            :multisampling="renderProfile.multisampling"
            @ready="effectsReady = true"
          />
        </TresCanvas>
        <GestureSelectionOverlay :available="available && active" />
      </div>
      <ViewerStatus :supported="supported" :error="error" :available="available" @retry="retry" />
      <GestureMotionFeedback :active="available && active" />
      <div class="scene-bottom">
        <p class="interaction-hint"><Move :size="13" aria-hidden="true" /> 拖动旋转 · 滚轮缩放</p>
        <ViewerControls :available="available" />
        <p class="scene-note" role="status">
          {{
            store.exploded ? '外观结构示意 · 不含内部构造' : `${store.activeFinish.name} · 概念样品`
          }}
        </p>
      </div>
    </div>
  </div>
</template>

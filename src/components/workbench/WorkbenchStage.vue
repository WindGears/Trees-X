<script setup lang="ts">
import {
  computed,
  nextTick,
  onErrorCaptured,
  onMounted,
  onScopeDispose,
  ref,
  shallowRef,
} from 'vue'
import { TresCanvas, type RendererOptions } from '@tresjs/core'
import { ACESFilmicToneMapping, PCFShadowMap, SRGBColorSpace, Vector3 } from 'three'
import { useDocumentVisibility, useElementVisibility } from '@vueuse/core'
import { requestedBackend, recoveryBackend } from '@/lib/workbench/rendering/hostPolicy'
import type { RefinementStatus } from '@/lib/workbench/rendering/refinementTypes'
import WorkbenchRefinement from './WorkbenchRefinement.vue'
import { useWorkbenchStore } from '@/stores/workbench'
import { phaseLabels } from '@/lib/workbench/assetBundle'
import { supportsWebGL2 } from '@/lib/workbench/renderSupport'
import WorkbenchScene from './WorkbenchScene.vue'
import WorkbenchFallback from './WorkbenchFallback.vue'
import WorkbenchCallouts from './WorkbenchCallouts.vue'
import type { CameraSnapshot } from '@/lib/workbench/cameraCapture'
import type { PlaceCallout } from '@/lib/workbench/calloutProjection'
const props = defineProps<{
  preview?: boolean
  gallery?: boolean
  inspector?: boolean
  catalog?: boolean
}>()
const stageBackground = computed(() =>
  props.gallery ? '#e7e9e5' : (store.presentation?.stage?.background ?? '#151c25'),
)
const store = useWorkbenchStore()
const revision = ref(0),
  hostRevision = ref(0),
  stageElement = ref<HTMLElement>()
const sceneHost = ref<InstanceType<typeof WorkbenchScene>>()
const backend = ref(
  requestedBackend(
    window.location.search,
    'gpu' in navigator,
    matchMedia('(pointer: fine)').matches && window.innerWidth >= 1024,
  ),
)
if (backend.value === 'webgl' && !supportsWebGL2()) store.useContent('此设备暂时无法启用三维显示。')
const rendererFactory = shallowRef<RendererOptions['renderer']>()
const hostPrepared = ref(backend.value === 'webgl')
const refinement = shallowRef<RefinementStatus>()
const checkpoint = shallowRef<CameraSnapshot>()
const onScreen = useElementVisibility(stageElement)
let deviceRetries = 0,
  replacing = false,
  hostGeneration = 0,
  disposed = false
onScopeDispose(() => {
  disposed = true
  hostGeneration++
})
const notice = ref(
  new URLSearchParams(window.location.search).get('renderPipeline') === 'hybrid' &&
    backend.value === 'webgl'
    ? 'WebGL 兼容模式 · 此设备未启用 WebGPU'
    : '',
)
async function prepareHost(token = hostGeneration) {
  if (disposed || token !== hostGeneration) return
  if (backend.value === 'webgpu') {
    const { gpuRendererFactory } = await import('@/lib/workbench/rendering/rendererFactory')
    if (disposed || token !== hostGeneration) return
    rendererFactory.value = gpuRendererFactory(() => {
      if (!disposed && token === hostGeneration) void recoverDevice()
    })
  } else rendererFactory.value = undefined
  hostPrepared.value = true
}
async function replaceHost(next: 'webgpu' | 'webgl') {
  if (replacing || disposed) return
  replacing = true
  const token = ++hostGeneration
  hostPrepared.value = false
  await nextTick()
  if (disposed || token !== hostGeneration) return
  backend.value = next
  hostRevision.value++
  refinement.value = undefined
  if (store.product) {
    store.status = 'loading'
    store.error = ''
  }
  try {
    await prepareHost(token)
  } finally {
    replacing = false
  }
}
async function recoverDevice() {
  checkpoint.value = sceneHost.value?.checkpoint()
  const next = recoveryBackend(backend.value, deviceRetries++)
  if (next === 'webgl') notice.value = 'WebGL 兼容模式 · WebGPU 设备未能恢复'
  await replaceHost(next)
}
defineExpose({ hybrid: { snapshot: () => sceneHost.value?.hybrid.snapshot() } })
function reportRefinement(status: RefinementStatus) {
  if (!status.slug || (status.slug === store.slug && status.revision === store.revision))
    refinement.value = status
}
onMounted(() => {
  void prepareHost().catch(rendererFailed)
})
const visibility = useDocumentVisibility()
const active = computed(() => visibility.value === 'visible' && onScreen.value)
const dpr = Math.min(window.devicePixelRatio || 1, 2)
const initialCamera = new Vector3(3.5, 2.3, 5)
const callouts = ref<InstanceType<typeof WorkbenchCallouts>>()
const visibleParts = computed(() => {
  const parts = store.presentation?.hotspots ?? []
  const selected = parts.find((part) => part.id === store.selectedPart)
  const markers = parts.filter((part) => part.marker !== false && part !== selected)
  return selected ? [selected, ...markers.slice(0, 11)] : markers.slice(0, 12)
})
const place: PlaceCallout = (...values) => callouts.value?.place(...values)
function commit() {
  callouts.value?.commit()
}
function restore(snapshot?: CameraSnapshot) {
  checkpoint.value = snapshot
  store.status = 'loading'
  store.error = ''
  revision.value++
}
function focus(id: string) {
  store.focus(id)
  store.panel = 'details'
}
function key(event: KeyboardEvent) {
  if (
    !store.available ||
    event.target !== event.currentTarget ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey
  )
    return
  switch (event.key) {
    case 'ArrowLeft':
      store.orbit('horizontal', 1)
      break
    case 'ArrowRight':
      store.orbit('horizontal', -1)
      break
    case 'ArrowUp':
      store.orbit('vertical', -1)
      break
    case 'ArrowDown':
      store.orbit('vertical', 1)
      break
    case '+':
    case '=':
      store.zoom(1)
      break
    case '-':
    case '_':
      store.zoom(-1)
      break
    case 'Home':
      store.view()
      break
    default:
      return
  }
  event.preventDefault()
}
function rendererFailed() {
  if (disposed) return
  if (backend.value === 'webgpu') {
    notice.value = 'WebGL 兼容模式 · WebGPU 启动失败'
    void replaceHost('webgl')
    return
  }
  store.useContent('三维显示启动失败，已保留商品图文。')
}
onErrorCaptured(() => {
  rendererFailed()
  return false
})
</script>

<template>
  <div
    ref="stageElement"
    class="wb-stage"
    :data-render-backend="backend"
    :data-refinement-phase="refinement?.phase ?? 'raster'"
    :data-scene-status="store.status"
    :data-product="store.product?.slug ?? ''"
    :tabindex="store.available ? 0 : -1"
    role="group"
    aria-label="商品展示区"
    :aria-describedby="store.available ? 'wb-keyboard-hint' : undefined"
    @keydown="key"
  >
    <WorkbenchFallback v-if="store.contentOnly && store.status === 'content'" />
    <TresCanvas
      v-if="!store.contentOnly && hostPrepared"
      :key="hostRevision"
      :renderer="rendererFactory"
      :clear-color="stageBackground"
      :antialias="true"
      :dpr="dpr"
      shadows
      :shadow-map-type="PCFShadowMap"
      render-mode="on-demand"
      :tone-mapping="ACESFilmicToneMapping"
      :tone-mapping-exposure="1.1"
      :output-color-space="SRGBColorSpace"
      @error="rendererFailed"
    >
      <TresPerspectiveCamera :position="initialCamera" :fov="38" :near="0.05" :far="250" />
      <WorkbenchScene
        :key="revision"
        ref="sceneHost"
        :active="active"
        :place="place"
        :commit="commit"
        :gallery="gallery"
        :inspector="inspector"
        :catalog="catalog"
        :checkpoint="checkpoint"
        @restore="restore"
        @refinement="reportRefinement"
      />
    </TresCanvas>
    <WorkbenchRefinement
      v-if="store.available"
      :status="backend === 'webgpu' ? refinement : undefined"
      :notice="notice"
      @retry="sceneHost?.retry()"
      @refine="sceneHost?.refine()"
      @realtime="sceneHost?.realtime($event)"
    />
    <p v-if="store.available" id="wb-keyboard-hint" class="wb-keyboard-hint">
      方向键旋转 · + / − 缩放 · Home 复位视角 · Tab 前往工具
    </p>
    <WorkbenchCallouts
      v-if="store.available"
      :key="`${store.slug}:${store.revision}:${revision}`"
      ref="callouts"
      :parts="visibleParts"
      :selected="store.selectedPart"
      :active="active"
      :details="store.panel === 'details'"
      :background="stageBackground"
      @focus="focus"
    />
    <div
      v-if="store.status === 'loading' || store.status === 'error'"
      class="wb-stage-status"
      :role="store.status === 'error' ? 'alert' : 'status'"
    >
      <h2>{{ store.status === 'error' ? '暂时无法展示' : '正在准备商品' }}</h2>
      <p>{{ store.status === 'error' ? store.error : phaseLabels[store.loadPhase] }}</p>
      <div v-if="store.status === 'error'" class="wb-inline-actions">
        <button type="button" @click="store.retry()">重新加载</button>
        <button v-if="!preview" type="button" @click="store.panel = 'catalog'">打开目录</button>
      </div>
    </div>
  </div>
</template>

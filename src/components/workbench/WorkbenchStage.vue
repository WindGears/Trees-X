<script setup lang="ts">
import { computed, onErrorCaptured, ref, shallowRef } from 'vue'
import { TresCanvas } from '@tresjs/core'
import { ACESFilmicToneMapping, PCFShadowMap, SRGBColorSpace, Vector3 } from 'three'
import { useDocumentVisibility, useElementVisibility } from '@vueuse/core'
import { useWorkbenchRenderHost } from '@/composables/useWorkbenchRenderHost'
import type { RealtimeStatus } from '@/lib/workbench/rendering/realtime/types'
import WorkbenchRealtimeStatus from './WorkbenchRealtimeStatus.vue'
import WorkbenchStudioMood from './WorkbenchStudioMood.vue'
import type { StudioEnvironmentStatus } from '@/lib/workbench/studio/mood'
import type { RefinementStatus } from '@/lib/workbench/rendering/refinementTypes'
import WorkbenchRefinement from './WorkbenchRefinement.vue'
import { useWorkbenchStore } from '@/stores/workbench'
import { phaseLabels } from '@/lib/workbench/assetBundle'
import WorkbenchScene from './WorkbenchScene.vue'
import WorkbenchFallback from './WorkbenchFallback.vue'
import WorkbenchCallouts from './WorkbenchCallouts.vue'
import type { CameraSnapshot } from '@/lib/workbench/cameraCapture'
import type { PlaceCallout } from '@/lib/workbench/calloutProjection'
import { hasTypewriterStudio } from '@/lib/workbench/studioPreset'
import { resolveStudioPalette, studioPalettes } from '@/lib/workbench/studio/palette'
const props = defineProps<{
  preview?: boolean
  gallery?: boolean
  inspector?: boolean
  catalog?: boolean
}>()
const store = useWorkbenchStore()
const revision = ref(0),
  stageElement = ref<HTMLElement>()
const sceneHost = ref<InstanceType<typeof WorkbenchScene>>()
const onScreen = useElementVisibility(stageElement)
const {
  backend,
  rendererFactory,
  hostPrepared,
  hostRevision,
  checkpoint,
  notice,
  rendererFailed,
  realtimeRequest,
} = useWorkbenchRenderHost(() => sceneHost.value?.checkpoint())
const studioMood = ref<'light' | 'dark'>(resolveStudioPalette(true).mood)
const supportsStudioMood = computed(
  () => hasTypewriterStudio(store.presentation) && backend.value === 'webgpu' && realtimeRequest,
)
const studioPalette = computed(() =>
  supportsStudioMood.value ? studioPalettes[studioMood.value] : undefined,
)
const stageBackground = computed(
  () =>
    (coldShowroom.value ? '#15171a' : undefined) ??
    studioPalette.value?.background ??
    (props.gallery ? '#e7e9e5' : (store.presentation?.stage?.background ?? '#151c25')),
)
const refinement = shallowRef<RefinementStatus>()
const lighting = shallowRef<RealtimeStatus>()
const coldShowroom = computed(
  () =>
    backend.value === 'webgpu' &&
    store.presentation?.source.kind === 'glb' &&
    store.presentation.source.adapter === 'reventon-v1' &&
    Boolean(lighting.value?.showroom),
)
const studioEnvironment = shallowRef<StudioEnvironmentStatus>({ phase: 'idle' })
function changeStudioMood(mood: 'light' | 'dark') {
  if (mood === studioMood.value && studioEnvironment.value.phase === 'error')
    sceneHost.value?.retryStudioEnvironment()
  else studioMood.value = mood
}
defineExpose({
  hybrid: { snapshot: () => sceneHost.value?.hybrid.snapshot() },
  realLighting: {
    snapshot: () => sceneHost.value?.realLighting.snapshot(),
    setSignals: (ssr: boolean, ssgi: boolean, denoise: boolean) =>
      sceneHost.value?.realLighting.setSignals(ssr, ssgi, denoise),
  },
})
function reportRefinement(status: RefinementStatus) {
  if (!status.slug || (status.slug === store.slug && status.revision === store.revision))
    refinement.value = status
}
function reportLighting(status: RealtimeStatus) {
  if (!status.slug || (status.slug === store.slug && status.revision === store.revision))
    lighting.value = status
}
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
    :data-studio-mood="studioPalette?.mood"
    :data-car-showroom="coldShowroom ? 'cold-studio' : undefined"
    :data-studio-environment="supportsStudioMood ? studioEnvironment.phase : undefined"
    :data-lighting-phase="lighting?.phase"
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
        :realtime-pipeline="realtimeRequest"
        :studio-mood="studioMood"
        @restore="restore"
        @refinement="reportRefinement"
        @lighting="reportLighting"
        @studio-environment="studioEnvironment = $event"
      />
    </TresCanvas>
    <WorkbenchStudioMood
      v-if="supportsStudioMood"
      :mood="studioMood"
      :status="studioEnvironment"
      :disabled="!store.available"
      @change="changeStudioMood"
    />
    <WorkbenchRealtimeStatus
      v-if="store.available && realtimeRequest"
      :status="backend === 'webgpu' ? lighting : undefined"
      :notice="notice"
    />
    <WorkbenchRefinement
      v-if="store.available && !realtimeRequest"
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

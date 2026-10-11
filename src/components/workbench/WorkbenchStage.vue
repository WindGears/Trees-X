<script setup lang="ts">
import { computed, onErrorCaptured, ref } from 'vue'
import { TresCanvas } from '@tresjs/core'
import { ACESFilmicToneMapping, PCFShadowMap, SRGBColorSpace, Vector3 } from 'three'
import { useDocumentVisibility } from '@vueuse/core'
import { useWorkbenchStore } from '@/stores/workbench'
import { phaseLabels } from '@/lib/workbench/assetBundle'
import { supportsWebGL2 } from '@/lib/workbench/renderSupport'
import WorkbenchScene from './WorkbenchScene.vue'
import WorkbenchFallback from './WorkbenchFallback.vue'
import WorkbenchCallouts from './WorkbenchCallouts.vue'
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
if (!supportsWebGL2()) store.useContent('此设备暂时无法启用三维显示。')
const revision = ref(0)
const visibility = useDocumentVisibility()
const active = computed(() => visibility.value === 'visible')
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
function restore() {
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
  store.useContent('三维显示启动失败，已保留商品图文。')
}
onErrorCaptured(() => {
  rendererFailed()
  return false
})
</script>

<template>
  <div
    class="wb-stage"
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
      v-if="!store.contentOnly"
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
        :active="active"
        :place="place"
        :commit="commit"
        :gallery="gallery"
        :inspector="inspector"
        :catalog="catalog"
        @restore="restore"
      />
    </TresCanvas>
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

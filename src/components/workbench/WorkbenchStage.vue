<script setup lang="ts">
import { computed, onErrorCaptured, ref, type ComponentPublicInstance } from 'vue'
import { TresCanvas } from '@tresjs/core'
import { ACESFilmicToneMapping, PCFShadowMap, SRGBColorSpace, Vector3 } from 'three'
import { useDocumentVisibility } from '@vueuse/core'
import { useWorkbenchStore } from '@/stores/workbench'
import { phaseLabels } from '@/lib/workbench/assetBundle'
import WorkbenchScene from './WorkbenchScene.vue'
const store = useWorkbenchStore()
const revision = ref(0)
const visibility = useDocumentVisibility()
const active = computed(() => visibility.value === 'visible')
const dpr = Math.min(window.devicePixelRatio || 1, 2)
const initialCamera = new Vector3(3.5, 2.3, 5)
const labels = new Map<string, HTMLElement>()
function bind(id: string, el: Element | ComponentPublicInstance | null) {
  if (el instanceof HTMLElement) labels.set(id, el)
  else labels.delete(id)
}
function place(id: string, x: number, y: number, visible: boolean) {
  const el = labels.get(id)
  if (!el) return
  el.style.transform = `translate(${Math.round(x)}px,${Math.round(y)}px)`
  el.hidden = !visible
}
function failed(message = '三维场景启动失败，请重试。') {
  store.failed(store.slug, store.revision, message)
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
onErrorCaptured(() => {
  failed()
  return false
})
</script>

<template>
  <div class="wb-stage" :data-scene-status="store.status" :data-product="store.product?.slug ?? ''">
    <TresCanvas
      clear-color="#151c25"
      :antialias="true"
      :dpr="dpr"
      shadows
      :shadow-map-type="PCFShadowMap"
      render-mode="on-demand"
      :tone-mapping="ACESFilmicToneMapping"
      :tone-mapping-exposure="1.1"
      :output-color-space="SRGBColorSpace"
      @error="failed()"
    >
      <TresPerspectiveCamera :position="initialCamera" :fov="38" :near="0.05" :far="250" />
      <WorkbenchScene :key="revision" :active="active" :place="place" @restore="restore" />
    </TresCanvas>
    <div v-if="store.available" class="wb-hotspots" aria-label="商品热点">
      <button
        v-for="part in store.presentation?.hotspots"
        :key="part.id"
        :ref="(el) => bind(part.id, el)"
        type="button"
        class="wb-hotspot"
        :aria-pressed="store.selectedPart === part.id"
        @click="focus(part.id)"
      >
        <span aria-hidden="true"></span>{{ part.name }}
      </button>
    </div>
    <div
      v-if="store.status !== 'ready'"
      class="wb-stage-status"
      :role="store.status === 'error' ? 'alert' : 'status'"
    >
      <h2>{{ store.status === 'error' ? '暂时无法展示' : '正在准备商品' }}</h2>
      <p>{{ store.status === 'error' ? store.error : phaseLabels[store.loadPhase] }}</p>
      <div v-if="store.status === 'error'" class="wb-inline-actions">
        <button type="button" @click="store.select(store.slug)">重新加载</button>
        <button type="button" @click="store.panel = 'catalog'">打开目录</button>
      </div>
    </div>
  </div>
</template>

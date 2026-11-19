<script setup lang="ts">
import { computed, nextTick, onMounted, onScopeDispose, ref, watch } from 'vue'
import { ArrowLeft, Grid2X2, Layers2, X } from '@lucide/vue'
import { useWorkbenchStore } from '@/stores/workbench'
import type { Panel } from '@/lib/workbench/types'
import {
  exhibitionHome,
  isLocalLink,
  type ExhibitionOverviewItem,
} from '@/lib/workbench/exhibition'
import { provideMotionSession } from '@/lib/workbench/motionSession'
import { createInterfaceMotion } from '@/lib/workbench/interfaceMotion'
import WorkbenchStage from './WorkbenchStage.vue'
import WorkbenchRail from './WorkbenchRail.vue'
import WorkbenchCatalog from './WorkbenchCatalog.vue'
import WorkbenchPanel from './WorkbenchPanel.vue'
import WorkbenchTools from './WorkbenchTools.vue'
import '@/assets/styles/workbench.css'
import '@/assets/styles/workbench-accessibility.css'
import '@/assets/styles/workbench-motion.css'
import '@/assets/styles/workbench-floating.css'
import '@/assets/styles/workbench-studio.css'
import '@/assets/styles/workbench-exhibition.css'

const props = defineProps<{ exhibits?: readonly ExhibitionOverviewItem[] }>()
const emit = defineEmits<{ overview: [] }>()
const store = useWorkbenchStore()
provideMotionSession(store)
const host = ref<HTMLElement>()
const motion = createInterfaceMotion()
const titles = {
  catalog: '商品目录',
  appearance: '外观',
  details: '细节',
  actions: '结构与动作',
  guide: '商品导览',
}
const title = computed(() => (store.panel ? titles[store.panel] : ''))
const inspector = computed(() => Boolean(store.panel && store.panel !== 'catalog'))
const exhibition = computed(() => props.exhibits !== undefined)
const target = computed(() => props.exhibits?.find((item) => item.slug === store.slug))
const name = computed(() => store.product?.name ?? target.value?.name)
const hasStructure = computed(
  () => store.presentation?.structure || Boolean(store.presentation?.actions.length),
)
let opener: HTMLElement | null = null
function close() {
  store.panel = null
  const target = opener?.isConnected
    ? opener
    : host.value?.querySelector<HTMLElement>('.wb-catalog-trigger, .wb-exhibition-switch select')
  target?.focus({ preventScroll: true })
}
function openPanel(panel: Panel) {
  if (store.panel === panel) {
    close()
    return
  }
  opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
  store.openPanel(panel)
  void nextTick(() => {
    if (store.panel === panel)
      host.value?.querySelector<HTMLElement>('.wb-panel-close')?.focus({ preventScroll: true })
  })
}
function select(slug: string) {
  if (slug === store.slug && (store.available || store.contentOnly)) {
    close()
    return
  }
  const url = new URL(location.href)
  url.searchParams.set('product', slug)
  url.searchParams.delete('legacy')
  history.pushState(null, '', url)
  void store.select(slug)
  void nextTick(() =>
    host.value
      ?.querySelector<HTMLElement>(`.wb-rail button[data-product="${CSS.escape(slug)}"]`)
      ?.focus({ preventScroll: true }),
  )
}
function read() {
  const slug = new URLSearchParams(location.search).get('product')
  if (slug || !exhibition.value) void store.select(slug || 'typewriter-study')
}
function switchExhibit(event: Event) {
  if (!(event.target instanceof HTMLSelectElement) || !event.target.value) return
  select(event.target.value)
  event.target.value = ''
}
function back(event: MouseEvent) {
  if (!isLocalLink(event)) return
  event.preventDefault()
  emit('overview')
}
function key(event: KeyboardEvent) {
  if (event.key === 'Escape' && store.panel) close()
}
watch(
  () => store.panel,
  (panel, previous) => {
    const target = document.activeElement
    if (
      panel &&
      target instanceof HTMLElement &&
      host.value?.contains(target) &&
      !target.closest('.wb-panel')
    )
      opener = target
    if (panel && previous && panel !== 'catalog' && previous !== 'catalog')
      void nextTick(() => {
        const body = host.value?.querySelector<HTMLElement>('#wb-inspector .wb-panel-body')
        if (body) {
          body.scrollTop = 0
          motion.replace(body)
        }
      })
  },
)
watch(
  () => store.product?.name,
  (name) => {
    document.title = name ? `${name} · Trees X` : 'Trees X · 三维商品工作台'
  },
  { immediate: true },
)
onMounted(() => {
  read()
  if (!exhibition.value) void store.loadCatalog()
  window.addEventListener('popstate', read)
  window.addEventListener('keydown', key)
})
onScopeDispose(() => {
  motion.dispose()
  store.dispose()
  window.removeEventListener('popstate', read)
  window.removeEventListener('keydown', key)
})
</script>
<template>
  <div
    ref="host"
    class="workbench wb-floating"
    :class="{ 'wb-exhibition': exhibition }"
    :data-status="store.status"
    :data-slug="store.slug"
  >
    <a class="skip-link" href="#wb-main">跳转到三维工作台</a>
    <header v-if="exhibition" class="wb-header wb-exhibition-header">
      <a class="wb-brand" :href="exhibitionHome" @click="back">Trees X</a>
      <a class="wb-exhibition-back" :href="exhibitionHome" @click="back">
        <ArrowLeft :size="16" />展厅总览
      </a>
      <h1 class="wb-exhibition-title">{{ name ?? '展品' }}</h1>
      <label v-if="exhibits?.length" class="wb-exhibition-switch">
        <span class="sr-only">切换展品</span>
        <select class="wb-exhibition-select" aria-label="切换展品" @change="switchExhibit">
          <option value="">切换展品</option>
          <option
            v-for="item in exhibits"
            :key="item.slug"
            :value="item.slug"
            :disabled="item.slug === store.slug"
          >
            {{ item.name }}
          </option>
        </select>
      </label>
    </header>
    <header v-else class="wb-header">
      <a class="wb-brand" href="/">Trees X<span>三维商品工作台</span></a>
      <div class="wb-header-actions">
        <span class="wb-current">{{ store.product?.name || '选择商品' }}</span>
        <button
          type="button"
          class="wb-catalog-trigger"
          :aria-expanded="store.panel === 'catalog'"
          aria-controls="wb-catalog"
          @click="openPanel('catalog')"
        >
          <Grid2X2 :size="17" />商品目录
        </button>
      </div>
    </header>
    <main
      id="wb-main"
      class="wb-layout"
      :class="{ 'with-catalog': store.panel === 'catalog', 'with-inspector': inspector }"
    >
      <section class="wb-view" aria-label="三维商品工作台">
        <WorkbenchStage
          gallery
          :exhibition="exhibition"
          :exhibit="target"
          :inspector="inspector"
          :catalog="store.panel === 'catalog'"
          @overview="emit('overview')"
        />
        <Transition
          :css="false"
          @enter="motion.enter"
          @leave="motion.leave"
          @enter-cancelled="motion.cancel"
          @leave-cancelled="motion.cancel"
        >
          <div
            v-if="
              store.product &&
              !store.contentOnly &&
              !store.selectedPart &&
              (!exhibition || store.available)
            "
            :key="store.product.slug"
            class="wb-intro"
          >
            <h1 v-if="!exhibition" id="wb-product-title">{{ store.product.name }}</h1>
            <button
              v-if="exhibition && hasStructure && store.available"
              class="wb-exhibition-structure"
              type="button"
              aria-controls="wb-inspector"
              :aria-expanded="store.panel === 'actions'"
              @click="openPanel('actions')"
            >
              <Layers2 :size="16" />探索结构
            </button>
            <p>
              {{
                exhibition
                  ? (target?.highlight ?? store.product.description)
                  : store.product.description
              }}
            </p>
            <span v-if="!exhibition" class="wb-sample-label">{{
              store.product.displayStatus === 'formal' ? '正式展品' : '流程样板'
            }}</span>
          </div>
        </Transition>
        <p v-if="!store.contentOnly" class="wb-input-hint">
          拖动旋转 · 滚轮缩放 · <span class="wb-keyboard-entry">Tab 聚焦后可用方向键</span>
        </p>
        <WorkbenchTools
          v-if="!store.contentOnly"
          floating
          :exhibition="exhibition"
          @panel="openPanel"
        />
      </section>
      <WorkbenchRail v-if="!exhibition" @select="select" @catalog="openPanel('catalog')" />
      <Transition
        :css="false"
        @enter="motion.enter"
        @leave="motion.leave"
        @enter-cancelled="motion.cancel"
        @leave-cancelled="motion.cancel"
      >
        <aside
          v-if="!exhibition && store.panel === 'catalog'"
          id="wb-catalog"
          class="wb-panel wb-panel-left"
          aria-labelledby="wb-catalog-heading"
        >
          <header>
            <h2 id="wb-catalog-heading">商品目录</h2>
            <button type="button" class="wb-panel-close" aria-label="关闭目录" @click="close">
              <X :size="19" />
            </button>
          </header>
          <div class="wb-panel-body"><WorkbenchCatalog @select="select" /></div>
        </aside>
      </Transition>
      <Transition
        :css="false"
        @enter="motion.enter"
        @leave="motion.leave"
        @enter-cancelled="motion.cancel"
        @leave-cancelled="motion.cancel"
      >
        <aside
          v-if="inspector"
          id="wb-inspector"
          class="wb-panel wb-panel-right"
          aria-labelledby="wb-panel-heading"
        >
          <header>
            <h2 id="wb-panel-heading">{{ title }}</h2>
            <button type="button" class="wb-panel-close" aria-label="收起面板" @click="close">
              <X :size="19" />
            </button>
          </header>
          <div class="wb-panel-body"><WorkbenchPanel :exhibition="exhibition" /></div>
        </aside>
      </Transition>
    </main>
  </div>
</template>

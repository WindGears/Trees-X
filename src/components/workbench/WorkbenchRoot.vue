<script setup lang="ts">
import { computed, nextTick, onMounted, onScopeDispose, ref, watch } from 'vue'
import { Grid2X2, Layers2, X } from '@lucide/vue'
import { useWorkbenchStore } from '@/stores/workbench'
import type { Panel } from '@/lib/workbench/types'
import { exhibitionPoster, type ExhibitionOverviewItem } from '@/lib/workbench/exhibition'
import { provideMotionSession } from '@/lib/workbench/motionSession'
import { createInterfaceMotion } from '@/lib/workbench/interfaceMotion'
import WorkbenchStage from './WorkbenchStage.vue'
import WorkbenchRail from './WorkbenchRail.vue'
import WorkbenchCatalog from './WorkbenchCatalog.vue'
import WorkbenchExhibitionHeader from './WorkbenchExhibitionHeader.vue'
import WorkbenchInspector from './WorkbenchInspector.vue'
import WorkbenchTools from './WorkbenchTools.vue'
import '@/assets/styles/workbench.css'
import '@/assets/styles/workbench-accessibility.css'
import '@/assets/styles/workbench-motion.css'
import '@/assets/styles/workbench-floating.css'
import '@/assets/styles/workbench-studio.css'

const props = defineProps<{ exhibits?: readonly ExhibitionOverviewItem[] }>()
const emit = defineEmits<{ overview: [] }>()
const store = useWorkbenchStore()
provideMotionSession(store)
const host = ref<HTMLElement>()
const motion = createInterfaceMotion()
const menuOpen = ref(false)
const inspectorPanel = computed(() => (store.panel === 'catalog' ? null : store.panel))
const inspector = computed(() => Boolean(inspectorPanel.value))
const exhibition = computed(() => props.exhibits !== undefined)
const target = computed(() => props.exhibits?.find((item) => item.slug === store.slug))
const poster = computed(
  () => target.value ?? (exhibition.value ? exhibitionPoster(store.slug) : undefined),
)
const name = computed(() => store.product?.name ?? poster.value?.name)
const hasStructure = computed(
  () => store.presentation?.structure || Boolean(store.presentation?.actions.length),
)
let opener: HTMLElement | null = null
function close() {
  store.panel = null
  const target = opener?.isConnected
    ? opener
    : host.value?.querySelector<HTMLElement>('.wb-catalog-trigger, .wb-exhibition-switch')
  target?.focus({ preventScroll: true })
}
function openPanel(panel: Panel) {
  if (store.panel === panel) {
    close()
    return
  }
  opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
  const wasOpen = inspector.value && panel !== 'catalog'
  store.openPanel(panel)
  void nextTick(() => {
    if (!wasOpen && store.panel === panel)
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
  if (!exhibition.value)
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
function key(event: KeyboardEvent) {
  if (event.key === 'Escape' && !event.defaultPrevented && !menuOpen.value && store.panel) close()
}
function leaveIntro(element: Element, done: () => void) {
  if (element.getAttribute('data-exhibit') === store.slug) motion.leave(element, done)
  else done()
}
watch(
  () => store.panel,
  (panel) => {
    const target = document.activeElement
    if (
      panel &&
      target instanceof HTMLElement &&
      host.value?.contains(target) &&
      !target.closest('.wb-panel')
    )
      opener = target
  },
)
watch(
  name,
  (name) => {
    document.title = name ? `${name} · Trees X` : 'Trees X · 三维商品工作台'
  },
  { immediate: true },
)
read()
onMounted(() => {
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
    <WorkbenchExhibitionHeader
      v-if="exhibits"
      v-model:open="menuOpen"
      :exhibits="exhibits"
      :slug="store.slug"
      :name="name"
      @overview="emit('overview')"
      @select="
        (slug) => {
          if (slug !== store.slug) select(slug)
        }
      "
    />
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
          :exhibit="poster"
          :inspector="inspector"
          :catalog="store.panel === 'catalog'"
          @overview="emit('overview')"
        />
        <Transition
          :css="false"
          @enter="motion.enter"
          @leave="leaveIntro"
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
            :data-exhibit="store.product.slug"
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
        <p v-if="store.available" class="wb-input-hint">
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
      <WorkbenchInspector :panel="inspectorPanel" :exhibition="exhibition" @close="close" />
    </main>
  </div>
</template>

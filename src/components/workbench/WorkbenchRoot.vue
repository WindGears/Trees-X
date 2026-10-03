<script setup lang="ts">
import { computed, nextTick, onMounted, onScopeDispose, ref, watch } from 'vue'
import { Menu, X } from '@lucide/vue'
import { gsap } from 'gsap'
import { useWorkbenchStore } from '@/stores/workbench'
import type { Panel } from '@/lib/workbench/types'
import WorkbenchStage from './WorkbenchStage.vue'
import WorkbenchCatalog from './WorkbenchCatalog.vue'
import WorkbenchPanel from './WorkbenchPanel.vue'
import WorkbenchTools from './WorkbenchTools.vue'
import '@/assets/styles/workbench.css'

const store = useWorkbenchStore()
const host = ref<HTMLElement>()
const titles = {
  catalog: '商品目录',
  appearance: '外观',
  details: '细节',
  actions: '结构与动作',
  guide: '商品导览',
}
const title = computed(() => (store.panel ? titles[store.panel] : ''))
watch(
  () => store.product?.name,
  (name) => {
    document.title = name ? `${name} · Trees X` : 'Trees X · 三维商品工作台'
  },
  { immediate: true },
)
let opener: HTMLElement | null = null
function openPanel(panel: Panel) {
  if (!store.panel)
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
  store.openPanel(panel)
  void nextTick(() =>
    host.value?.querySelector<HTMLElement>('.wb-panel-close')?.focus({ preventScroll: true }),
  )
}
function close() {
  store.panel = null
  opener?.focus({ preventScroll: true })
}
function select(slug: string) {
  if (slug === store.slug && store.available) {
    close()
    return
  }
  const url = new URL(location.href)
  url.searchParams.set('product', slug)
  url.searchParams.delete('legacy')
  history.pushState(null, '', url)
  void store.select(slug)
}
function read() {
  void store.select(new URL(location.href).searchParams.get('product') || 'form-01')
}
function key(event: KeyboardEvent) {
  if (event.key === 'Escape' && store.panel) close()
}
function transition(element: Element, done: () => void) {
  gsap.fromTo(
    element,
    { opacity: 0.3 },
    {
      opacity: 1,
      duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 0.24,
      ease: 'power3.out',
      onComplete: done,
    },
  )
}
onMounted(() => {
  read()
  void store.loadCatalog()
  window.addEventListener('popstate', read)
  window.addEventListener('keydown', key)
})
onScopeDispose(() => {
  store.dispose()
  window.removeEventListener('popstate', read)
  window.removeEventListener('keydown', key)
  if (host.value) gsap.killTweensOf(host.value.querySelectorAll('aside'))
})
</script>
<template>
  <div ref="host" class="workbench" :data-status="store.status" :data-slug="store.slug">
    <a class="skip-link" href="#wb-main">跳转到三维工作台</a>
    <header class="wb-header">
      <a class="wb-brand" href="/">Trees X<span>三维商品工作台</span></a>
      <button
        type="button"
        :aria-expanded="store.panel === 'catalog'"
        aria-controls="wb-catalog"
        @click="openPanel('catalog')"
      >
        <Menu :size="18" />商品目录
      </button>
      <span class="wb-current">{{ store.product?.name || '选择商品' }}</span>
    </header>
    <main
      id="wb-main"
      class="wb-layout"
      :class="{
        'with-catalog': store.panel === 'catalog',
        'with-inspector': store.panel && store.panel !== 'catalog',
      }"
    >
      <Transition :css="false" @enter="transition" @enter-cancelled="(el) => gsap.killTweensOf(el)">
        <aside
          v-if="store.panel === 'catalog'"
          id="wb-catalog"
          class="wb-panel wb-panel-left"
          aria-labelledby="wb-panel-heading"
        >
          <header>
            <h2 id="wb-panel-heading">{{ title }}</h2>
            <button type="button" class="wb-panel-close" aria-label="关闭目录" @click="close">
              <X :size="20" />
            </button>
          </header>
          <WorkbenchCatalog @select="select" />
        </aside>
      </Transition>
      <section class="wb-view" aria-labelledby="wb-product-title">
        <WorkbenchStage />
        <div v-if="store.product" class="wb-intro">
          <h1 id="wb-product-title">{{ store.product.name }}</h1>
          <p>{{ store.product.description }}</p>
          <span class="wb-sample-label">{{
            store.product.displayStatus === 'formal' ? '正式展品' : '流程样板'
          }}</span>
        </div>
        <p class="wb-input-hint">拖动旋转 · 滚轮缩放 · 点击部件查看</p>
        <WorkbenchTools @panel="openPanel" />
      </section>
      <Transition :css="false" @enter="transition" @enter-cancelled="(el) => gsap.killTweensOf(el)">
        <aside
          v-if="store.panel && store.panel !== 'catalog'"
          id="wb-inspector"
          class="wb-panel wb-panel-right"
          aria-labelledby="wb-panel-heading"
        >
          <header>
            <h2 id="wb-panel-heading">{{ title }}</h2>
            <button type="button" class="wb-panel-close" aria-label="收起面板" @click="close">
              <X :size="20" />
            </button>
          </header>
          <WorkbenchPanel />
        </aside>
      </Transition>
    </main>
  </div>
</template>

<script setup lang="ts">
import { ArrowDownLeft, ArrowRight, Play } from '@lucide/vue'
import { computed, nextTick, onMounted, onScopeDispose, ref, shallowRef, watch } from 'vue'
import { getProducts } from '@/lib/workbench/api'
import { exhibitionHome, exhibitionItems, exhibitionPoster } from '@/lib/workbench/exhibition'
import { LatestRequest } from '@/lib/workbench/latest'
import type { ProductSummary } from '@/lib/workbench/types'
import WorkbenchLoadCard from './WorkbenchLoadCard.vue'
import type Viewer from './ExhibitionViewer.vue'
import '@/assets/styles/exhibition-gallery.css'

const readSlug = () => new URLSearchParams(location.search).get('product')
const liveSlug = ref(readSlug())
const previewSlug = ref(liveSlug.value ?? 'typewriter-study')
const viewer = shallowRef<typeof Viewer>()
const importFailed = ref(false)
const products = ref<ProductSummary[]>([])
const catalogStatus = ref<'loading' | 'ready' | 'error'>('loading')
const entry = new LatestRequest()
const catalog = new LatestRequest()
const exhibits = computed(() => exhibitionItems(products.value))
const activeSlug = computed(() => liveSlug.value ?? previewSlug.value)
const selected = computed(() => exhibits.value.find((item) => item.slug === activeSlug.value))
const poster = computed(() => selected.value ?? exhibitionPoster(activeSlug.value))
const stage = ref<HTMLElement>()
const title = computed(() => poster.value?.name ?? '机械结构展厅')

function read() {
  const previous = liveSlug.value
  liveSlug.value = readSlug()
  if (!liveSlug.value && previous) previewSlug.value = previous
}

function navigate(href: string) {
  history.pushState(null, '', href)
  read()
}

function open(slug: string) {
  if (liveSlug.value === slug) return
  if (liveSlug.value) enter(slug)
  else previewSlug.value = slug
}

function enter(slug: string) {
  const url = new URL(location.href)
  url.searchParams.set('renderPipeline', 'showcase')
  url.searchParams.set('product', slug)
  navigate(url.pathname + url.search + url.hash)
}

function start() {
  if (!selected.value) return
  enter(selected.value.slug)
  void nextTick(() => stage.value?.focus({ preventScroll: true }))
}

function showPoster() {
  navigate(exhibitionHome)
  void nextTick(() => stage.value?.querySelector<HTMLButtonElement>('.exhibit-start')?.focus())
}

function reopen() {
  location.reload()
}

watch(
  () => Boolean(liveSlug.value),
  (live) => {
    if (!live) entry.cancel()
    else if (!viewer.value) {
      importFailed.value = false
      void entry.run(
        () => import('./ExhibitionViewer.vue'),
        (module) => (viewer.value = module.default),
        () => (importFailed.value = true),
      )
    }
  },
  { immediate: true },
)
watch(title, (name) => (document.title = `${name} · Trees X`), { immediate: true })

function load() {
  catalogStatus.value = 'loading'
  return catalog.run(
    (signal) => getProducts(signal),
    (result) => {
      products.value = result
      catalogStatus.value = 'ready'
      if (!liveSlug.value && !selected.value && exhibits.value[0])
        previewSlug.value = exhibits.value[0].slug
    },
    () => (catalogStatus.value = 'error'),
  )
}

onMounted(() => {
  window.addEventListener('popstate', read)
  void load()
})
onScopeDispose(() => {
  window.removeEventListener('popstate', read)
  entry.cancel()
  catalog.cancel()
})
</script>

<template>
  <div class="exhibit-gallery">
    <a class="skip-link" href="#gallery-main">跳转到展位</a>
    <aside class="exhibit-rail" aria-label="展厅目录">
      <div class="exhibit-brand">Trees X <span>机械结构展厅</span></div>
      <nav class="exhibit-catalog" aria-label="选择展品">
        <button
          v-for="item in exhibits"
          :key="item.slug"
          type="button"
          :aria-current="activeSlug === item.slug ? 'true' : undefined"
          @click="open(item.slug)"
        >
          <img :src="item.cover" alt="" decoding="async" />
          <span>{{ item.name }}</span>
          <ArrowRight :size="15" aria-hidden="true" />
        </button>
      </nav>
      <p v-if="catalogStatus === 'loading'" class="exhibit-rail-status" role="status">
        正在读取展品目录…
      </p>
      <div v-else-if="catalogStatus === 'error'" class="exhibit-rail-status" role="alert">
        <p>展品目录暂时无法读取。</p>
        <button type="button" @click="load">重试</button>
      </div>
      <p v-else-if="!exhibits.length" class="exhibit-rail-status">当前没有上架展品。</p>
    </aside>
    <main id="gallery-main" class="exhibit-main">
      <header class="exhibit-heading">
        <div>
          <h1>{{ title }}</h1>
          <p v-if="selected">{{ selected.highlight }}</p>
        </div>
        <button v-if="liveSlug" type="button" @click="showPoster">
          <ArrowDownLeft :size="16" aria-hidden="true" />查看封面
        </button>
      </header>
      <section ref="stage" class="exhibit-bay" aria-label="展位" tabindex="-1">
        <component
          :is="viewer"
          v-if="liveSlug && viewer"
          :slug="liveSlug"
          :exhibit="poster"
          @overview="showPoster"
        />
        <WorkbenchLoadCard
          v-else-if="liveSlug"
          class="exhibit-pending"
          :slug="activeSlug"
          :title="title"
          :cover="poster?.cover"
          :message="importFailed ? '暂时无法打开三维展位，请重试。' : '正在打开三维展位…'"
          :failed="importFailed"
          poster
        >
          <button type="button" @click="reopen">重新打开页面</button>
        </WorkbenchLoadCard>
        <div v-else class="exhibit-poster">
          <img
            v-if="poster?.cover"
            :key="poster.cover"
            :src="poster.cover"
            class="exhibit-poster-image"
            :alt="title + '整机'"
            fetchpriority="high"
            decoding="async"
          />
          <button v-if="selected" class="exhibit-start" type="button" @click="start">
            <Play :size="16" aria-hidden="true" />开始互动
          </button>
        </div>
      </section>
    </main>
  </div>
</template>

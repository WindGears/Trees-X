<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onMounted, onScopeDispose, ref } from 'vue'
import { Play } from '@lucide/vue'
import { getProducts, getCategories } from '@/lib/workbench/api'
import { galleryItems } from '@/lib/workbench/galleryCatalog'
import { galleryLocation } from '@/lib/workbench/galleryRoute'
import { LatestRequest } from '@/lib/workbench/latest'
import type { ProductSummary } from '@/lib/workbench/types'
import { createInterfaceMotion } from '@/lib/workbench/interfaceMotion'
import GalleryHeader from './GalleryHeader.vue'
import GalleryLibrary from './GalleryLibrary.vue'
import GalleryHelp from './GalleryHelp.vue'
import '@/assets/styles/museum.css'
import '@/assets/styles/museum-live.css'

const Viewer = defineAsyncComponent(() => import('@/components/workbench/ExhibitionViewer.vue'))
history.replaceState(history.state, '', galleryLocation(location.href))
const readSlug = () => new URLSearchParams(location.search).get('product')
const liveSlug = ref(readSlug())
const previewSlug = ref(liveSlug.value ?? 'typewriter-study')
const products = ref<ProductSummary[]>([])
const categories = ref<string[]>([])
const catalogStatus = ref('loading')
const catalog = new LatestRequest()
const library = ref(false)
const help = ref(false)
const activeSlug = computed(() => liveSlug.value ?? previewSlug.value)
const items = computed(() => galleryItems(products.value))
const selected = computed(() => items.value.find((item) => item.slug === activeSlug.value))
const name = computed(
  () =>
    selected.value?.name ?? (catalogStatus.value === 'error' ? '展品服务暂不可用' : '机械探索馆'),
)
const motion = createInterfaceMotion('cover')
let returnFocus: HTMLElement | null = null
function read() {
  const prior = liveSlug.value
  liveSlug.value = readSlug()
  if (!liveSlug.value && prior) previewSlug.value = prior
}
function navigate(slug?: string) {
  history.pushState(null, '', galleryLocation(location.href, slug ?? ''))
  read()
}
function select(slug: string) {
  if (activeSlug.value === slug) return
  if (liveSlug.value) navigate(slug)
  else previewSlug.value = slug
}
function openLibrary() {
  returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  library.value = true
}
function libraryState(open: boolean) {
  library.value = open
  if (!open)
    void nextTick(() => returnFocus?.isConnected && returnFocus.focus({ preventScroll: true }))
}
async function load() {
  catalogStatus.value = 'loading'
  await catalog.run(
    async (signal) => {
      const [products, categories] = await Promise.all([
        getProducts(signal),
        getCategories(signal).catch(() => []),
      ])
      return { products, categories }
    },
    (result) => {
      products.value = result.products
      categories.value = result.categories
      catalogStatus.value = 'ready'
      if (!liveSlug.value && !selected.value && items.value[0])
        previewSlug.value = items.value[0].slug
    },
    () => {
      catalogStatus.value = 'error'
    },
  )
}
onMounted(() => {
  window.addEventListener('popstate', read)
  void load()
})
onScopeDispose(() => {
  window.removeEventListener('popstate', read)
  catalog.cancel()
  motion.dispose()
})
</script>

<template>
  <main class="museum" :data-gallery-mode="liveSlug ? 'interactive' : 'cover'">
    <a class="skip-link" href="#museum-stage">跳转到展位</a>
    <section id="museum-stage" class="museum-stage" aria-label="当前展位" tabindex="-1">
      <Viewer
        v-if="liveSlug"
        :slug="liveSlug"
        :exhibit="selected"
        immersive
        :suspended="library || help"
        @overview="openLibrary"
        @poster="navigate()"
      />
      <template v-else>
        <Transition
          :css="false"
          @enter="motion.enter"
          @leave="motion.leave"
          @enter-cancelled="motion.cancel"
          @leave-cancelled="motion.cancel"
        >
          <img
            v-if="selected?.cover"
            :key="selected.slug"
            class="museum-poster"
            :src="selected.cover"
            :alt="selected.name + '整机'"
            fetchpriority="high"
          />
        </Transition>
        <button
          v-if="selected"
          class="museum-start museum-primary"
          @click="navigate(selected.slug)"
        >
          <Play :size="17" aria-hidden="true" />开始互动
        </button>
        <div v-else class="museum-load" role="status">
          <p>
            {{
              catalogStatus === 'loading'
                ? '正在读取展品目录…'
                : catalogStatus === 'error'
                  ? '无法连接展品服务'
                  : '暂无上架的正式展品'
            }}
          </p>
          <button v-if="catalogStatus === 'error'" class="museum-button" @click="load">重试</button>
        </div>
      </template>
    </section>
    <div class="museum-top-scrim" />
    <GalleryHeader
      :items="items"
      :current="activeSlug"
      :name="name"
      @select="select"
      @library="openLibrary"
      @help="help = true"
    />
    <div class="museum-identity">
      <h1>{{ name }}</h1>
      <p v-if="selected">{{ selected.description }}</p>
    </div>
    <GalleryLibrary
      :open="library"
      :items="items"
      :current="activeSlug"
      :status="catalogStatus"
      :categories="categories.length ? categories : undefined"
      @update:open="libraryState"
      @select="select"
      @retry="load"
    />
    <GalleryHelp v-model:open="help" />
  </main>
</template>

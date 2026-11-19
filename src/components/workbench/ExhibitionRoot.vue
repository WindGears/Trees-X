<script setup lang="ts">
import { computed, onMounted, onScopeDispose, ref, shallowRef, watch } from 'vue'
import { getProducts } from '@/lib/workbench/api'
import { exhibitionHome, exhibitionItems, exhibitionPoster } from '@/lib/workbench/exhibition'
import { LatestRequest } from '@/lib/workbench/latest'
import type { ProductSummary } from '@/lib/workbench/types'
import ExhibitionOverview from './ExhibitionOverview.vue'
import WorkbenchExhibitionHeader from './WorkbenchExhibitionHeader.vue'
import WorkbenchLoadCard from './WorkbenchLoadCard.vue'
import type Workbench from './WorkbenchRoot.vue'

const product = () => new URLSearchParams(location.search).get('product')
const slug = ref(product())
const workbench = shallowRef<typeof Workbench>()
const importFailed = ref(false)
const entry = new LatestRequest()
const products = ref<ProductSummary[]>([])
const catalogStatus = ref<'loading' | 'ready' | 'error'>('loading')
const exhibits = computed(() => exhibitionItems(products.value))
const active = computed(
  () =>
    exhibits.value.find((item) => item.slug === slug.value) || exhibitionPoster(slug.value ?? ''),
)
const request = new LatestRequest()

function read() {
  slug.value = product()
  if (!slug.value) document.title = 'Trees X · 机械结构展厅'
}

function navigate(href: string) {
  history.pushState(null, '', href)
  read()
}

function open(slug: string) {
  const item = exhibits.value.find((exhibit) => exhibit.slug === slug)
  if (item && slug !== product()) navigate(item.href)
}

function reopen() {
  window.location.reload()
}

watch(
  () => Boolean(slug.value),
  (selected) => {
    if (!selected) entry.cancel()
    else if (!workbench.value) {
      importFailed.value = false
      void entry.run(
        () => import('./WorkbenchRoot.vue'),
        (module) => (workbench.value = module.default),
        () => (importFailed.value = true),
      )
    }
  },
  { immediate: true },
)

function load() {
  catalogStatus.value = 'loading'
  return request.run(
    (signal) => getProducts(signal),
    (result) => {
      products.value = result
      catalogStatus.value = 'ready'
    },
    () => {
      catalogStatus.value = 'error'
    },
  )
}

onMounted(() => {
  window.addEventListener('popstate', read)
  read()
  void load()
})
onScopeDispose(() => {
  window.removeEventListener('popstate', read)
  request.cancel()
  entry.cancel()
})
</script>

<template>
  <component
    :is="workbench"
    v-if="slug && workbench"
    :exhibits="exhibits"
    @overview="navigate(exhibitionHome)"
  />
  <main v-else-if="slug" class="workbench wb-exhibition wb-exhibit-pending">
    <WorkbenchExhibitionHeader
      :exhibits="exhibits"
      :slug="slug"
      :name="active?.name"
      @select="open"
      @overview="navigate(exhibitionHome)"
    />
    <WorkbenchLoadCard
      :slug="slug"
      :title="active?.name ?? '展品'"
      :cover="active?.cover"
      :message="importFailed ? '工作台未能打开，请重试。' : '正在打开三维工作台…'"
      :failed="importFailed"
      poster
    >
      <div class="wb-inline-actions">
        <button type="button" @click="reopen">重新打开页面</button>
      </div>
    </WorkbenchLoadCard>
  </main>
  <ExhibitionOverview
    v-else
    :exhibits="exhibits"
    :catalog-status="catalogStatus"
    @open="open"
    @retry="load"
  />
</template>

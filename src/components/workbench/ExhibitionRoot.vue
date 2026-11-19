<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, onScopeDispose, ref } from 'vue'
import { getProducts } from '@/lib/workbench/api'
import { exhibitionHome, exhibitionItems } from '@/lib/workbench/exhibition'
import { LatestRequest } from '@/lib/workbench/latest'
import type { ProductSummary } from '@/lib/workbench/types'
import ExhibitionOverview from './ExhibitionOverview.vue'

const WorkbenchRoot = defineAsyncComponent(() => import('./WorkbenchRoot.vue'))
const product = () => new URLSearchParams(location.search).get('product')
const inWorkbench = ref(Boolean(product()))
const products = ref<ProductSummary[]>([])
const catalogStatus = ref<'loading' | 'ready' | 'error'>('loading')
const exhibits = computed(() => exhibitionItems(products.value))
const request = new LatestRequest()

function read() {
  inWorkbench.value = Boolean(product())
  if (!inWorkbench.value) document.title = 'Trees X · 机械结构展厅'
}

function navigate(href: string) {
  history.pushState(null, '', href)
  read()
}

function open(slug: string) {
  const item = exhibits.value.find((exhibit) => exhibit.slug === slug)
  if (item) navigate(item.href)
}

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
})
</script>

<template>
  <WorkbenchRoot v-if="inWorkbench" :exhibits="exhibits" @overview="navigate(exhibitionHome)" />
  <ExhibitionOverview
    v-else
    :exhibits="exhibits"
    :catalog-status="catalogStatus"
    @open="open"
    @retry="load"
  />
</template>

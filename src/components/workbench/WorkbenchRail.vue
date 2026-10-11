<script setup lang="ts">
import { onMounted, onScopeDispose, ref } from 'vue'
import { Grid2X2, RotateCw } from '@lucide/vue'
import { getProducts } from '@/lib/workbench/api'
import type { ProductSummary } from '@/lib/workbench/types'
import { useWorkbenchStore } from '@/stores/workbench'
const store = useWorkbenchStore()
const emit = defineEmits<{ select: [slug: string]; catalog: [] }>()
const products = ref<ProductSummary[]>([])
const error = ref(false)
const pending = ref(true)
const request = new AbortController()
async function load() {
  error.value = false
  pending.value = true
  try {
    products.value = await getProducts(request.signal, '', '')
  } catch {
    if (!request.signal.aborted) error.value = true
  } finally {
    if (!request.signal.aborted) pending.value = false
  }
}
onMounted(() => void load())
onScopeDispose(() => request.abort())
</script>
<template>
  <nav class="wb-rail" aria-label="快速选择商品">
    <div class="wb-rail-list">
      <button
        v-for="item in products"
        :key="item.slug"
        type="button"
        :aria-label="'展示' + item.name"
        :aria-pressed="store.slug === item.slug"
        :data-product="item.slug"
        @click="emit('select', item.slug)"
      >
        <img v-if="item.cover" :src="item.cover" alt="" loading="lazy" />
        <span
          ><strong>{{ item.name }}</strong></span
        >
      </button>
      <span v-if="pending" class="wb-rail-loading" role="status">读取目录…</span>
      <button v-if="error" type="button" aria-label="重新读取商品栏" @click="load">
        <RotateCw :size="17" />重试
      </button>
    </div>
    <button
      type="button"
      class="wb-rail-toggle"
      aria-label="全部商品"
      :aria-expanded="store.panel === 'catalog'"
      aria-controls="wb-catalog"
      @click="emit('catalog')"
    >
      <Grid2X2 :size="17" /><span>全部商品</span>
    </button>
  </nav>
</template>

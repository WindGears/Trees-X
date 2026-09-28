<script setup lang="ts">
import { computed } from 'vue'
import { ArrowLeft, ArrowRight, LayoutGrid } from '@lucide/vue'
import { collection } from '@/data/collection'
import { useProductStore } from '@/stores/product'
const store = useProductStore()
const index = computed(() => collection.findIndex((item) => item.id === store.product.id))
function step(delta: number) {
  store.selectProduct(collection[(index.value + delta + collection.length) % collection.length]!.id)
}
</script>
<template>
  <div class="product-switcher" aria-label="切换展示商品">
    <button type="button" aria-label="上一件商品" @click="step(-1)">
      <ArrowLeft :size="15" />
    </button>
    <button type="button" class="product-switcher__browse" @click="store.catalogOpen = true">
      <LayoutGrid :size="14" /> 浏览全部商品
      <span
        >{{ String(index + 1).padStart(2, '0') }} /
        {{ String(collection.length).padStart(2, '0') }}</span
      >
    </button>
    <button type="button" aria-label="下一件商品" @click="step(1)">
      <ArrowRight :size="15" />
    </button>
  </div>
</template>

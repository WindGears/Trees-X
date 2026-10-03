<script setup lang="ts">
import { onMounted, onScopeDispose, watch } from 'vue'
import { ArrowUpRight, Search } from '@lucide/vue'
import { useWorkbenchStore } from '@/stores/workbench'
const store = useWorkbenchStore()
const emit = defineEmits<{ select: [slug: string] }>()
let timer: ReturnType<typeof setTimeout> | undefined
// A panel may close before its debounced search fires. Reopen from current filters.
onMounted(() => void store.loadCatalog())
watch(
  () => [store.query, store.category],
  () => {
    clearTimeout(timer)
    timer = setTimeout(() => void store.loadCatalog(), 200)
  },
)
onScopeDispose(() => clearTimeout(timer))
</script>
<template>
  <div class="wb-catalog">
    <label class="wb-search"
      ><Search :size="17" /><input
        v-model="store.query"
        aria-label="搜索商品"
        placeholder="搜索商品"
    /></label>
    <label class="wb-filter"
      >商品分类
      <select v-model="store.category" aria-label="商品分类">
        <option value="">全部商品</option>
        <option>数码</option>
        <option>机械</option>
        <option>交通</option>
      </select>
    </label>
    <p v-if="store.catalogStatus === 'loading'" role="status">正在读取目录…</p>
    <div v-else-if="store.catalogStatus === 'error'" role="alert">
      <p>{{ store.catalogError }}</p>
      <button type="button" @click="store.loadCatalog()">重试目录</button>
    </div>
    <p v-else-if="!store.products.length" role="status">没有找到对应商品，试试其他关键词。</p>
    <div v-else class="wb-catalog-list">
      <button
        v-for="item in store.products"
        :key="item.slug"
        type="button"
        :aria-pressed="item.slug === store.slug"
        @click="emit('select', item.slug)"
      >
        <img
          v-if="item.cover"
          :src="item.cover"
          :alt="item.name + '模型预览'"
          class="wb-cover"
          loading="lazy"
        />
        <span class="wb-product-row"
          ><strong>{{ item.name }}</strong
          ><ArrowUpRight :size="18"
        /></span>
        <span>{{ item.description }}</span>
        <small
          >{{ item.category }} ·
          {{ item.displayStatus === 'formal' ? '正式展品' : '流程样板' }}</small
        >
      </button>
    </div>
    <p class="wb-note">先验证观察与操作流程，再逐件接入正式模型。</p>
  </div>
</template>

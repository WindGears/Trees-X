<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  DialogRoot,
  DialogPortal,
  DialogContent,
  DialogOverlay,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from 'reka-ui'
import { ArrowUpRight, Check, Search, X } from '@lucide/vue'
import { collection } from '@/data/collection'
import { useProductStore } from '@/stores/product'

const store = useProductStore()
const query = ref('')
const category = ref('全部')
const categories = ['全部', '数码', '家居', '潮玩', '机械']
const filtered = computed(() =>
  [...collection]
    .sort((a, b) => (a.featuredRank ?? 99) - (b.featuredRank ?? 99))
    .filter(
      (item) =>
        (category.value === '全部' || item.collection === category.value) &&
        `${item.label} ${item.name} ${item.description}`
          .toLowerCase()
          .includes(query.value.trim().toLowerCase()),
    ),
)
let opener: HTMLElement | null = null
let chosen = false
watch(
  () => store.catalogOpen,
  (open) => {
    if (open) {
      opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
      chosen = false
    }
  },
  { flush: 'sync' },
)
function select(id: string) {
  chosen = true
  store.selectProduct(id)
}
function clearFilters() {
  query.value = ''
  category.value = '全部'
}
function restoreFocus(event: Event) {
  event.preventDefault()
  const target = chosen ? document.getElementById('showcase-heading') : opener
  target?.focus({ preventScroll: true })
}
</script>

<template>
  <DialogRoot v-model:open="store.catalogOpen">
    <DialogPortal>
      <DialogOverlay class="collection-scrim" />
      <DialogContent class="collection-dialog" @close-auto-focus="restoreFocus">
        <header class="collection-header">
          <div class="collection-heading">
            <DialogTitle class="collection-title">选一件，<span>走近看。</span></DialogTitle>
            <DialogDescription class="collection-description"
              >先走近三件精选展品，再探索数码、家居与潮玩的不同细节。</DialogDescription
            >
          </div>
          <DialogClose class="collection-close" aria-label="关闭商品目录"
            ><X :size="20"
          /></DialogClose>
        </header>
        <div class="collection-toolbar">
          <div class="collection-filters" role="group" aria-label="商品分类">
            <button
              v-for="item in categories"
              :key="item"
              type="button"
              :aria-pressed="category === item"
              @click="category = item"
            >
              {{ item }}
            </button>
          </div>
          <label class="collection-search"
            ><Search :size="16" /><input
              v-model="query"
              type="search"
              aria-label="搜索商品"
              placeholder="搜索物品或设计"
          /></label>
          <span class="collection-count" role="status">{{ filtered.length }} 件作品</span>
        </div>
        <div class="collection-results" data-lenis-prevent>
          <div v-if="filtered.length" class="collection-grid">
            <button
              v-for="item in filtered"
              :key="item.id"
              type="button"
              class="collection-item"
              :class="{ 'is-current': store.product.id === item.id }"
              :aria-label="`展示${item.label}`"
              :aria-pressed="store.product.id === item.id"
              @click="select(item.id)"
            >
              <div class="collection-item__image">
                <img
                  :src="item.coverUrl"
                  :alt="item.label"
                  loading="lazy"
                  width="720"
                  height="400"
                />
                <span v-if="store.product.id === item.id" class="collection-item__current"
                  ><Check :size="12" />正在展示</span
                >
                <span class="collection-item__open"><ArrowUpRight :size="19" /></span>
              </div>
              <div class="collection-item__identity">
                <span>{{ item.name }}</span
                ><span>{{ item.featuredRank ? '精选 · ' : '' }}{{ item.collection }}</span>
              </div>
              <div class="collection-item__title">
                <h3>{{ item.label }}</h3>
                <span>{{ item.structure.length ? '可分层观察' : '整体观察' }}</span>
              </div>
            </button>
          </div>
          <div v-else class="collection-empty">
            <p>还没有找到这件物品。</p>
            <button type="button" @click="clearFilters">查看全部商品</button>
          </div>
        </div>
        <footer class="collection-footer">
          <span>{{ collection.length }} OBJECTS / 4 COLLECTIONS</span>
          <p>三维展示样品 · 配色为视觉试验</p>
        </footer>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

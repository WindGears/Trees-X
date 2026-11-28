<script setup lang="ts">
import { computed, onScopeDispose, ref } from 'vue'
import { ArrowUpRight, Search, X } from '@lucide/vue'
import {
  DialogRoot,
  DialogPortal,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from 'reka-ui'
import { filterGallery, type GalleryItem } from '@/lib/workbench/galleryCatalog'
import { createInterfaceMotion } from '@/lib/workbench/interfaceMotion'
const props = defineProps<{
  open: boolean
  items: GalleryItem[]
  current: string
  status?: string
  categories?: string[]
}>()
const emit = defineEmits<{ 'update:open': [value: boolean]; select: [slug: string]; retry: [] }>()
const query = ref('')
const category = ref('')
const choices = computed(
  () => props.categories ?? [...new Set(props.items.map((item) => item.category))],
)
const results = computed(() => filterGallery(props.items, query.value, category.value))
const motion = createInterfaceMotion('library')
function clearFilters() {
  query.value = ''
  category.value = ''
}
onScopeDispose(motion.dispose)
function select(slug: string) {
  emit('select', slug)
  emit('update:open', false)
}
</script>

<template>
  <DialogRoot :open="open" @update:open="emit('update:open', $event)">
    <DialogPortal force-mount>
      <Transition
        :css="false"
        @enter="motion.enter"
        @leave="motion.leave"
        @enter-cancelled="motion.cancel"
        @leave-cancelled="motion.cancel"
      >
        <DialogContent v-if="open" class="museum-library museum-surface">
          <header class="museum-library-heading">
            <div>
              <DialogTitle>展品库</DialogTitle
              ><DialogDescription>从整体外形，探索内部结构。</DialogDescription>
            </div>
            <DialogClose class="museum-button"
              >返回展位 <X :size="18" aria-hidden="true"
            /></DialogClose>
          </header>
          <div class="museum-library-filters">
            <label class="museum-search"
              ><Search :size="18" aria-hidden="true" /><input
                v-model="query"
                aria-label="搜索展品名称"
                placeholder="搜索展品名称"
            /></label>
            <select v-model="category" aria-label="展品分类">
              <option value="">全部分类</option>
              <option v-for="name in choices" :key="name" :value="name">{{ name }}</option>
            </select>
            <span v-if="status !== 'loading' && status !== 'error'" role="status"
              >{{ results.length }} 件展品</span
            >
          </div>
          <div v-if="status === 'loading'" class="museum-empty" role="status">
            正在读取展品目录…
          </div>
          <div v-else-if="status === 'error'" class="museum-empty" role="alert">
            <h3>暂时无法读取展品库</h3>
            <p>请检查本地服务，再重新读取。</p>
            <button class="museum-button" @click="emit('retry')">重试</button>
          </div>
          <div v-else-if="!results.length" class="museum-empty">
            <h3>{{ items.length ? '没有找到匹配的展品' : '展品库正在准备中' }}</h3>
            <button v-if="items.length" class="museum-button" @click="clearFilters">
              清除筛选
            </button>
            <p v-else>正式展品上架后会出现在这里。</p>
          </div>
          <div v-else class="museum-library-grid">
            <button
              v-for="item in results"
              :key="item.slug"
              class="museum-card"
              :aria-current="item.slug === current ? 'true' : undefined"
              @click="select(item.slug)"
            >
              <div class="museum-card-image">
                <img v-if="item.cover" :src="item.cover" alt="" loading="lazy" /><span
                  v-else
                  class="museum-cover-fallback"
                  >{{ item.name }}</span
                ><span v-if="item.slug === current" class="museum-current">当前展位</span>
              </div>
              <div class="museum-card-copy">
                <span class="museum-card-category">{{ item.category }}</span>
                <h3>{{ item.name }}<ArrowUpRight :size="18" aria-hidden="true" /></h3>
                <p>{{ item.description }}</p>
              </div>
            </button>
          </div>
          <footer class="museum-library-footer">展品持续收录，新的结构等待探索。</footer>
        </DialogContent>
      </Transition>
    </DialogPortal>
  </DialogRoot>
</template>

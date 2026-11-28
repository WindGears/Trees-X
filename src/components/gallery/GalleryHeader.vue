<script setup lang="ts">
import { computed, ref } from 'vue'
import { Check, ChevronDown, HelpCircle, Search } from '@lucide/vue'
import { PopoverRoot, PopoverTrigger, PopoverPortal, PopoverContent } from 'reka-ui'
import type { GalleryItem } from '@/lib/workbench/galleryCatalog'
const props = defineProps<{ items: GalleryItem[]; current: string; name: string }>()
const emit = defineEmits<{ select: [slug: string]; library: []; help: [] }>()
const open = ref(false)
const query = ref('')
const results = computed(() =>
  props.items.filter((item) =>
    item.name.toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase()),
  ),
)
function select(slug: string) {
  open.value = false
  emit('select', slug)
}
function library() {
  open.value = false
  emit('library')
}
</script>

<template>
  <header class="museum-header">
    <div class="museum-brand">Trees X <span>机械探索馆</span></div>
    <PopoverRoot v-model:open="open">
      <PopoverTrigger class="museum-switch" aria-label="切换展品">
        <span>{{ name }}</span
        ><ChevronDown :size="15" aria-hidden="true" />
      </PopoverTrigger>
      <PopoverPortal>
        <PopoverContent
          class="museum-popover museum-switch-list"
          :side-offset="10"
          :collision-padding="16"
          aria-label="快速切换展品"
        >
          <label class="museum-search"
            ><Search :size="17" aria-hidden="true" /><input
              v-model="query"
              aria-label="搜索切换展品"
              placeholder="搜索展品名称"
          /></label>
          <div class="museum-switch-results">
            <button
              v-for="item in results"
              :key="item.slug"
              :aria-current="item.slug === current ? 'true' : undefined"
              @click="select(item.slug)"
            >
              <img v-if="item.cover" :src="item.cover" alt="" /><span
                >{{ item.name }}<small>{{ item.category }}</small></span
              ><Check v-if="item.slug === current" :size="16" aria-hidden="true" />
            </button>
            <p v-if="!results.length" class="museum-muted">没有匹配的展品</p>
          </div>
          <button class="museum-browse-all" @click="library">浏览全部展品</button>
        </PopoverContent>
      </PopoverPortal>
    </PopoverRoot>
    <nav aria-label="展厅导航">
      <button @click="emit('library')">展品库</button
      ><button aria-label="操作帮助" @click="emit('help')">
        <HelpCircle :size="19" aria-hidden="true" />
      </button>
    </nav>
  </header>
</template>

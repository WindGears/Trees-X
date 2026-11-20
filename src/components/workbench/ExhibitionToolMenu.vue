<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
import { Ellipsis, Minus, Plus } from '@lucide/vue'
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui'
import { useWorkbenchStore } from '@/stores/workbench'
import { isCarPaintStudy } from '@/lib/workbench/carPaintStudies'
import { productRenderSearch } from '@/lib/workbench/rendering/showcase'
import WorkbenchCarPaints from './WorkbenchCarPaints.vue'

defineProps<{ canReset?: boolean }>()
const emit = defineEmits<{ focus: [id: string]; reset: []; restore: [] }>()
const store = useWorkbenchStore()
const open = ref(false)
const tools = [
  { id: 'parts', label: '部件' },
  { id: 'views', label: '取景' },
  { id: 'finishes', label: '外观' },
  { id: 'guide', label: '导览' },
] as const
const section = ref<(typeof tools)[number]['id']>('parts')
const query = ref('')
const limit = ref(12)
const searchId = useId()
const parts = computed(() => store.presentation?.hotspots ?? [])
const visibleTools = computed(() =>
  tools.filter(
    ({ id }) =>
      (id === 'parts' && parts.value.length) ||
      (id === 'views' && store.presentation?.views.length) ||
      (id === 'finishes' && store.presentation?.finishes.length) ||
      (id === 'guide' && store.presentation?.guide.length),
  ),
)
const results = computed(() => {
  const term = query.value.trim().toLocaleLowerCase()
  if (!term) {
    const featured = parts.value.filter((part) => part.marker !== false)
    return featured.length ? featured : parts.value
  }
  return parts.value.filter((part) =>
    /^[a-z]$/.test(term)
      ? part.name
          .toLocaleLowerCase()
          .split(/[\s·]+/)
          .at(-1) === term
      : [part.name, part.group, part.id].some((value) => value?.toLocaleLowerCase().includes(term)),
  )
})
const guide = computed(() => store.presentation?.guide ?? [])
const activeGuide = computed(() => guide.value[store.guideStep])
const initialPaint = computed(() => {
  const search = new URLSearchParams(location.search)
  if (!search.has('renderPipeline')) search.set('renderPipeline', 'showcase')
  const query = productRenderSearch(store.presentation?.source, search.toString())
  const paint = new URLSearchParams(query).get('carStudioPaint')
  return isCarPaintStudy(paint) ? paint : undefined
})
watch(query, () => (limit.value = 12))
watch(open, (value) => {
  if (!value || visibleTools.value.some(({ id }) => id === section.value)) return
  const first = visibleTools.value[0]
  if (first) section.value = first.id
})
function inspect(id: string) {
  open.value = false
  emit('focus', id)
}
function reset() {
  open.value = false
  emit('reset')
}
function restore() {
  open.value = false
  emit('restore')
}
</script>

<template>
  <PopoverRoot v-model:open="open">
    <PopoverTrigger class="exhibit-tools-trigger">
      <Ellipsis :size="19" aria-hidden="true" />
      观察工具
    </PopoverTrigger>
    <PopoverPortal>
      <PopoverContent
        class="exhibit-tool-sheet"
        side="top"
        align="end"
        :side-offset="12"
        :collision-padding="16"
        aria-label="观察工具"
      >
        <nav class="exhibit-tool-tabs" aria-label="观察工具分类">
          <button
            v-for="{ id, label } in visibleTools"
            :key="id"
            type="button"
            :aria-pressed="section === id"
            @click="section = id"
          >
            {{ label }}
          </button>
        </nav>
        <div v-if="section === 'parts'" class="exhibit-tool-body">
          <label :for="searchId">查找部件</label>
          <input :id="searchId" v-model="query" type="search" placeholder="输入部件名称或按键" />
          <ul class="exhibit-tool-list">
            <li v-for="part in results.slice(0, limit)" :key="part.id">
              <button
                type="button"
                :aria-pressed="store.selectedPart === part.id"
                @click="inspect(part.id)"
              >
                {{ part.name }}
              </button>
            </li>
          </ul>
          <p v-if="!results.length" role="status">没有找到部件，试试其他名称。</p>
          <button v-if="limit < results.length" type="button" @click="limit += 12">
            查看更多部件
          </button>
        </div>
        <div v-else-if="section === 'views'" class="exhibit-tool-body">
          <h3>观察视角</h3>
          <ul class="exhibit-tool-list">
            <li v-for="view in store.presentation?.views" :key="view.id">
              <button
                type="button"
                :aria-pressed="store.viewId === view.id"
                @click="store.view(view.id)"
              >
                {{ view.label }}
              </button>
            </li>
          </ul>
          <div class="exhibit-tool-inline">
            <button type="button" aria-label="缩小" @click="store.zoom(-1)">
              <Minus :size="16" />
            </button>
            <button type="button" aria-label="放大" @click="store.zoom(1)">
              <Plus :size="16" />
            </button>
          </div>
        </div>
        <div v-else-if="section === 'finishes'" class="exhibit-tool-body">
          <WorkbenchCarPaints :initial="initialPaint" />
          <h3>{{ store.carPaintAvailable ? '其他配色' : '表面配色' }}</h3>
          <ul class="exhibit-tool-list">
            <li v-for="finish in store.presentation?.finishes" :key="finish.id">
              <button
                type="button"
                :aria-pressed="store.finishId === finish.id"
                @click="store.finish(finish.id)"
              >
                <span
                  class="exhibit-finish-swatch"
                  :style="{ background: finish.color }"
                  aria-hidden="true"
                ></span>
                {{ finish.name }}
              </button>
            </li>
          </ul>
        </div>
        <div v-else class="exhibit-tool-body">
          <template v-if="activeGuide">
            <h3>{{ activeGuide.title }}</h3>
            <p>{{ activeGuide.description }}</p>
            <div class="exhibit-tool-inline">
              <button
                v-if="store.guideStep > 0"
                type="button"
                @click="store.guide(store.guideStep - 1)"
              >
                上一步
              </button>
              <button
                v-if="store.guideStep < guide.length - 1"
                type="button"
                @click="store.guide(store.guideStep + 1)"
              >
                下一步
              </button>
              <button type="button" @click="store.manual()">退出导览</button>
            </div>
          </template>
          <button v-else-if="guide.length" type="button" @click="store.guide(0)">开始导览</button>
        </div>
        <footer class="exhibit-tool-footer">
          <button v-if="canReset" type="button" @click="reset">复原结构</button>
          <button type="button" @click="restore">还原展品</button>
        </footer>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>

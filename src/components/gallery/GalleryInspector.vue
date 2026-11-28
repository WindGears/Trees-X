<script setup lang="ts">
import { computed, onScopeDispose, ref, watch } from 'vue'
import { Minus, Plus, X } from '@lucide/vue'
import { useWorkbenchStore } from '@/stores/workbench'
import { createInterfaceMotion } from '@/lib/workbench/interfaceMotion'
import { isCarPaintStudy } from '@/lib/workbench/carPaintStudies'
import { productRenderSearch } from '@/lib/workbench/rendering/showcase'
import WorkbenchCarPaints from '@/components/workbench/WorkbenchCarPaints.vue'
import type { Hotspot } from '@/lib/workbench/types'
const props = defineProps<{
  panel: string
  part?: Hotspot
  requiresExpansion?: boolean
  returnView: string
}>()
const emit = defineEmits<{ close: []; focus: [id: string]; reveal: [id: string]; poster: [] }>()
const store = useWorkbenchStore()
const query = ref('')
const closeButton = ref<HTMLButtonElement>()
const limit = ref(20)
const motion = createInterfaceMotion('inspector')
const heading = computed(
  () =>
    props.part?.name ??
    { parts: '部件', views: '观察视角', finishes: '外观', more: '导览与设置' }[props.panel] ??
    '观察',
)
const results = computed(() => {
  const normalize = (text: string) => text.replace(/\s+/g, '').toLocaleLowerCase()
  const term = normalize(query.value)
  const parts = store.presentation?.hotspots ?? []
  return term
    ? parts.filter((part) => normalize(`${part.name} ${part.group ?? ''}`).includes(term))
    : parts.filter((part) => part.marker !== false)
})
const guide = computed(() => store.presentation?.guide ?? [])
const activeGuide = computed(() => guide.value[store.guideStep])
const initialPaint = computed(() => {
  const search = new URLSearchParams(location.search)
  if (!search.has('renderPipeline')) search.set('renderPipeline', 'showcase')
  const paint = new URLSearchParams(
    productRenderSearch(store.presentation?.source, search.toString()),
  ).get('carStudioPaint')
  return isCarPaintStudy(paint) ? paint : undefined
})
function chapter() {
  store.view(props.returnView)
  emit('close')
}
function reset() {
  store.resetActions()
  emit('close')
}
function restore() {
  store.restore()
  emit('close')
}
watch(query, () => {
  limit.value = 20
})
onScopeDispose(motion.dispose)
defineExpose({ focusClose: () => closeButton.value?.focus({ preventScroll: true }) })
</script>
<template>
  <Transition
    :css="false"
    @enter="motion.enter"
    @leave="motion.leave"
    @enter-cancelled="motion.cancel"
    @leave-cancelled="motion.cancel"
  >
    <aside
      v-if="panel"
      class="museum-inspector"
      aria-labelledby="museum-inspector-title"
      @keydown.esc.stop="emit('close')"
    >
      <header>
        <h2 id="museum-inspector-title">{{ heading }}</h2>
        <button
          ref="closeButton"
          class="museum-icon"
          aria-label="关闭检查面板"
          @click="emit('close')"
        >
          <X :size="18" aria-hidden="true" />
        </button>
      </header>
      <div v-if="part" class="museum-inspector-body">
        <p>{{ part.description }}</p>
        <button v-if="requiresExpansion" class="museum-primary" @click="emit('reveal', part.id)">
          展开后查看</button
        ><button v-else class="museum-button" @click="chapter">回到本段</button>
      </div>
      <div v-else-if="panel === 'parts'" class="museum-inspector-body">
        <label class="museum-search"
          ><input v-model="query" aria-label="查找部件" placeholder="搜索部件名称"
        /></label>
        <ul class="museum-option-list">
          <li v-for="item in results.slice(0, limit)" :key="item.id">
            <button :aria-pressed="store.selectedPart === item.id" @click="emit('focus', item.id)">
              {{ item.name }}
            </button>
          </li>
        </ul>
        <p v-if="!results.length" role="status">没有找到部件，试试其他名称。</p>
        <button v-if="limit < results.length" class="museum-button" @click="limit += 20">
          查看更多部件
        </button>
      </div>
      <div v-else-if="panel === 'views'" class="museum-inspector-body">
        <ul class="museum-option-list">
          <li v-for="view in store.presentation?.views" :key="view.id">
            <button :aria-pressed="store.viewId === view.id" @click="store.view(view.id)">
              {{ view.label }}
            </button>
          </li>
        </ul>
        <div class="museum-zoom">
          <button class="museum-button" aria-label="缩小" @click="store.zoom(-1)">
            <Minus :size="17" /></button
          ><button class="museum-button" aria-label="放大" @click="store.zoom(1)">
            <Plus :size="17" />
          </button>
        </div>
        <button class="museum-button" @click="store.view()">复位视角</button>
      </div>
      <div v-else-if="panel === 'finishes'" class="museum-inspector-body">
        <WorkbenchCarPaints :initial="initialPaint" />
        <ul class="museum-option-list">
          <li v-for="finish in store.presentation?.finishes" :key="finish.id">
            <button :aria-pressed="store.finishId === finish.id" @click="store.finish(finish.id)">
              <span class="museum-swatch" :style="{ background: finish.color }" />{{ finish.name }}
            </button>
          </li>
        </ul>
      </div>
      <div v-else class="museum-inspector-body">
        <template v-if="activeGuide"
          ><h3>{{ activeGuide.title }}</h3>
          <p>{{ activeGuide.description }}</p>
          <div class="museum-guide-actions">
            <button
              class="museum-button"
              :disabled="store.guideStep <= 0"
              @click="store.guide(store.guideStep - 1)"
            >
              上一步</button
            ><button
              class="museum-button"
              :disabled="store.guideStep >= guide.length - 1"
              @click="store.guide(store.guideStep + 1)"
            >
              下一步
            </button>
          </div>
          <button class="museum-button" @click="store.manual()">退出导览</button></template
        >
        <button v-else-if="guide.length" class="museum-primary" @click="store.guide(0)">
          开始导览
        </button>
        <button
          v-if="store.presentation?.structure || store.presentation?.actions.length"
          class="museum-button"
          @click="reset"
        >
          复原结构</button
        ><button class="museum-button" @click="restore">还原展品</button
        ><button class="museum-button" @click="emit('poster')">回到封面</button>
      </div>
    </aside>
  </Transition>
</template>

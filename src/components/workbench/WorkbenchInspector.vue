<script setup lang="ts">
import { nextTick, onScopeDispose, ref, watch } from 'vue'
import { X } from '@lucide/vue'
import { createInterfaceMotion } from '@/lib/workbench/interfaceMotion'
import type { Panel } from '@/lib/workbench/types'
import WorkbenchPanel from './WorkbenchPanel.vue'

type Section = Exclude<Panel, 'catalog'>
const props = defineProps<{ panel: Section | null; exhibition?: boolean }>()
defineEmits<{ close: [] }>()

const titles: Record<Section, string> = {
  appearance: '外观',
  details: '细节',
  actions: '结构与动作',
  guide: '商品导览',
}
const retained = ref<Section | null>(null)
const body = ref<HTMLElement>()
const close = ref<HTMLButtonElement>()
const slide = createInterfaceMotion('inspector')
const content = createInterfaceMotion()

watch(
  () => props.panel,
  (panel, previous) => {
    if (!panel) return
    retained.value = panel
    if (!previous || previous === panel) return
    const focusedInside = body.value?.contains(document.activeElement)
    void nextTick(() => {
      if (props.panel !== panel || !body.value) return
      body.value.scrollTop = 0
      if (focusedInside) close.value?.focus({ preventScroll: true })
      content.replace(body.value)
    })
  },
  { immediate: true },
)

function clear() {
  if (!props.panel) retained.value = null
}

onScopeDispose(() => {
  slide.dispose()
  content.dispose()
})
</script>

<template>
  <Transition
    :css="false"
    @enter="slide.enter"
    @leave="slide.leave"
    @enter-cancelled="slide.cancel"
    @leave-cancelled="slide.cancel"
    @after-leave="clear"
  >
    <aside
      v-if="retained"
      v-show="panel"
      id="wb-inspector"
      class="wb-panel wb-panel-right"
      aria-labelledby="wb-panel-heading"
    >
      <header>
        <h2 id="wb-panel-heading">{{ titles[retained] }}</h2>
        <button
          ref="close"
          type="button"
          class="wb-panel-close"
          aria-label="收起面板"
          @click="$emit('close')"
        >
          <X :size="19" aria-hidden="true" />
        </button>
      </header>
      <div ref="body" class="wb-panel-body">
        <WorkbenchPanel :panel="retained" :exhibition="exhibition" />
      </div>
    </aside>
  </Transition>
</template>

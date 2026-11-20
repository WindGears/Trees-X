<script setup lang="ts">
import { computed, onScopeDispose, ref, watch } from 'vue'
import { useWorkbenchStore } from '@/stores/workbench'
import type { ExhibitionPoster } from '@/lib/workbench/exhibition'
import { provideMotionSession } from '@/lib/workbench/motionSession'
import { progressActions } from '@/lib/workbench/motionConfig'
import { isAuditedTypewriterSource } from '@/lib/workbench/typewriterCandidate'
import {
  representativeTypebar,
  typebarInspectionOffset,
} from '@/lib/workbench/typewriterInspection'
import WorkbenchStage from './WorkbenchStage.vue'
import ExhibitionControls from './ExhibitionControls.vue'
import ExhibitionPartDetail from './ExhibitionPartDetail.vue'
import '@/assets/styles/workbench.css'
import '@/assets/styles/workbench-accessibility.css'
import '@/assets/styles/workbench-exhibition.css'

const props = defineProps<{ slug: string; exhibit?: ExhibitionPoster }>()
const emit = defineEmits<{ overview: [] }>()
const store = useWorkbenchStore()
const session = provideMotionSession(store)
const chapterView = ref('perspective')
const pendingId = ref('')
const revealId = ref('')
const query = new URLSearchParams(location.search)
if (!query.has('renderPipeline')) query.set('renderPipeline', 'showcase')
const renderSearch = query.toString()
const layout = computed(() => {
  const presentation = store.presentation
  const source = presentation?.source
  if (
    !presentation ||
    store.slug !== 'typewriter-study' ||
    source?.kind !== 'glb' ||
    !isAuditedTypewriterSource(source)
  )
    return
  return progressActions(presentation).find(
    (action) => action.motion.program?.type === 'typewriter-layout-v1',
  )
})
const layoutMotion = computed(() =>
  layout.value ? session.states.value[layout.value.id] : undefined,
)
const part = computed(() =>
  pendingId.value
    ? store.presentation?.hotspots.find((item) => item.id === pendingId.value)
    : store.hotspot,
)
const markers = computed(() => {
  if (part.value) return 0
  const states = Object.values(session.states.value)
  return states.some((state) => state.progress > 0.02 || state.playing) ? 5 : 0
})
const markerNames: Record<string, readonly string[]> = {
  structure: ['字杆', '按键', '色带', '机架'],
  knoll: ['字杆', '传动', '键盘', '音板', '踏板'],
  'piano-section': ['主琴盖', '弧形琴壳', '键盘框架'],
  'piano-keys': ['键盘框架', '击弦机构'],
  'piano-action': ['击弦机构', '键盘框架', '弦桥'],
  'piano-strings': ['铁板', '琴弦', '弦桥'],
  'piano-soundboard': ['音板', '弦桥'],
  'piano-dampers': ['踏板', '制音器'],
  'car-cabin': ['座舱', '左侧车门', '右侧车门'],
  'car-structure': ['楔形车身', '车轮', '后舱盖'],
}

function inspect(id: string) {
  if (!store.available || !store.presentation?.hotspots.some((item) => item.id === id)) return
  revealId.value = ''
  const state = layoutMotion.value
  if (
    layout.value &&
    id === representativeTypebar &&
    (!state || state.playing || !typebarInspectionOffset(state.progress))
  ) {
    pendingId.value = id
    store.manual()
    return
  }
  pendingId.value = ''
  store.focus(id)
}

function reveal(id: string) {
  if (!layout.value) return
  revealId.value = id
  pendingId.value = ''
  chapterView.value = 'structure'
  store.view('structure')
  store.motion('play', layout.value.id, 0.6)
}

function dismiss() {
  revealId.value = ''
  pendingId.value = ''
  if (store.hotspot) store.view(chapterView.value)
}

function navigateChapter(view: string) {
  chapterView.value = view
  pendingId.value = ''
  revealId.value = ''
}

watch(layoutMotion, (state) => {
  if (revealId.value && state && !state.playing && Math.abs(state.progress - 0.6) < 0.001)
    inspect(revealId.value)
})
watch(
  () => props.slug,
  (slug) => {
    navigateChapter('perspective')
    void store.select(slug)
  },
  { immediate: true, flush: 'sync' },
)
onScopeDispose(store.dispose)
</script>

<template>
  <div
    class="workbench wb-exhibition exhibit-live"
    :data-status="store.status"
    :data-slug="store.slug"
  >
    <div class="exhibit-live-stage" @keydown.esc="dismiss">
      <WorkbenchStage
        :exhibit="exhibit"
        :inspect-part="inspect"
        :marker-limit="markers"
        :marker-names="markerNames[chapterView]"
        :render-search="renderSearch"
        exhibition
        @overview="emit('overview')"
      />
      <ExhibitionPartDetail
        :part="part"
        :current-view="chapterView"
        :requires-expansion="Boolean(pendingId)"
        @dismiss="dismiss"
        @reveal="reveal"
      />
    </div>
    <ExhibitionControls
      v-if="store.available"
      :key="store.revision"
      @focus="inspect"
      @view="navigateChapter"
    />
  </div>
</template>

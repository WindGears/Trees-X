<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ArrowLeft, ArrowRight, Camera, CornerUpLeft, Pause, Play } from '@lucide/vue'
import { useWorkbenchStore } from '@/stores/workbench'
import { exhibitMotionSteps } from '@/lib/workbench/exhibitionMotion'
import { progressActions } from '@/lib/workbench/motionConfig'
import { useMotionSession } from '@/lib/workbench/motionSession'
import ExhibitionChapterMenu from './ExhibitionChapterMenu.vue'
import ExhibitionToolMenu from './ExhibitionToolMenu.vue'
import '@/assets/styles/exhibition-controls.css'

const emit = defineEmits<{ focus: [id: string]; view: [id: string] }>()
const store = useWorkbenchStore()
const session = useMotionSession()
const requested = ref<string[]>([])
const suggestedView = ref('perspective')
const channels = computed(() => {
  const presentation = store.presentation
  return presentation ? progressActions(presentation) : []
})
const channel = computed(
  () =>
    channels.value.find((action) => action.id === store.presentation?.structureActionId) ??
    channels.value[0],
)
const doors = computed(() => channels.value.find((action) => action.id === 'open-doors'))
const separation = computed(() => channels.value.find((action) => action.id === 'explore-parts'))
const car = computed(() => Boolean(doors.value && separation.value))
const opened = computed(() => (session.states.value['open-doors']?.progress ?? 0) >= 0.9999)
const separated = computed(() => (session.states.value['explore-parts']?.progress ?? 0) >= 0.9999)
const steps = computed(() => (channel.value ? exhibitMotionSteps(channel.value) : []))
const state = computed(() => (channel.value ? session.states.value[channel.value.id] : undefined))
const current = computed(() =>
  steps.value.findIndex((step) => Math.abs(step.value - (state.value?.progress ?? 0)) < 0.0001),
)
const playingChannel = computed(() =>
  channels.value.find(({ id }) => session.states.value[id]?.playing),
)
const pendingChannel = computed(() =>
  requested.value.find((id) => {
    const status = session.states.value[id]
    return status && Math.abs(status.target - status.progress) > 0.0001
  }),
)
const playbackId = computed(() => playingChannel.value?.id ?? pendingChannel.value)
const playbackName = computed(() => {
  const action = channels.value.find(({ id }) => id === playbackId.value)
  if (!action) return ''
  const target = session.states.value[action.id]?.target
  if (car.value && action.id === 'explore-parts') return target === 0 ? '合拢部件' : '分离部件'
  return exhibitMotionSteps(action).find(({ value }) => value === target)?.label ?? action.label
})
const next = computed(() => (current.value + 1) % steps.value.length)
const active = computed(() => steps.value[current.value])
const chapterIndicator = computed(() =>
  current.value >= 0
    ? current.value
    : steps.value.findIndex((step) => step.value === state.value?.target),
)
const typewriter = computed(() => channel.value?.motion.program?.type === 'typewriter-layout-v1')
const piano = computed(() => channel.value?.motion.program?.type === 'piano-sound-path-v1')
const hasCabinView = computed(() =>
  store.presentation?.views.some((view) => view.id === 'car-cabin'),
)
const doorOpenIntent = computed(() => carTarget('open-doors', opened.value))
const separationIntent = computed(() => carTarget('explore-parts', separated.value))
const canReset = computed(() => {
  if (car.value)
    return channels.value.some(({ id }) => (session.states.value[id]?.progress ?? 0) > 0)
  return current.value !== 0 && (next.value !== 0 || Boolean(playbackId.value))
})
const strike = computed(() =>
  store.presentation?.actions.find((action) => action.behavior?.type === 'typewriter-strike'),
)
const rod = computed(() =>
  store.presentation?.hotspots.find(
    (part) => part.marker !== false && part.name.startsWith('字杆'),
  ),
)
const title = computed(() => {
  if (playbackId.value)
    return `${playingChannel.value ? '正在切换' : '已暂停'} · ${playbackName.value}`
  if (car.value) {
    if (opened.value && separated.value) return '双门已开 · 部件已分离'
    if (opened.value) return '双门已打开'
    if (separated.value) return '部件已分离'
    return '整车'
  }
  if (current.value === 0) return '整机'
  return active.value?.label ?? '自由观察'
})
const detail = computed(() => {
  if (active.value?.description) return active.value.description
  if (typewriter.value && current.value === 1) return '外壳与键盘分层，露出下方的字杆机构。'
  if (typewriter.value && current.value === 2) return '对照外壳、键盘和传动件的排列。'
  return ''
})

function rememberRequest(id: string) {
  if (requested.value[0] !== id)
    requested.value = [id, ...requested.value.filter((prior) => prior !== id)]
}

watch(playingChannel, (action) => {
  if (action) rememberRequest(action.id)
})
watch(
  () => store.guideStep,
  (index) => {
    if (index >= 0) requested.value = []
  },
)

function rememberView(id: string) {
  suggestedView.value = id
  emit('view', id)
}

function look(id: string) {
  if (!store.presentation?.views.some((view) => view.id === id)) return
  store.view(id)
  rememberView(id)
}

function playTo(id: string, value: number) {
  rememberRequest(id)
  store.motion('play', id, value)
}

function carTarget(id: string, complete: boolean) {
  const status = session.states.value[id]
  if (status && (status.playing || requested.value.includes(id))) return status.target > 0.5
  return complete
}

function go(index: number) {
  const step = steps.value[index]
  if (!step || !channel.value) return
  if (step.view) look(step.view)
  playTo(channel.value.id, step.value)
}

function togglePlayback() {
  if (playbackId.value) store.motion(playingChannel.value ? 'pause' : 'resume', playbackId.value)
}

function toggleDoors() {
  if (!doors.value) return
  if (doorOpenIntent.value && suggestedView.value === 'car-cabin')
    rememberView(separated.value ? 'car-structure' : 'perspective')
  playTo(doors.value.id, doorOpenIntent.value ? 0 : 1)
}

function toggleSeparation() {
  if (!separation.value) return
  if (separationIntent.value && suggestedView.value === 'car-structure') rememberView('perspective')
  else if (!separationIntent.value) look('car-structure')
  playTo(separation.value.id, separationIntent.value ? 0 : 1)
}

function restoreStructure() {
  store.resetActions()
  requested.value = []
  rememberView('perspective')
}

function restoreExhibit() {
  store.restore()
  requested.value = []
  rememberView('perspective')
}

const primary = computed(() => {
  if (playbackId.value)
    return {
      label: playingChannel.value ? '暂停' : '继续',
      icon: playingChannel.value ? Pause : Play,
      run: togglePlayback,
    }
  if (car.value) {
    if (opened.value && hasCabinView.value)
      return { label: '观察座舱', icon: Camera, run: () => look('car-cabin') }
    if (!opened.value) return { label: '打开双门', icon: ArrowRight, run: toggleDoors }
    return undefined
  }
  const upcoming = steps.value[next.value]
  if (next.value > 0 && upcoming)
    return { label: upcoming.label, icon: ArrowRight, run: () => go(next.value) }
  if (current.value > 0) return { label: '复原结构', icon: CornerUpLeft, run: restoreStructure }
  return undefined
})
</script>

<template>
  <section class="exhibit-controls" aria-label="展品操作">
    <div class="exhibit-controls-copy">
      <p class="exhibit-controls-state" role="status">
        {{ title }}
        <span v-if="piano && chapterIndicator >= 0" class="exhibit-chapter-count"
          >{{ chapterIndicator + 1 }} / {{ steps.length }}</span
        >
      </p>
      <p v-if="detail" class="exhibit-controls-detail">{{ detail }}</p>
    </div>
    <div class="exhibit-controls-actions">
      <button v-if="primary" type="button" class="exhibit-control-primary" @click="primary.run">
        {{ primary.label }}
        <component :is="primary.icon" :size="16" aria-hidden="true" />
      </button>
      <template v-if="car">
        <button v-if="doorOpenIntent" type="button" @click="toggleDoors">关闭双门</button>
        <button type="button" @click="toggleSeparation">
          {{ separationIntent ? '合拢部件' : '分离部件' }}
        </button>
      </template>
      <template v-if="piano">
        <button v-if="current > 0" type="button" @click="go(current - 1)">
          <ArrowLeft :size="15" aria-hidden="true" /> 上一步
        </button>
        <ExhibitionChapterMenu :steps="steps" :selected="current" @select="go" />
      </template>
      <button v-if="strike" type="button" @click="store.action(strike.id)">敲击 A 键</button>
      <button v-if="rod && current === 1" type="button" @click="emit('focus', rod.id)">
        查看字杆
      </button>
      <ExhibitionToolMenu
        :can-reset="canReset"
        @focus="emit('focus', $event)"
        @reset="restoreStructure"
        @restore="restoreExhibit"
      />
    </div>
  </section>
</template>

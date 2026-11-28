<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Pause, Play, ChevronLeft, ChevronRight } from '@lucide/vue'
import { useWorkbenchStore } from '@/stores/workbench'
import { useMotionSession } from '@/lib/workbench/motionSession'
import { galleryInteraction } from '@/lib/workbench/galleryInteraction'
import ExhibitionChapterMenu from '@/components/workbench/ExhibitionChapterMenu.vue'
const emit = defineEmits<{ view: [id: string] }>()
const store = useWorkbenchStore()
const session = useMotionSession()
const descriptor = computed(() => galleryInteraction(store.presentation))
const requested = ref('')
const state = computed(() =>
  descriptor.value.chapterMotion
    ? session.states.value[descriptor.value.chapterMotion.id]
    : undefined,
)
const selected = computed(() =>
  descriptor.value.steps.findIndex(
    (step) =>
      Math.abs(
        step.value -
          (state.value?.playing || requested.value
            ? (state.value?.target ?? 0)
            : (state.value?.progress ?? 0)),
      ) < 0.0001,
  ),
)
const playing = computed(
  () => Object.entries(session.states.value).find(([, state]) => state.playing)?.[0],
)
const pending = computed(() => {
  const state = session.states.value[requested.value]
  return state && Math.abs(state.progress - state.target) > 0.0001 ? requested.value : undefined
})
const playback = computed(() => playing.value ?? pending.value)
watch(playing, (id) => {
  if (id) requested.value = id
})
function go(index: number) {
  const { chapterMotion, steps } = descriptor.value
  const step = steps[index]
  if (!chapterMotion || !step) return
  if (step.view) {
    store.view(step.view)
    emit('view', step.view)
  }
  requested.value = chapterMotion.id
  store.motion('play', chapterMotion.id, step.value)
}
function toggled(id: string) {
  const status = session.states.value[id]
  return (
    (status?.playing || requested.value === id ? (status?.target ?? 0) : (status?.progress ?? 0)) >
    0.5
  )
}
watch(
  () => store.resetMotionRequest,
  () => {
    requested.value = ''
  },
)
function toggle(id: string) {
  const target = toggled(id) ? 0 : 1
  requested.value = id
  store.motion('play', id, target)
}
function play() {
  if (playback.value) store.motion(playing.value ? 'pause' : 'resume', playback.value)
}
function cabin() {
  if (descriptor.value.cabin) {
    store.view(descriptor.value.cabin.id)
    emit('view', descriptor.value.cabin.id)
  }
}
</script>
<template>
  <section class="museum-controls" aria-label="展品操作">
    <div class="museum-dock" :class="{ 'museum-dock-numbered': descriptor.numbered }">
      <template v-if="descriptor.numbered">
        <button :disabled="selected <= 0" aria-label="上一章" @click="go(selected - 1)">
          <ChevronLeft :size="17" />
        </button>
        <ExhibitionChapterMenu :steps="descriptor.steps" :selected="selected" @select="go" />
        <button
          :disabled="selected >= descriptor.steps.length - 1"
          aria-label="下一章"
          @click="go(selected + 1)"
        >
          <ChevronRight :size="17" />
        </button>
        <div class="museum-chapter-numbers" aria-label="章节直达">
          <button
            v-for="(step, index) in descriptor.steps"
            :key="step.value"
            :aria-label="step.label"
            :aria-pressed="selected === index"
            @click="go(index)"
          >
            {{ index + 1 }}
          </button>
        </div>
      </template>
      <template v-else
        ><button
          v-for="(step, index) in descriptor.steps"
          :key="step.value"
          :aria-pressed="selected === index"
          @click="go(index)"
        >
          {{ step.label }}
        </button></template
      >
      <button
        v-for="action in descriptor.independent"
        :key="action.id"
        :aria-pressed="toggled(action.id)"
        @click="toggle(action.id)"
      >
        {{ toggled(action.id) ? action.motion.closeLabel : action.motion.openLabel }}
      </button>
      <button
        v-for="action in descriptor.actions"
        :key="action.id"
        class="museum-strike"
        :aria-pressed="action.kind === 'toggle' ? Boolean(store.actions[action.id]) : undefined"
        @click="store.action(action.id)"
      >
        {{ action.label }}
      </button>
      <button
        v-if="descriptor.cabin"
        :disabled="(session.states.value['open-doors']?.progress ?? 0) < 0.999"
        @click="cabin"
      >
        观察座舱
      </button>
      <button
        class="museum-playback"
        :class="{ 'is-idle': !playback }"
        :disabled="!playback"
        :aria-hidden="!playback"
        :tabindex="playback ? 0 : -1"
        @click="play"
      >
        <component :is="playing ? Pause : Play" :size="15" />{{ playing ? '暂停' : '继续' }}
      </button>
    </div>
    <p class="museum-action-status" role="status">
      {{
        playing
          ? '正在切换结构 · 拖动即可暂停'
          : pending
            ? '已暂停 · 可自由观察或继续'
            : (descriptor.steps[selected]?.label ?? '自由观察')
      }}
    </p>
  </section>
</template>

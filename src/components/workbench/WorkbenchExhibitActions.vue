<script setup lang="ts">
import { computed } from 'vue'
import { Camera, Pause, Play, RotateCcw } from '@lucide/vue'
import { useWorkbenchStore } from '@/stores/workbench'
import { useMotionSession } from '@/lib/workbench/motionSession'
import type { Action, ProgressAction } from '@/lib/workbench/types'
import { exhibitMotionSteps } from '@/lib/workbench/exhibitionMotion'

const props = defineProps<{ actions: ProgressAction[]; discrete: Action[] }>()
const store = useWorkbenchStore()
const session = useMotionSession()
const groups = computed(() =>
  props.actions.map((action) => {
    const state = session.states.value[action.id] ?? { progress: 0, target: 0, playing: false }
    const steps = exhibitMotionSteps(action)
    const current = steps.find((step) => Math.abs(step.value - state.progress) < 0.0001)
    const target = steps.find((step) => Math.abs(step.value - state.target) < 0.0001)
    const chosen = current ?? target
    const view = store.presentation?.views.find((view) => view.id === chosen?.view)
    const status = state.playing
      ? target
        ? `正在前往「${target.label}」`
        : '正在改变结构'
      : current
        ? `当前：${current.label}`
        : '已暂停，可以自由观察'
    return { action, steps, state, current, view, status }
  }),
)
</script>

<template>
  <div class="wb-action-list">
    <button
      v-for="action in discrete"
      :key="action.id"
      type="button"
      :disabled="!store.available"
      :aria-pressed="action.kind === 'toggle' ? Boolean(store.actions[action.id]) : undefined"
      @click="store.action(action.id)"
    >
      {{ action.label }}
    </button>
    <section
      v-for="group in groups"
      :key="group.action.id"
      class="wb-progress wb-exhibit-action"
      :data-motion-id="group.action.id"
      :aria-label="group.action.label"
    >
      <h3>{{ group.action.label }}</h3>
      <div class="wb-exhibit-action-steps" role="group" :aria-label="group.action.label">
        <button
          v-for="step in group.steps"
          :key="step.value"
          type="button"
          :disabled="!store.available"
          :aria-pressed="step === group.current"
          @click="store.motion('play', group.action.id, step.value)"
        >
          {{ step.label }}
        </button>
      </div>
      <p class="wb-progress-state" role="status">{{ group.status }}</p>
      <p v-if="group.current?.description">{{ group.current.description }}</p>
      <div class="wb-progress-buttons">
        <button
          type="button"
          :disabled="
            !store.available ||
            (!group.state.playing && group.state.progress === group.state.target)
          "
          :aria-label="group.action.label + (group.state.playing ? '暂停' : '继续')"
          @click="store.motion(group.state.playing ? 'pause' : 'resume', group.action.id)"
        >
          <Pause v-if="group.state.playing" :size="15" />
          <Play v-else :size="15" />
          {{ group.state.playing ? '暂停' : '继续' }}
        </button>
        <button
          v-if="group.view"
          type="button"
          :disabled="!store.available"
          @click="store.view(group.view.id)"
        >
          <Camera :size="15" />{{ group.view.label }}
        </button>
      </div>
    </section>
    <button
      v-if="store.presentation?.structure && !store.presentation.structureActionId"
      type="button"
      :disabled="!store.available"
      :aria-pressed="store.exploded"
      @click="store.structure(!store.exploded)"
    >
      {{ store.exploded ? '合拢部件' : '展开部件' }}
    </button>
    <div class="wb-progress-buttons">
      <button type="button" :disabled="!store.available" @click="store.resetActions()">
        <RotateCcw :size="15" />复原动作
      </button>
      <button type="button" :disabled="!store.available" @click="store.overview()">返回全景</button>
    </div>
  </div>
</template>

<style scoped>
.wb-exhibit-action-steps {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.45rem;
}
.wb-exhibit-action-steps button {
  justify-content: flex-start;
  white-space: normal;
}
.wb-action-list .wb-progress {
  padding-block-start: 0.85rem;
  border-block-start: 1px solid var(--wb-line);
}
.wb-action-list > .wb-progress-buttons {
  padding-block: 0.75rem;
  border-block-start: 1px solid var(--wb-line);
}
</style>

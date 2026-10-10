<script setup lang="ts">
import { computed } from 'vue'
import { Camera, Pause, Play, RotateCcw } from '@lucide/vue'
import { useWorkbenchStore } from '@/stores/workbench'
import { useMotionSession } from '@/lib/workbench/motionSession'
import type { ProgressAction } from '@/lib/workbench/types'

const props = defineProps<{ actions: ProgressAction[] }>()
const store = useWorkbenchStore()
const session = useMotionSession()
const definitions = [
  {
    id: 'open-doors',
    initial: '双门已关闭。',
    complete: '双门已打开，可自由观察。',
  },
  {
    id: 'explore-parts',
    initial: '部件已合拢。',
    complete: '部件已分离，可自由观察。',
  },
]
const controls = computed(() =>
  definitions.flatMap((definition) => {
    const action = props.actions.find((entry) => entry.id === definition.id)
    if (!action) return []
    const status = session.states.value[action.id] ?? {
      progress: 0,
      target: 1,
      playing: false,
    }
    const message = status.playing
      ? `正在${status.target > status.progress ? action.motion.openLabel : action.motion.closeLabel}，可随时暂停。`
      : status.progress < 0.0001
        ? definition.initial
        : status.progress > 0.9999
          ? definition.complete
          : '已停留在当前位置，可自由观察或继续。'
    return [{ ...definition, action, status, message }]
  }),
)
const views = computed(
  () =>
    store.presentation?.views.filter((view) =>
      ['perspective', 'car-cabin', 'car-structure'].includes(view.id),
    ) ?? [],
)
</script>

<template>
  <section class="wb-car-motion" aria-label="汽车结构与动作">
    <section
      v-for="control in controls"
      :key="control.id"
      class="wb-progress wb-car-control"
      :data-motion-id="control.id"
      :aria-label="control.action.label"
    >
      <h3>{{ control.action.label }}</h3>
      <div class="wb-car-choices" role="group" :aria-label="control.action.label">
        <button
          type="button"
          :disabled="!store.available"
          :aria-pressed="control.status.progress > 0.9999"
          @click="store.motion('play', control.id, 1)"
        >
          {{ control.action.motion.openLabel }}
        </button>
        <button
          type="button"
          :disabled="!store.available"
          :aria-pressed="control.status.progress < 0.0001"
          @click="store.motion('play', control.id, 0)"
        >
          {{ control.action.motion.closeLabel }}
        </button>
      </div>
      <p class="wb-progress-state" role="status">{{ control.message }}</p>
      <button
        type="button"
        class="wb-car-pause"
        :disabled="
          !store.available ||
          (!control.status.playing &&
            (control.status.progress === control.status.target || control.status.progress === 0))
        "
        :aria-label="control.action.label + (control.status.playing ? '暂停' : '继续')"
        @click="store.motion(control.status.playing ? 'pause' : 'resume', control.id)"
      >
        <Pause v-if="control.status.playing" :size="15" /><Play v-else :size="15" />{{
          control.status.playing ? '暂停' : '继续'
        }}
      </button>
    </section>
    <template v-if="controls.length">
      <p class="wb-note">开门与部件分离可以组合，动作变化不会移动你的观察视角。</p>
      <button
        type="button"
        class="wb-car-reset"
        :disabled="!store.available"
        @click="store.resetActions()"
      >
        <RotateCcw :size="15" />复原动作
      </button>
      <small class="wb-car-reset-note">合拢双门与部件，保留当前配色和镜头。</small>
    </template>
    <section v-if="views.length" class="wb-car-framing" aria-label="汽车取景">
      <h3>换个角度观察</h3>
      <p>取景只调整镜头，保留当前车门与部件状态。</p>
      <div class="wb-car-views">
        <button
          v-for="view in views"
          :key="view.id"
          type="button"
          :disabled="!store.available"
          :aria-pressed="store.viewId === view.id"
          @click="store.view(view.id)"
        >
          <Camera :size="15" />{{ view.label }}
        </button>
      </div>
    </section>
  </section>
</template>

<style scoped>
.wb-car-control + .wb-car-control,
.wb-car-framing {
  margin-top: 28px;
  padding-top: 24px;
  border-top: 1px solid var(--wb-line);
}
.wb-car-choices {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin-bottom: 14px;
}
.wb-car-choices button {
  justify-content: center;
  padding-inline: 8px;
  line-height: 1.5;
}
.wb-car-pause,
.wb-car-reset {
  width: 100%;
}
.wb-car-reset-note {
  display: block;
  margin-top: 10px;
  color: var(--wb-muted);
  font-size: 12px;
  line-height: 1.8;
}
.wb-car-views {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
</style>

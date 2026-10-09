<script setup lang="ts">
import { computed } from 'vue'
import { Pause, Play, RotateCcw } from '@lucide/vue'
import { useWorkbenchStore } from '@/stores/workbench'
import { useMotionSession } from '@/lib/workbench/motionSession'
import type { ProgressAction } from '@/lib/workbench/types'

const props = defineProps<{ action: ProgressAction }>()
const store = useWorkbenchStore(),
  session = useMotionSession()
const status = computed(
  () => session.states.value[props.action.id] ?? { progress: 0, target: 1, playing: false },
)
const percent = computed(() => Math.round(status.value.progress * 1000) / 10)
const inputId = computed(() => 'wb-progress-' + props.action.id)
function seek(event: Event) {
  if (event.target instanceof HTMLInputElement)
    store.motion('seek', props.action.id, event.target.valueAsNumber / 100)
}
</script>
<template>
  <section class="wb-progress" :aria-labelledby="inputId + '-label'" :data-motion-id="action.id">
    <div class="wb-progress-heading">
      <label :id="inputId + '-label'" :for="inputId">{{ action.label }}</label>
      <output :for="inputId">{{ percent.toFixed(1) }}%</output>
    </div>
    <input
      :id="inputId"
      type="range"
      min="0"
      max="100"
      step="0.1"
      :value="percent"
      :disabled="!store.available"
      :aria-valuetext="percent.toFixed(1) + '%'"
      @pointerdown="store.motion('pause', action.id)"
      @input="seek"
    />
    <p class="wb-progress-state">
      {{ status.playing ? '播放中' : percent === 0 ? '初始状态' : '已停留，可自由观察' }}
    </p>
    <div class="wb-progress-buttons">
      <button
        type="button"
        :disabled="!store.available || percent === 100"
        @click="store.motion('play', action.id, 1)"
      >
        {{ action.motion.openLabel }}
      </button>
      <button
        type="button"
        :disabled="!store.available || (!status.playing && status.progress === status.target)"
        @click="store.motion(status.playing ? 'pause' : 'resume', action.id)"
      >
        <Pause v-if="status.playing" :size="15" /><Play v-else :size="15" />{{
          status.playing ? '暂停' : '继续'
        }}
      </button>
      <button
        type="button"
        :disabled="!store.available || percent === 0"
        @click="store.motion('play', action.id, 0)"
      >
        {{ action.motion.closeLabel }}
      </button>
      <button
        type="button"
        :disabled="!store.available"
        :aria-label="action.label + '复原动作'"
        @click="store.motion('reset', action.id)"
      >
        <RotateCcw :size="15" />复原动作
      </button>
    </div>
  </section>
</template>

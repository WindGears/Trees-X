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
const choices = [
  { value: 0, label: '合拢整机' },
  { value: 0.6, label: '分层展开' },
  { value: 1, label: '平铺部件' },
]
</script>
<template>
  <section
    class="wb-progress wb-layout-motion"
    :data-motion-id="action.id"
    :aria-label="action.label"
  >
    <h3>{{ action.label }}</h3>
    <p>先展开观察机构，或把部件平铺。任何时候都能暂停，自由靠近查看。</p>
    <div class="wb-layout-choices">
      <button
        v-for="choice in choices"
        :key="choice.value"
        type="button"
        :disabled="!store.available"
        :aria-pressed="Math.abs(status.progress - choice.value) < 0.0001"
        @click="store.motion('play', action.id, choice.value)"
      >
        {{ choice.label }}
      </button>
    </div>
    <p class="wb-progress-state" role="status">
      {{
        status.playing
          ? '正在改变结构，点击暂停可以停留。'
          : status.progress < 0.0001
            ? '整机状态'
            : '已停留，可自由观察'
      }}
    </p>
    <div class="wb-progress-buttons">
      <button
        type="button"
        :disabled="!store.available || (!status.playing && status.progress === status.target)"
        @click="store.motion(status.playing ? 'pause' : 'resume', action.id)"
      >
        <Pause v-if="status.playing" :size="15" /><Play v-else :size="15" />{{
          status.playing ? '暂停' : '继续'
        }}
      </button>
      <button type="button" :disabled="!store.available" @click="store.motion('reset', action.id)">
        <RotateCcw :size="15" />复原动作
      </button>
    </div>
    <p class="wb-note">结构变化保留你的观察视角。看完整布局时，可以选择下方取景。</p>
    <div class="wb-progress-buttons">
      <button
        v-for="view in store.presentation?.views.filter((v) =>
          ['structure', 'knoll'].includes(v.id),
        )"
        :key="view.id"
        type="button"
        :disabled="!store.available"
        @click="store.view(view.id)"
      >
        {{ view.label }}
      </button>
    </div>
  </section>
</template>

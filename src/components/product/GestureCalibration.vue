<script setup lang="ts">
import { Button } from '@/components/ui/button'
import type { CalibrationStage } from '@/lib/gesture/calibration'
defineProps<{
  state: { stage: CalibrationStage; message: string; progress: number }
  calibrated: boolean
  active: boolean
}>()
defineEmits<{ start: [stage: 'open' | 'pinch']; cancel: []; reset: [] }>()
</script>

<template>
  <div class="gesture-calibration">
    <div class="gesture-actions">
      <Button
        v-if="!['open', 'prepare-pinch', 'pinch'].includes(state.stage)"
        variant="outline"
        :disabled="!active"
        @click="$emit('start', 'open')"
      >
        {{ calibrated ? '重新校准捏合' : '校准捏合' }}
      </Button>
      <Button
        v-if="state.stage === 'prepare-pinch'"
        variant="outline"
        :disabled="!active"
        @click="$emit('start', 'pinch')"
        >开始采集捏合</Button
      >
      <Button
        v-if="['open', 'prepare-pinch', 'pinch'].includes(state.stage)"
        variant="ghost"
        @click="$emit('cancel')"
        >取消校准</Button
      >
      <Button v-else-if="calibrated" variant="ghost" @click="$emit('reset')">恢复默认阈值</Button>
      <span>{{ calibrated ? '使用本次校准' : '使用默认阈值' }}</span>
    </div>
    <p role="status">
      {{
        state.stage === 'idle'
          ? '点不中时先校准：依次记录张开、捏合两种姿势。仅在本次页面中使用。'
          : state.message
      }}
    </p>
    <progress
      v-if="state.stage === 'open' || state.stage === 'pinch'"
      :value="state.progress"
      max="1"
      :aria-label="state.stage === 'open' ? '张开姿势采集进度' : '捏合姿势采集进度'"
    ></progress>
  </div>
</template>

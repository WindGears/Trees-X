<script setup lang="ts">
import { computed } from 'vue'
import type { RefinementStatus } from '@/lib/workbench/rendering/refinementTypes'
const props = defineProps<{ status?: RefinementStatus; notice?: string }>()
defineEmits<{ retry: []; refine: []; realtime: [value: boolean] }>()
const label = computed(() => {
  if (!props.status) return props.notice
  const labels = {
    raster: '实时展示',
    waiting: '实时展示',
    preparing: '正在准备精修',
    sampling: '画面精修中',
    denoising: '正在整理光影',
    blending: '精细画面就绪',
    ready: props.status.target === 1024 ? '完整精修 · 原图' : '精细展示',
    realtime: '仅实时展示',
    paused: '精修已暂停',
    error: '精修暂不可用',
  }
  return labels[props.status.phase]
})
</script>

<template>
  <div
    v-if="status || notice"
    class="wb-refinement"
    :class="{ 'wb-refinement-error': status?.error }"
  >
    <span class="wb-refinement-label" aria-live="polite">{{ label }}</span>
    <template v-if="status?.slug">
      <button v-if="status.error" type="button" @click="$emit('retry')">重试精修</button>
      <button
        v-else
        type="button"
        :disabled="status.target === 1024 && !status.realtime"
        @click="$emit('refine')"
      >
        继续精修
      </button>
      <button
        type="button"
        :aria-pressed="status.realtime"
        @click="$emit('realtime', !status.realtime)"
      >
        {{ status.realtime ? '开启静止精修' : '仅实时展示' }}
      </button>
    </template>
    <p v-if="status?.error" role="status">{{ status.error }}，仍可正常观察商品。</p>
  </div>
</template>

<style scoped>
.wb-refinement {
  position: absolute;
  left: 24px;
  bottom: 74px;
  z-index: 7;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  max-width: min(430px, calc(100% - 48px));
  padding: 8px 10px;
  border: 1px solid rgb(255 255 255 / 48%);
  border-radius: 14px;
  background: rgb(246 248 244 / 80%);
  backdrop-filter: blur(16px);
  color: #29342b;
  font-size: 12px;
}
.wb-refinement-label {
  margin-right: 6px;
}
button {
  min-height: 32px;
  padding: 0 9px;
  border: 0;
  border-radius: 8px;
  background: rgb(28 47 34 / 6%);
  color: inherit;
  font: inherit;
  cursor: pointer;
  transition: background 160ms ease;
}
button:hover {
  background: rgb(28 47 34 / 12%);
}
button:focus-visible {
  outline: 2px solid #38634b;
  outline-offset: 2px;
}
button:disabled {
  cursor: default;
  opacity: 0.5;
}
p {
  flex-basis: 100%;
  margin: 2px 0 0;
  line-height: 1.5;
}
@media (max-width: 600px) {
  .wb-refinement {
    top: auto;
    bottom: 170px;
    left: 12px;
    max-width: calc(100% - 24px);
  }
}
@media (prefers-reduced-motion: reduce) {
  button {
    transition: none;
  }
}
</style>

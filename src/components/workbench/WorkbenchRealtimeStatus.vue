<script setup lang="ts">
import { computed } from 'vue'
import type { RealtimeStatus } from '@/lib/workbench/rendering/realtime/types'
const props = defineProps<{ status?: RealtimeStatus; notice?: string }>()
const detail = computed(() => props.status?.indirectLighting)
const message = computed(() => {
  if (props.notice) return props.notice
  if (props.status?.error) return '实时光影暂不可用，请重新加载'
  if (detail.value?.error) return '实时光影 · 空间增强不可用，已用基础光照'
  if (detail.value?.preparing) return '实时光影 · 准备空间增强'
  if (detail.value?.actual === 'ddgi') return 'WebGPU · 实时光影与空间增强'
  return 'WebGPU · 实时光影'
})
</script>

<template>
  <p v-if="status || notice" class="wb-lighting-status" role="status">
    <span :title="detail?.error ?? undefined" :data-indirect-lighting="detail?.actual">{{
      message
    }}</span>
  </p>
</template>

<style scoped>
.wb-lighting-status {
  position: absolute;
  left: 24px;
  bottom: 74px;
  z-index: 7;
  max-width: calc(100% - 48px);
  margin: 0;
  padding: 8px 10px;
  border-radius: 12px;
  background: rgb(246 248 244 / 80%);
  backdrop-filter: blur(16px);
  color: #29332e;
  font-size: 12px;
  line-height: 1.5;
  pointer-events: none;
}
@media (max-width: 600px) {
  .wb-lighting-status {
    bottom: 170px;
    left: 12px;
    max-width: calc(100% - 24px);
  }
}
</style>

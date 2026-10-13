<script setup lang="ts">
import type { RealtimeStatus } from '@/lib/workbench/rendering/realtime/types'
defineProps<{ status?: RealtimeStatus; notice?: string }>()
</script>

<template>
  <p v-if="status || notice" class="wb-lighting-status" role="status">
    {{ notice || (status?.error ? '实时光影暂不可用，请重新加载' : 'WebGPU · 实时光影') }}
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

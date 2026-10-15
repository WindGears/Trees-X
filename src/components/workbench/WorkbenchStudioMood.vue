<script setup lang="ts">
import { Moon, Sun } from '@lucide/vue'
import type { StudioEnvironmentStatus } from '@/lib/workbench/studio/mood'

defineProps<{ mood: 'light' | 'dark'; disabled?: boolean; status?: StudioEnvironmentStatus }>()
defineEmits<{ change: [mood: 'light' | 'dark'] }>()
</script>

<template>
  <div class="wb-studio-mood" role="group" aria-label="展示环境">
    <button
      type="button"
      :aria-pressed="mood === 'light'"
      :disabled="disabled"
      aria-label="切换明亮环境"
      @click="$emit('change', 'light')"
    >
      <Sun :size="15" aria-hidden="true" />
      明亮
    </button>
    <button
      type="button"
      :aria-pressed="mood === 'dark'"
      :disabled="disabled"
      aria-label="切换暖夜环境"
      @click="$emit('change', 'dark')"
    >
      <Moon :size="15" aria-hidden="true" />
      暖夜
    </button>
    <span v-if="mood === 'dark' && status?.phase === 'loading'" class="wb-mood-note" role="status"
      >准备环境…</span
    >
    <button
      v-if="mood === 'dark' && status?.phase === 'error'"
      class="wb-mood-retry"
      :title="status.error"
      @click="$emit('change', 'dark')"
    >
      环境加载失败，重试
    </button>
  </div>
</template>

<style scoped>
.wb-studio-mood {
  position: absolute;
  z-index: 7;
  left: 24px;
  bottom: 122px;
  display: flex;
  gap: 2px;
  padding: 4px;
  border-radius: 14px;
  background: #29241f;
  color: #f0e5d7;
  box-shadow: 0 6px 20px rgb(18 12 8 / 18%);
}
.wb-mood-note,
.wb-mood-retry {
  position: absolute;
  left: 0;
  bottom: calc(100% + 8px);
  white-space: nowrap;
  font-size: 12px;
  color: #f0e5d7;
}
.wb-studio-mood button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-width: 72px;
  min-height: 36px;
  padding: 7px 11px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  line-height: 1.5;
  cursor: pointer;
  transition:
    background 160ms ease-out,
    color 160ms ease-out;
}
.wb-studio-mood button:hover:not(:disabled) {
  background: rgb(255 244 224 / 12%);
}
.wb-studio-mood button[aria-pressed='true'] {
  background: #e6c89e;
  color: #33291e;
}
.wb-studio-mood button[aria-pressed='true']:hover:not(:disabled) {
  background: #f0d5ae;
}
.wb-studio-mood button:focus-visible {
  outline: 2px solid #fff2d9;
  outline-offset: 2px;
}
.wb-studio-mood button:disabled {
  opacity: 0.5;
  cursor: default;
}
@supports (backdrop-filter: blur(1px)) {
  .wb-studio-mood {
    background: rgb(41 36 31 / 90%);
    backdrop-filter: blur(18px);
  }
}
@media (max-width: 600px) {
  .wb-studio-mood {
    left: 12px;
    bottom: 216px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .wb-studio-mood button {
    transition: none;
  }
}
</style>

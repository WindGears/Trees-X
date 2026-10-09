<script setup lang="ts">
withDefaults(
  defineProps<{
    index: number
    count: number
    name: string
    reasons?: string[]
    copyable?: boolean
  }>(),
  { copyable: true, reasons: () => [] },
)
const emit = defineEmits<{ move: [direction: 1 | -1]; copy: []; remove: [] }>()
</script>
<template>
  <div class="ad-row-tools">
    <button
      type="button"
      :aria-label="'上移' + name"
      :disabled="index === 0"
      @click="emit('move', -1)"
    >
      上移
    </button>
    <button
      type="button"
      :aria-label="'下移' + name"
      :disabled="index === count - 1"
      @click="emit('move', 1)"
    >
      下移
    </button>
    <button
      v-if="copyable !== false"
      type="button"
      :aria-label="'复制' + name"
      @click="emit('copy')"
    >
      复制
    </button>
    <button
      type="button"
      :aria-label="'删除' + name"
      :disabled="Boolean(reasons?.length)"
      @click="emit('remove')"
    >
      删除
    </button>
    <p v-if="reasons?.length" class="ad-muted">{{ reasons.join(' ') }}</p>
  </div>
</template>

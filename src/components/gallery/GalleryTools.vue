<script setup lang="ts">
import { Box, Camera, Layers, MoreHorizontal } from '@lucide/vue'
import { useWorkbenchStore } from '@/stores/workbench'
defineProps<{ panel: string }>()
const emit = defineEmits<{ panel: [value: string] }>()
const store = useWorkbenchStore()
</script>
<template>
  <nav class="museum-tools" aria-label="观察工具">
    <button
      v-if="store.presentation?.hotspots.length"
      :aria-expanded="panel === 'parts'"
      @click="emit('panel', 'parts')"
    >
      <Box :size="17" aria-hidden="true" />部件
    </button>
    <button
      v-if="(store.presentation?.finishes.length ?? 0) > 1 || store.carPaintAvailable"
      :aria-expanded="panel === 'finishes'"
      @click="emit('panel', 'finishes')"
    >
      <Layers :size="17" aria-hidden="true" />外观
    </button>
    <button :aria-expanded="panel === 'views'" @click="emit('panel', 'views')">
      <Camera :size="17" aria-hidden="true" />视角
    </button>
    <button aria-label="更多操作" :aria-expanded="panel === 'more'" @click="emit('panel', 'more')">
      <MoreHorizontal :size="19" aria-hidden="true" />
    </button>
  </nav>
</template>

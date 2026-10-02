<script setup lang="ts">
import { computed } from 'vue'
import { Palette, ScanSearch, Layers2, Route, RotateCcw, Minus, Plus } from '@lucide/vue'
import { useWorkbenchStore } from '@/stores/workbench'
import type { Panel } from '@/lib/workbench/types'
const store = useWorkbenchStore()
const emit = defineEmits<{ panel: [value: Panel] }>()
const tools = computed(() => [
  ...(store.presentation?.finishes.length
    ? [{ id: 'appearance' as const, label: '外观', icon: Palette }]
    : []),
  ...(store.presentation?.hotspots.length
    ? [{ id: 'details' as const, label: '细节', icon: ScanSearch }]
    : []),
  ...(store.presentation?.structure || store.presentation?.actions.length
    ? [{ id: 'actions' as const, label: '结构与动作', icon: Layers2 }]
    : []),
  ...(store.presentation?.guide.length
    ? [{ id: 'guide' as const, label: '导览', icon: Route }]
    : []),
])
</script>
<template>
  <div class="wb-tools">
    <div class="wb-camera-tools" aria-label="观察工具">
      <label
        ><span class="sr-only">观察视角</span
        ><select
          aria-label="观察视角"
          :value="store.viewId"
          :disabled="!store.available"
          @change="store.view(($event.target as HTMLSelectElement).value)"
        >
          <option value="" disabled>自由观察</option>
          <option v-for="view in store.presentation?.views" :key="view.id" :value="view.id">
            {{ view.label }}
          </option>
        </select></label
      >
      <button type="button" aria-label="缩小" :disabled="!store.available" @click="store.zoom(-1)">
        <Minus :size="17" />
      </button>
      <button type="button" aria-label="放大" :disabled="!store.available" @click="store.zoom(1)">
        <Plus :size="17" />
      </button>
      <button type="button" :disabled="!store.available" @click="store.view()">
        <RotateCcw :size="15" />复位视角
      </button>
    </div>
    <nav class="wb-feature-tools" aria-label="探索商品">
      <button
        v-for="tool in tools"
        :key="tool.id"
        type="button"
        :disabled="!store.available"
        :aria-expanded="store.panel === tool.id"
        :aria-pressed="store.panel === tool.id"
        aria-controls="wb-inspector"
        @click="emit('panel', tool.id)"
      >
        <component :is="tool.icon" :size="17" />{{ tool.label }}
      </button>
    </nav>
  </div>
</template>

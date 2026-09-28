<script setup lang="ts">
import { computed, inject } from 'vue'
import { Hand, Layers2, Palette, ScanSearch, Undo2 } from '@lucide/vue'
import { useProductStore, type StudioPanel } from '@/stores/product'
import { gestureKey } from '@/lib/gesture/bridge'
defineProps<{ available: boolean }>()
const store = useProductStore()
const bridge = inject(gestureKey)!
const tools = computed(() => [
  { id: 'appearance' as StudioPanel, label: '外观', icon: Palette },
  { id: 'details' as StudioPanel, label: '细节', icon: ScanSearch },
  ...(store.product.structure.length
    ? [{ id: 'structure' as StudioPanel, label: '结构', icon: Layers2 }]
    : []),
  { id: 'gesture' as StudioPanel, label: '手势', icon: Hand },
])
function overview() {
  bridge.takeMouse()
  bridge.selected.value = false
  store.returnToOverview()
}
</script>
<template>
  <div class="experience-tools">
    <button
      v-if="bridge.selected.value || store.exploded || store.viewPreset === 'detail'"
      class="overview-action"
      type="button"
      :disabled="!available"
      @click="overview"
    >
      <Undo2 :size="16" /> 返回全景
    </button>
    <nav class="experience-dock" aria-label="探索商品">
      <button
        v-for="tool in tools"
        :key="tool.id"
        type="button"
        :disabled="!available"
        :aria-pressed="store.panel === tool.id"
        :aria-expanded="store.panel === tool.id"
        aria-controls="studio-console"
        @click="store.openPanel(store.panel === tool.id ? null : tool.id)"
      >
        <component :is="tool.icon" :size="19" />{{ tool.label }}
      </button>
    </nav>
  </div>
</template>

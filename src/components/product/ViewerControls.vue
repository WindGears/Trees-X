<script setup lang="ts">
import { inject } from 'vue'
import { gestureKey } from '@/lib/gesture/bridge'
import { Minus, Plus, RotateCcw } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { useProductStore } from '@/stores/product'
import type { ViewPreset } from '@/stores/product'

defineProps<{ available: boolean }>()
const store = useProductStore()
const bridge = inject(gestureKey)!
function setView(view: ViewPreset) {
  bridge.takeMouse()
  store.setView(view)
}
function zoom(direction: 1 | -1) {
  bridge.takeMouse()
  store.zoom(direction)
}
const views: { id: ViewPreset; label: string }[] = [
  { id: 'perspective', label: '立体' },
  { id: 'front', label: '正面' },
  { id: 'back', label: '背面' },
]
</script>

<template>
  <div
    id="product-controls"
    class="viewer-controls"
    role="group"
    aria-label="产品视角控制"
    tabindex="-1"
  >
    <div class="view-presets" role="group" aria-label="选择视角">
      <Button
        v-for="view in views"
        :key="view.id"
        variant="ghost"
        :disabled="!available"
        @click="setView(view.id)"
      >
        {{ view.label }}
      </Button>
    </div>
    <span class="control-divider" aria-hidden="true"></span>
    <div class="view-actions" role="group" aria-label="缩放与复位">
      <Button
        variant="ghost"
        size="icon"
        aria-label="缩小模型"
        title="缩小模型"
        :disabled="!available"
        @click="zoom(-1)"
        ><Minus :size="17" aria-hidden="true"
      /></Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label="放大模型"
        title="放大模型"
        :disabled="!available"
        @click="zoom(1)"
        ><Plus :size="17" aria-hidden="true"
      /></Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label="复位视角"
        title="复位视角"
        :disabled="!available"
        @click="setView('perspective')"
        ><RotateCcw :size="16" aria-hidden="true"
      /></Button>
    </div>
  </div>
</template>

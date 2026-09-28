<script setup lang="ts">
import { inject, ref } from 'vue'
import { ArrowLeft, Layers2, Minus, Plus, RotateCcw } from '@lucide/vue'
import { gestureKey } from '@/lib/gesture/bridge'
import { useProductStore } from '@/stores/product'
import GestureTargetButton from './GestureTargetButton.vue'

const bridge = inject(gestureKey)!
const store = useProductStore()
const group = ref('parts')
const groups = [
  { id: 'parts', label: '部件' },
  { id: 'finishes', label: '配色' },
  { id: 'tools', label: '视角与结构' },
]
function focus(id: string) {
  store.activePartId = id
  bridge.showPart()
}
function structure() {
  bridge.selected.value = false
  store.setStructure(!store.exploded)
}
</script>

<template>
  <section class="gesture-palette" aria-label="手势操作盘">
    <div class="gesture-palette-heading">
      <span
        >SELECT / {{ bridge.confirmation.value === 'dwell' ? '停留以确认' : '捏合后松开' }}</span
      >
      <GestureTargetButton
        id="observe"
        label="返回观察"
        compact
        @activate="bridge.mode.value = 'rotate'"
        ><ArrowLeft :size="13" />返回观察</GestureTargetButton
      >
    </div>
    <div class="gesture-palette-tabs" role="group" aria-label="操作盘分组">
      <GestureTargetButton
        v-for="item in groups"
        :id="`group:${item.id}`"
        :key="item.id"
        :label="item.label"
        :pressed="group === item.id"
        compact
        @activate="group = item.id"
      />
    </div>
    <div v-if="group === 'parts'" class="gesture-palette-grid">
      <GestureTargetButton
        v-for="part in store.product.hotspots"
        :id="`action:part:${part.id}`"
        :key="part.id"
        :label="part.name"
        @activate="focus(part.id)"
      />
    </div>
    <div v-else-if="group === 'finishes'" class="gesture-palette-grid">
      <GestureTargetButton
        v-for="finish in store.product.finishes"
        :id="`finish:${finish.id}`"
        :key="finish.id"
        :label="finish.name"
        :pressed="store.finishId === finish.id"
        @activate="store.finishId = finish.id"
      >
        <i class="finish-swatch" :style="{ backgroundColor: finish.swatch }"></i>{{ finish.name }}
      </GestureTargetButton>
    </div>
    <div v-else class="gesture-palette-grid gesture-palette-grid--tools">
      <GestureTargetButton id="zoom:in" label="放大" @activate="store.zoom(1)"
        ><Plus :size="17" />放大</GestureTargetButton
      >
      <GestureTargetButton id="zoom:out" label="缩小" @activate="store.zoom(-1)"
        ><Minus :size="17" />缩小</GestureTargetButton
      >
      <GestureTargetButton
        v-if="store.product.structure.length"
        id="structure"
        :label="store.exploded ? '合拢结构' : '展开结构'"
        @activate="structure"
        ><Layers2 :size="17" />{{ store.exploded ? '合拢' : '展开' }}</GestureTargetButton
      >
      <GestureTargetButton id="view:reset" label="复位视角" @activate="store.setView('perspective')"
        ><RotateCcw :size="17" />复位</GestureTargetButton
      >
    </div>
  </section>
</template>

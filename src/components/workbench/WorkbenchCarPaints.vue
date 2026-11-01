<script setup lang="ts">
import { computed } from 'vue'
import { Check } from '@lucide/vue'
import { useWorkbenchStore } from '@/stores/workbench'
import { carPaintChoice, carPaintChoices } from '@/lib/workbench/carPaintStudies'
const store = useWorkbenchStore()
const selected = computed(() => {
  const choice = carPaintChoice(store.finishId)
  if (choice) return choice
  return store.finishId === store.presentation?.finishes[0]?.id
    ? new URLSearchParams(location.search).get('carStudioPaint')
    : undefined
})
</script>

<template>
  <section v-if="store.carPaintAvailable" aria-label="汽车材质方案">
    <h3>车身材质</h3>
    <div class="wb-finishes">
      <button
        v-for="paint in carPaintChoices"
        :key="paint.id"
        type="button"
        :disabled="!store.available"
        :aria-pressed="selected === paint.id"
        @click="store.finish('@car-paint/' + paint.id)"
      >
        <span class="wb-swatch" :style="{ background: paint.color }"></span>{{ paint.name }}
        <Check v-if="selected === paint.id" :size="16" />
      </button>
    </div>
    <p class="wb-note">亮银为抛光装甲金属风格；各方案同时切换颜色与表面质感。</p>
  </section>
</template>

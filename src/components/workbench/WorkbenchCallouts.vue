<script setup lang="ts">
import { computed, nextTick, onMounted, onScopeDispose, ref, watch } from 'vue'
import { createCalloutOverlay } from '@/lib/workbench/calloutOverlay'
import type { Hotspot } from '@/lib/workbench/types'
import type { PlaceCallout } from '@/lib/workbench/calloutProjection'
import '@/assets/styles/workbench-callouts.css'

const props = defineProps<{
  parts: Hotspot[]
  selected: string | null
  details: boolean
  active: boolean
  background: string
}>()
const emit = defineEmits<{ focus: [id: string] }>()
const host = ref<HTMLElement>()
const colors = computed(() => {
  const rgb = [1, 3, 5].map((index) => parseInt(props.background.slice(index, index + 2), 16) / 255)
  const light = rgb[0]! * 0.2126 + rgb[1]! * 0.7152 + rgb[2]! * 0.0722 > 0.6
  return {
    '--wb-callout-background': props.background,
    '--wb-stage-ink': light ? '#31392f' : '#f0f4fa',
    '--wb-stage-muted': light ? '#626b5e' : '#abbacb',
  }
})
let overlay: ReturnType<typeof createCalloutOverlay> | undefined
const place: PlaceCallout = (...values) => overlay?.place(...values)
function commit() {
  overlay?.commit()
}
defineExpose({ place, commit })
onMounted(() => {
  if (host.value) {
    overlay = createCalloutOverlay(host.value, {
      selected: () => props.selected,
      details: () => props.details,
    })
    overlay.setActive(props.active)
  }
})
watch(
  () => props.parts,
  async () => {
    await nextTick()
    overlay?.refresh()
  },
)
watch(
  () => [props.selected, props.details],
  async () => {
    await nextTick()
    overlay?.contextChanged()
  },
)
watch(
  () => props.active,
  (active) => overlay?.setActive(active),
)
onScopeDispose(() => overlay?.dispose())
</script>

<template>
  <div
    ref="host"
    class="wb-hotspots wb-callouts"
    :style="colors"
    aria-label="商品热点"
    data-expanded="false"
  >
    <svg class="wb-callout-lines" width="100%" height="100%" aria-hidden="true">
      <g v-for="part in parts" :key="part.id" :class="{ 'is-selected': selected === part.id }">
        <path :data-part="part.id" pathLength="1" />
        <circle :data-part="part.id" r="2.25" />
      </g>
    </svg>
    <button
      v-for="part in parts"
      :key="part.id"
      type="button"
      class="wb-hotspot"
      :data-part="part.id"
      data-layout-visible="false"
      aria-hidden="true"
      tabindex="-1"
      :aria-pressed="selected === part.id"
      @click="emit('focus', part.id)"
    >
      {{ part.name }}
    </button>
  </div>
</template>

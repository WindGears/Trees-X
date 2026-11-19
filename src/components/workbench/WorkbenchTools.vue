<script setup lang="ts">
import { computed, nextTick, onMounted, onScopeDispose, ref, watch } from 'vue'
import { gsap } from 'gsap'
import { Palette, ScanSearch, Layers2, Route, RotateCcw, Minus, Plus } from '@lucide/vue'
import { useWorkbenchStore } from '@/stores/workbench'
import type { Panel } from '@/lib/workbench/types'
import { reducedInterfaceMotion } from '@/lib/workbench/interfaceMotion'
const store = useWorkbenchStore()
const props = defineProps<{ floating?: boolean; exhibition?: boolean }>()
const navigation = ref<HTMLElement>()
const indicator = ref<HTMLElement>()
let animation: gsap.core.Tween | undefined
function updateIndicator() {
  const active = navigation.value?.querySelector<HTMLElement>('[aria-pressed="true"]')
  if (!indicator.value) return
  animation?.kill()
  animation = gsap.to(indicator.value, {
    ...(active ? { x: active.offsetLeft, scaleX: active.offsetWidth / 100 } : {}),
    opacity: active ? 1 : 0,
    duration: reducedInterfaceMotion() ? 0 : 0.22,
    ease: 'power3.out',
  })
}
watch(
  () => [store.panel, store.presentation],
  () => void nextTick(updateIndicator),
)
onMounted(() => {
  updateIndicator()
  window.addEventListener('resize', updateIndicator)
})
onScopeDispose(() => {
  animation?.kill()
  window.removeEventListener('resize', updateIndicator)
})
const emit = defineEmits<{ panel: [value: Panel] }>()
const tools = computed(() => {
  const presentation = store.presentation
  const pending = props.exhibition && !presentation
  const choices = [
    { id: 'appearance', label: '外观', icon: Palette, show: presentation?.finishes.length },
    {
      id: 'details',
      label: props.exhibition ? '部件' : '细节',
      icon: ScanSearch,
      show: presentation?.hotspots.length,
    },
    {
      id: 'actions',
      label: '结构与动作',
      icon: Layers2,
      show: presentation?.structure || presentation?.actions.length,
    },
    { id: 'guide', label: '导览', icon: Route, show: presentation?.guide.length },
  ] as const
  return choices.filter((tool) => pending || tool.show)
})
</script>
<template>
  <div class="wb-tools">
    <div class="wb-camera-tools" aria-label="观察工具">
      <label
        ><span class="sr-only">观察视角</span
        ><select
          aria-label="观察视角"
          :value="store.presentation ? store.viewId : ''"
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
    <nav ref="navigation" class="wb-feature-tools" aria-label="探索商品">
      <span
        v-if="props.floating"
        ref="indicator"
        class="wb-tool-indicator"
        aria-hidden="true"
      ></span>
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

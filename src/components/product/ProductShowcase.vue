<script setup lang="ts">
import { defineAsyncComponent, onScopeDispose, provide, ref, watch } from 'vue'
import { createGestureBridge, gestureKey } from '@/lib/gesture/bridge'
import { useProductStore } from '@/stores/product'
import StudioIntro from './StudioIntro.vue'
import StudioControls from './StudioControls.vue'
import ProductCollection from './ProductCollection.vue'
import ExperienceDock from './ExperienceDock.vue'
import { useProductNavigation } from '@/composables/useProductNavigation'

const ProductViewer = defineAsyncComponent(() => import('@/components/three/ProductViewer.vue'))
const TypewriterStudy = defineAsyncComponent(
  () => import('@/components/typewriter/TypewriterStudy.vue'),
)
const ReventonExperience = defineAsyncComponent(
  () => import('@/components/reventon/ReventonExperience.vue'),
)
const store = useProductStore()
const bridge = createGestureBridge()
const available = ref(false)
useProductNavigation()
watch(
  () => store.product.id,
  () => {
    bridge.takeMouse()
    bridge.filmPhase.value = 'idle'
    bridge.filmLighting.sweep = 0
    bridge.selected.value = false
  },
  { flush: 'sync' },
)
watch(
  () => store.catalogOpen,
  (open) => {
    if (open) bridge.takeMouse()
  },
  { flush: 'sync' },
)

bridge.focus = () => {
  store.guideStep = null
  if (store.panel !== 'console') store.panel = 'details'
  store.focusPart()
}
bridge.leaveFocus = () => store.returnToOverview()
watch(
  () => store.manualRequest,
  () => bridge.takeMouse(),
  { flush: 'sync' },
)
provide(gestureKey, bridge)
onScopeDispose(() => bridge.disposeVisual())
</script>

<template>
  <section
    id="showcase"
    class="product-studio"
    :data-stage="store.stage.kind"
    :data-film="bridge.filmPhase.value"
    :data-film-playing="bridge.filmPlaying.value"
    :class="{ 'has-panel': store.panel }"
    :style="{ '--stage-accent': store.stage.accent }"
    aria-labelledby="showcase-heading"
  >
    <TypewriterStudy v-if="store.product.experience === 'study'" :active="!store.catalogOpen" />
    <ReventonExperience
      v-else-if="store.product.experience === 'reventon'"
      :active="!store.catalogOpen"
    />
    <template v-else>
      <div class="studio-stage">
        <ProductViewer @availability-change="available = $event" />
        <StudioIntro />
        <ExperienceDock :available="available" />
      </div>
      <StudioControls :available="available" />
    </template>
    <ProductCollection />
  </section>
</template>

<script setup lang="ts">
import { useProductStore } from '@/stores/product'
import { computed } from 'vue'
import { Vector3 } from 'three'
const props = defineProps<{ floorY: number }>()
const shadowPosition = computed(() => new Vector3(0, props.floorY - 0.025, 0))
const podiumPosition = computed(() => new Vector3(0, props.floorY - 0.09, 0))
const store = useProductStore()
</script>
<template>
  <TresMesh :position="shadowPosition" :rotation="[-Math.PI / 2, 0, 0]" receive-shadow>
    <TresPlaneGeometry :args="[30, 30]" />
    <TresShadowMaterial :opacity="0.32" :depth-write="false" />
  </TresMesh>
  <TresMesh v-if="store.stage.kind === 'play'" :position="podiumPosition" receive-shadow>
    <TresCylinderGeometry :args="[1.85, 1.85, 0.14, 96]" />
    <TresMeshStandardMaterial color="#24201e" :metalness="0.28" :roughness="0.7" />
  </TresMesh>
</template>

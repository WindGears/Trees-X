<script setup lang="ts">
import { shallowRef, watch } from 'vue'
import { Vector3 } from 'three'
import type { StageConfig } from '@/lib/workbench/types'
const props = defineProps<{ stage: StageConfig; studio: boolean }>()
const keyPosition = shallowRef(new Vector3()),
  rimPosition = shallowRef(new Vector3()),
  groundPosition = shallowRef(new Vector3())
watch(
  () => props.stage,
  (value) => {
    keyPosition.value = new Vector3().fromArray(value.key.position)
    rimPosition.value = new Vector3().fromArray(value.rim.position)
    groundPosition.value = new Vector3(0, value.groundY, 0)
  },
  { immediate: true },
)
</script>

<template>
  <TresGroup name="workbench-lighting">
    <TresAmbientLight :intensity="stage.ambient" />
    <TresDirectionalLight
      :position="keyPosition"
      :intensity="stage.key.intensity"
      :color="stage.key.color"
      :cast-shadow="!studio"
      v-bind="{
        'shadow-mapSize-width': 2048,
        'shadow-mapSize-height': 2048,
        'shadow-normalBias': 0.005,
        'shadow-bias': -0.00008,
        'shadow-radius': 3,
      }"
    />
    <TresDirectionalLight
      :position="rimPosition"
      :intensity="stage.rim.intensity"
      :color="stage.rim.color"
    />
    <TresMesh
      v-if="!studio"
      :rotation="[-Math.PI / 2, 0, 0]"
      :position="groundPosition"
      receive-shadow
    >
      <TresPlaneGeometry :args="[200, 200]" />
      <TresMeshStandardMaterial
        :color="stage.ground"
        :roughness="1"
        :metalness="0"
        :env-map-intensity="0.1"
      />
    </TresMesh>
  </TresGroup>
</template>

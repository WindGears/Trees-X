<script setup lang="ts">
import { onScopeDispose, watch } from 'vue'
import { useTresContext } from '@tresjs/core'
import type { StageConfig } from '@/lib/workbench/types'
import { createWorkbenchLighting } from '@/lib/workbench/workbenchLighting'
import { afterPreparation } from '@/lib/workbench/rendering/preparationLease'
const props = defineProps<{ stage: StageConfig; studio: boolean }>()
const renderer = useTresContext().renderer.instance
const lighting = createWorkbenchLighting(props.stage, props.studio)
watch(
  () => [props.stage, props.studio] as const,
  ([stage, studio]) => lighting.update(stage, studio),
)
onScopeDispose(() => {
  // Detach before Tres's recursive scene cleanup; the existing lease owns the wait.
  lighting.root.removeFromParent()
  afterPreparation(renderer, lighting.dispose)
})
</script>

<template>
  <primitive :object="lighting.root" :dispose="null" />
</template>

<script setup lang="ts">
import { useWorkbenchScene, type WorkbenchSceneProps } from '@/composables/useWorkbenchScene'
import type { RefinementStatus } from '@/lib/workbench/rendering/refinementTypes'
import type { CameraSnapshot } from '@/lib/workbench/cameraCapture'
import WorkbenchLighting from './WorkbenchLighting.vue'
const props = defineProps<WorkbenchSceneProps>()
const emit = defineEmits<{
  restore: [snapshot?: CameraSnapshot]
  refinement: [status: RefinementStatus]
}>()
const runtime = useWorkbenchScene(
  props,
  (snapshot) => emit('restore', snapshot),
  (status) => emit('refinement', status),
)
const { studio, stage } = runtime
defineExpose({
  hybrid: runtime.hybrid,
  refine: runtime.refine,
  realtime: runtime.realtime,
  retry: runtime.retry,
  checkpoint: runtime.checkpoint,
})
</script>
<template>
  <WorkbenchLighting :stage="stage" :studio="studio" />
</template>

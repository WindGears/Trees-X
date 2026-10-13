<script setup lang="ts">
import { useWorkbenchScene, type WorkbenchSceneProps } from '@/composables/useWorkbenchScene'
import type { RefinementStatus } from '@/lib/workbench/rendering/refinementTypes'
import type { RealtimeStatus } from '@/lib/workbench/rendering/realtime/types'
import type { CameraSnapshot } from '@/lib/workbench/cameraCapture'
import WorkbenchLighting from './WorkbenchLighting.vue'
const props = defineProps<WorkbenchSceneProps>()
const emit = defineEmits<{
  restore: [snapshot?: CameraSnapshot]
  refinement: [status: RefinementStatus]
  lighting: [status: RealtimeStatus]
}>()
const runtime = useWorkbenchScene(
  props,
  (snapshot) => emit('restore', snapshot),
  (status) => emit('refinement', status),
  (status) => emit('lighting', status),
)
const { studio, stage } = runtime
defineExpose({
  hybrid: runtime.hybrid,
  realLighting: runtime.realLighting,
  refine: runtime.refine,
  realtime: runtime.realtime,
  retry: runtime.retry,
  checkpoint: runtime.checkpoint,
})
</script>
<template>
  <WorkbenchLighting :stage="stage" :studio="studio" />
</template>

<script setup lang="ts">
import { onScopeDispose, watch } from 'vue'
import { useLoop, useTres, useTresContext } from '@tresjs/core'
import { ACESFilmicToneMapping, NoToneMapping } from 'three'

const props = defineProps<{ active: boolean; cinematic: boolean }>()
const { renderer, invalidate } = useTres()
const { start, stop, isActive, onBeforeRender } = useLoop()
const context = useTresContext()
let initialized = false

// Keep Tres in on-demand mode. In 5.8.3 a manual -> always transition leaves
// its frame budget at zero; invalidate() cannot prime it in always mode.
onBeforeRender(() => {
  if (props.active && props.cinematic) invalidate()
})
function synchronize() {
  // Tres' toneMapping watcher ignores NoToneMapping (0).
  renderer.toneMapping = props.cinematic ? NoToneMapping : ACESFilmicToneMapping
  if (!initialized) return
  if (props.active) {
    invalidate()
    if (!isActive.value) start()
  } else if (isActive.value) stop()
}
const ready = context.renderer.onReady(() => {
  initialized = true
  synchronize()
})
watch(() => [props.active, props.cinematic], synchronize, { immediate: true, flush: 'post' })
onScopeDispose(stop)
onScopeDispose(ready.off)
</script>

<template><TresGroup name="render-driver" /></template>

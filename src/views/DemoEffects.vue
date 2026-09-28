<script setup lang="ts">
import { EffectComposerPmndrs, BloomPmndrs, VignettePmndrs } from '@tresjs/post-processing'

defineProps<{
  enhanced: boolean
}>()
</script>

<template>
  <EffectComposerPmndrs>
    <BloomPmndrs :intensity="enhanced ? 0.5 : 0.3" :luminance-threshold="0.9" />
    <VignettePmndrs :darkness="0.5" />
  </EffectComposerPmndrs>
</template>

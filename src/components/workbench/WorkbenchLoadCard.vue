<script setup lang="ts">
import UiLoadingTrack from '@/components/ui/UiLoadingTrack.vue'

defineProps<{
  title: string
  message: string
  slug?: string
  cover?: string
  description?: string
  poster?: boolean
  failed?: boolean
}>()
</script>

<template>
  <div class="wb-stage-status" :class="{ 'wb-stage-status--poster': poster }" :data-exhibit="slug">
    <img
      v-if="poster && cover"
      :key="cover"
      :src="cover"
      class="wb-transition-cover"
      alt=""
      fetchpriority="high"
      decoding="async"
    />
    <div class="wb-stage-status-copy">
      <h2>{{ title }}</h2>
      <p :role="failed ? 'alert' : 'status'">{{ message }}</p>
      <UiLoadingTrack v-if="!failed" />
      <p v-if="failed && description">{{ description }}</p>
      <slot v-if="failed" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onScopeDispose, ref } from 'vue'

const visible = ref(!document.hidden)
function syncVisibility() {
  visible.value = !document.hidden
}
onMounted(() => {
  document.addEventListener('visibilitychange', syncVisibility)
  syncVisibility()
})
onScopeDispose(() => document.removeEventListener('visibilitychange', syncVisibility))
</script>

<template>
  <span class="ui-loading-track" :class="{ 'is-paused': !visible }" aria-hidden="true">
    <span />
  </span>
</template>

<style scoped>
.ui-loading-track {
  display: block;
  inline-size: min(100%, 176px);
  block-size: 2px;
  overflow: hidden;
  border-radius: 2px;
  background: color-mix(in srgb, currentColor 19%, transparent);
}
.ui-loading-track > span {
  display: block;
  inline-size: 38%;
  block-size: 100%;
  border-radius: inherit;
  background: var(--ui-loading-ink, currentColor);
  animation: ui-loading-sweep 1.35s linear infinite;
}
.ui-loading-track.is-paused > span {
  animation-play-state: paused;
}
@keyframes ui-loading-sweep {
  from {
    transform: translateX(-100%);
  }
  to {
    transform: translateX(280%);
  }
}
@media (prefers-reduced-motion: reduce) {
  .ui-loading-track > span {
    animation: none;
  }
}
</style>

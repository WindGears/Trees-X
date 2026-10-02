<script setup lang="ts">
import { defineAsyncComponent, onScopeDispose, ref } from 'vue'
const legacyProducts = new Set([
  'gamepad',
  'gaming-console',
  'oak-side-table',
  'potted-plant',
  'home-furniture-set',
  'toy-racer',
])
function isLegacy() {
  const query = new URL(location.href).searchParams
  return query.get('legacy') === '1' || legacyProducts.has(query.get('product') ?? '')
}
const legacy = ref(isLegacy())
const LegacyExperience = defineAsyncComponent(() => import('@/components/LegacyExperience.vue'))
const WorkbenchRoot = defineAsyncComponent(() => import('@/components/workbench/WorkbenchRoot.vue'))
const read = () => {
  legacy.value = isLegacy()
}
window.addEventListener('popstate', read)
onScopeDispose(() => window.removeEventListener('popstate', read))
</script>

<template>
  <LegacyExperience v-if="legacy" />
  <WorkbenchRoot v-else />
</template>

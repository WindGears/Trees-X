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
const officialExhibits = new Set(['typewriter-study', 'piano-cfx', 'reventon'])
function isLegacy() {
  const query = new URL(location.href).searchParams
  return query.get('legacy') === '1' || legacyProducts.has(query.get('product') ?? '')
}
function isExhibition() {
  const url = new URL(location.href)
  if (url.pathname !== '/' || isLegacy()) return false
  return (
    !url.searchParams.size ||
    url.searchParams.get('renderPipeline') === 'showcase' ||
    (url.searchParams.size === 1 && officialExhibits.has(url.searchParams.get('product') ?? ''))
  )
}
const legacy = ref(isLegacy())
const admin = ref(location.pathname === '/admin' || location.pathname.startsWith('/admin/'))
const exhibition = ref(isExhibition())
const AdminRoot = defineAsyncComponent(() => import('@/components/admin/AdminRoot.vue'))
const LegacyExperience = defineAsyncComponent(() => import('@/components/LegacyExperience.vue'))
const WorkbenchRoot = defineAsyncComponent(() => import('@/components/workbench/WorkbenchRoot.vue'))
const ExhibitionRoot = defineAsyncComponent(
  () => import('@/components/workbench/ExhibitionRoot.vue'),
)
const read = () => {
  legacy.value = isLegacy()
  admin.value = location.pathname === '/admin' || location.pathname.startsWith('/admin/')
  exhibition.value = isExhibition()
}
window.addEventListener('popstate', read)
onScopeDispose(() => window.removeEventListener('popstate', read))
</script>

<template>
  <AdminRoot v-if="admin" />
  <LegacyExperience v-else-if="legacy" />
  <ExhibitionRoot v-else-if="exhibition" />
  <WorkbenchRoot v-else />
</template>

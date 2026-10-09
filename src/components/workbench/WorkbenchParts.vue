<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useWorkbenchStore } from '@/stores/workbench'
const store = useWorkbenchStore()
const query = ref(''),
  group = ref(''),
  all = ref(false),
  limit = ref(40)
const parts = computed(() => store.presentation?.hotspots ?? [])
const groups = computed(() => [...new Set(parts.value.flatMap((p) => (p.group ? [p.group] : [])))])
const filtered = computed(() => {
  const term = query.value.trim().toLocaleLowerCase()
  return parts.value.filter(
    (p) =>
      (!group.value || p.group === group.value) &&
      (!term ||
        (/^[a-z]$/.test(term)
          ? p.name
              .toLocaleLowerCase()
              .split(/[\s·]+/)
              .at(-1) === term
          : p.name.toLocaleLowerCase().includes(term) ||
            p.id.toLocaleLowerCase().includes(term))) &&
      (all.value || group.value || term || p.marker !== false),
  )
})
watch(
  () => store.slug,
  () => {
    query.value = ''
    group.value = ''
    all.value = false
    limit.value = 40
  },
)
watch([query, group, all], () => {
  limit.value = 40
})
</script>
<template>
  <h3>选择值得靠近的地方</h3>
  <p>点击模型部件，或搜索并选择。聚焦会跟随部件当前的位置。</p>
  <div v-if="store.hotspot" class="wb-part-copy" role="status">
    <h3>{{ store.hotspot.name }}</h3>
    <p>{{ store.hotspot.description }}</p>
    <button type="button" :disabled="!store.available" @click="store.overview()">返回全景</button>
  </div>
  <div v-if="parts.length > 12" class="wb-parts-filter">
    <label for="wb-parts-query">查找部件</label>
    <input id="wb-parts-query" v-model="query" type="search" placeholder="名称、按键或编号" />
    <label for="wb-parts-group">部件组</label>
    <select id="wb-parts-group" v-model="group">
      <option value="">全部部件组</option>
      <option v-for="name in groups" :key="name" :value="name">{{ name }}</option>
    </select>
    <button type="button" :aria-pressed="all" @click="all = !all">
      {{ all ? '只看重点部件' : `查看全部 ${parts.length} 个部件` }}
    </button>
  </div>
  <p v-if="!filtered.length" role="status">没有找到对应部件，请换个名称或部件组。</p>
  <div class="wb-part-list">
    <button
      v-for="part in filtered.slice(0, limit)"
      :key="part.id"
      type="button"
      :disabled="!store.available"
      :aria-pressed="store.selectedPart === part.id"
      @click="store.focus(part.id)"
    >
      {{ part.name }}
    </button>
  </div>
  <button v-if="filtered.length > limit" type="button" @click="limit += 40">
    显示更多部件（{{ limit }} / {{ filtered.length }}）
  </button>
  <button
    v-if="!store.hotspot"
    type="button"
    :disabled="!store.available"
    @click="store.overview()"
  >
    返回全景
  </button>
</template>

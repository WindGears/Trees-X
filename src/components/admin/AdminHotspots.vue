<script setup lang="ts">
import { useProductDraft } from '@/lib/admin/productDraft'
import { copy, nextId, moveItem, removalReasons } from '@/lib/admin/editor'
import AdminField from './AdminField.vue'
import AdminVector from './AdminVector.vue'
import AdminRowTools from './AdminRowTools.vue'
const { presentation: p } = useProductDraft()
function add(index?: number) {
  const base =
    index === undefined
      ? { node: '', name: '', description: '', cameraOffset: [0, 1, 3] as [number, number, number] }
      : copy(p.value.hotspots[index]!)
  p.value.hotspots.push({ ...base, id: nextId(p.value.hotspots, 'part') })
}
function remove(index: number) {
  if (!removalReasons(p.value, 'hotspots', p.value.hotspots[index]!.id).length)
    p.value.hotspots.splice(index, 1)
}
</script>
<template>
  <section aria-label="部件热点">
    <header class="ad-section-title">
      <div>
        <h2>部件热点</h2>
        <p class="ad-muted">名称与说明供访客阅读；绑定节点需在模型预览中检查。</p>
      </div>
      <button type="button" @click="add()">新增部件</button>
    </header>
    <p v-if="!p.hotspots.length" class="ad-empty">还没有部件。新增后填写说明与实际模型节点。</p>
    <article v-for="(part, index) in p.hotspots" :key="part.id" class="ad-entry">
      <h3>
        {{ part.name || '未命名部件' }} <small>{{ part.id }}</small>
      </h3>
      <div class="ad-fields">
        <AdminField
          v-model="part.name"
          label="部件名称"
          :path="`hotspots.${part.id}.name`"
        /><AdminField
          v-model="part.node"
          label="绑定节点"
          :path="`hotspots.${part.id}.node`"
          help="区分大小写，需与模型节点名完全一致。本轮不提供节点拾取。"
        /><AdminField
          v-model="part.description"
          label="部件说明"
          :path="`hotspots.${part.id}.description`"
          multiline
          class="ad-wide"
        />
      </div>
      <details class="ad-coordinates">
        <summary>聚焦与锚点坐标</summary>
        <AdminVector
          :value="part.cameraOffset"
          label="聚焦偏移"
          :path="`hotspots.${part.id}.cameraOffset`"
          section="hotspots"
        />
        <label class="ad-checkbox"
          ><input
            type="checkbox"
            :checked="Boolean(part.anchor)"
            @change="part.anchor = part.anchor ? undefined : [0, 0, 0]"
          />使用节点局部锚点</label
        >
        <AdminVector
          v-if="part.anchor"
          :value="part.anchor"
          label="局部锚点"
          :path="`hotspots.${part.id}.anchor`"
          section="hotspots"
        />
      </details>
      <AdminRowTools
        :index="index"
        :count="p.hotspots.length"
        :name="part.name || part.id"
        :reasons="removalReasons(p, 'hotspots', part.id)"
        @move="moveItem(p.hotspots, index, $event)"
        @copy="add(index)"
        @remove="remove(index)"
      />
    </article>
  </section>
</template>

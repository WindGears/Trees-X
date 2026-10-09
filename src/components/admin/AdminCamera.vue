<script setup lang="ts">
import { useProductDraft } from '@/lib/admin/productDraft'
import { copy, nextId, moveItem, removalReasons } from '@/lib/admin/editor'
import AdminField from './AdminField.vue'
import AdminNumber from './AdminNumber.vue'
import AdminVector from './AdminVector.vue'
import AdminRowTools from './AdminRowTools.vue'
const emit = defineEmits<{ capture: [target: string] }>()
const { presentation: p } = useProductDraft()
function add(index?: number) {
  const base =
    index === undefined
      ? { label: '', position: copy(p.value.camera.position), target: copy(p.value.camera.target) }
      : copy(p.value.views[index]!)
  p.value.views.push({ ...base, id: nextId(p.value.views, 'view') })
}
function remove(index: number) {
  if (!removalReasons(p.value, 'views', p.value.views[index]!.id).length)
    p.value.views.splice(index, 1)
}
</script>
<template>
  <section aria-label="镜头配置">
    <h2>默认取景与缩放</h2>
    <p class="ad-muted">进入预览调整镜头后，可将实际取景写回表单。不会自动保存。</p>
    <button type="button" @click="emit('capture', 'default')">为默认取景采集镜头</button>
    <div class="ad-fields ad-spaced">
      <AdminNumber
        v-model="p.camera.minDistance"
        label="最近距离"
        path="camera.minDistance"
        section="camera"
        :min="0"
      /><AdminNumber
        v-model="p.camera.maxDistance"
        label="最远距离"
        path="camera.maxDistance"
        section="camera"
        :min="0"
      />
    </div>
    <details class="ad-coordinates">
      <summary>默认取景坐标</summary>
      <AdminVector
        :value="p.camera.position"
        label="默认相机位置"
        path="camera.position"
        section="camera"
      /><AdminVector
        :value="p.camera.target"
        label="默认观察目标"
        path="camera.target"
        section="camera"
      />
    </details>
    <header class="ad-section-title ad-spaced">
      <h2>预设视角</h2>
      <button type="button" @click="add()">新增视角</button>
    </header>
    <article v-for="(view, index) in p.views" :key="view.id" class="ad-entry">
      <h3>
        {{ view.label || '未命名视角' }}
        <small>{{ view.id === 'perspective' ? '必需全景 · ' : '' }}{{ view.id }}</small>
      </h3>
      <AdminField v-model="view.label" label="视角名称" :path="`views.${view.id}.label`" />
      <button type="button" class="ad-spaced" @click="emit('capture', 'view:' + view.id)">
        为此视角采集镜头
      </button>
      <details class="ad-coordinates">
        <summary>视角坐标</summary>
        <AdminVector
          :value="view.position"
          label="视角位置"
          :path="`views.${view.id}.position`"
          section="camera"
        /><AdminVector
          :value="view.target"
          label="视角观察目标"
          :path="`views.${view.id}.target`"
          section="camera"
        />
      </details>
      <AdminRowTools
        :index="index"
        :count="p.views.length"
        :name="view.label || view.id"
        :reasons="removalReasons(p, 'views', view.id)"
        @move="moveItem(p.views, index, $event)"
        @copy="add(index)"
        @remove="remove(index)"
      />
    </article>
  </section>
</template>

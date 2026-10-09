<script setup lang="ts">
import { useProductDraft } from '@/lib/admin/productDraft'
import { copy, nextId, moveItem, removalReasons } from '@/lib/admin/editor'
import AdminField from './AdminField.vue'
import AdminRowTools from './AdminRowTools.vue'
const { presentation: p } = useProductDraft()
function add(index?: number) {
  const base =
    index === undefined
      ? { name: '', color: p.value.finishes[0]!.color }
      : copy(p.value.finishes[index]!)
  p.value.finishes.push({ ...base, id: nextId(p.value.finishes, 'finish') })
}
</script>
<template>
  <section aria-label="外观配置">
    <header class="ad-section-title">
      <div>
        <h2>外观方案</h2>
        <p class="ad-muted">第一项是默认外观。调整顺序会改变商品初始配色。</p>
      </div>
      <button type="button" @click="add()">新增外观</button>
    </header>
    <article v-for="(finish, index) in p.finishes" :key="finish.id" class="ad-entry">
      <h3>
        {{ finish.name || '未命名外观' }}
        <small>{{ index === 0 ? '默认外观 · ' : '' }}{{ finish.id }}</small>
      </h3>
      <div class="ad-fields">
        <AdminField v-model="finish.name" label="外观名称" :path="`finishes.${finish.id}.name`" />
        <div class="ad-color-field">
          <label :for="'color-' + finish.id"
            >选择颜色<input
              :id="'color-' + finish.id"
              type="color"
              :value="/^#[0-9a-fA-F]{6}$/.test(finish.color) ? finish.color : '#000000'"
              @input="finish.color = ($event.target as HTMLInputElement).value" /></label
          ><AdminField
            v-model="finish.color"
            label="十六进制颜色"
            :path="`finishes.${finish.id}.color`"
            :maxlength="7"
          />
        </div>
      </div>
      <AdminRowTools
        :index="index"
        :count="p.finishes.length"
        :name="finish.name || finish.id"
        :reasons="removalReasons(p, 'finishes', finish.id)"
        @move="moveItem(p.finishes, index, $event)"
        @copy="add(index)"
        @remove="p.finishes.length > 1 && p.finishes.splice(index, 1)"
      />
    </article>
  </section>
</template>

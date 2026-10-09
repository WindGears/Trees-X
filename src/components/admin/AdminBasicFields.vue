<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useProductDraft } from '@/lib/admin/productDraft'
import type { Category } from '@/lib/admin/api'
import { localPath } from '@/lib/workbench/validation'
import AdminField from './AdminField.vue'
import AdminNumber from './AdminNumber.vue'
defineProps<{ categories: Category[]; creating: boolean }>()
const { item } = useProductDraft()
const failed = ref(false),
  cover = computed(() => {
    try {
      return item.value.cover?.trim() ? localPath(item.value.cover.trim()) : ''
    } catch {
      return ''
    }
  })
watch(cover, () => {
  failed.value = false
})
</script>
<template>
  <section aria-label="基本信息">
    <h2>基本信息</h2>
    <div class="ad-fields">
      <AdminField v-model="item.name" label="商品名称" path="info.name" :maxlength="120" />
      <AdminField
        v-model="item.slug"
        label="商品标识"
        path="info.slug"
        :readonly="!creating"
        :maxlength="80"
        help="小写字母、数字和连字符，创建后不可修改。"
      />
      <label
        >商品分类<select v-model="item.categoryId" aria-label="商品分类">
          <option v-for="category in categories" :key="category.id" :value="category.id">
            {{ category.name }}
          </option>
        </select></label
      >
      <AdminNumber
        v-model="item.sortOrder"
        label="目录排序"
        path="info.sortOrder"
        section="info"
        :min="0"
        :max="100000"
        :step="1"
        help="数字越小，排列越靠前。"
      />
      <label
        >资产状态<select v-model="item.displayStatus" aria-label="资产状态">
          <option value="prototype">流程样板</option>
          <option value="formal">正式展品</option></select
        ><small>表示模型完成度，与上下架分开。</small></label
      >
      <AdminField
        :model-value="item.cover ?? ''"
        label="封面路径"
        path="info.cover"
        :maxlength="512"
        help="留空可保存。使用同源路径，文件由开发者准备。"
        @update:model-value="item.cover = $event"
      />
      <AdminField
        v-model="item.description"
        label="商品介绍"
        path="info.description"
        multiline
        :maxlength="600"
        class="ad-wide"
      />
    </div>
    <figure v-if="cover" class="ad-cover-preview">
      <img v-if="!failed" :src="cover" alt="当前商品封面预览" @error="failed = true" />
      <figcaption>{{ failed ? '封面无法加载，请检查路径及本地文件。' : '当前封面' }}</figcaption>
    </figure>
    <p v-else class="ad-muted">尚未设置封面，可在准备好本地文件后补充。</p>
  </section>
</template>

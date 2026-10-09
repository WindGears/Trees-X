<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { adminApi, message, type Category } from '@/lib/admin/api'
const emit = defineEmits<{ dirty: [value: boolean] }>()
const categories = ref<Category[]>([]),
  selected = ref<number>(),
  busy = ref(false),
  error = ref(''),
  notice = ref('')
const form = reactive({ name: '', sortOrder: 0, revision: 0 })
const baseline = ref(JSON.stringify(form))
const dirty = computed(() => JSON.stringify(form) !== baseline.value)
watch(dirty, (value) => emit('dirty', value))
async function load() {
  busy.value = true
  error.value = ''
  try {
    categories.value = await adminApi.categories()
  } catch (e) {
    error.value = message(e)
  } finally {
    busy.value = false
  }
}
function choose(category?: Category, force = false) {
  if (!force && dirty.value && !window.confirm('尚有未保存的分类修改，继续将丢弃当前输入。')) return
  selected.value = category?.id
  Object.assign(form, {
    name: category?.name ?? '',
    sortOrder: category?.sortOrder ?? 0,
    revision: category?.revision ?? 0,
  })
  baseline.value = JSON.stringify(form)
  notice.value = ''
}
async function save() {
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    const saved = await adminApi.saveCategory(form, selected.value)
    choose(saved, true)
    await load()
    notice.value = '分类已保存。关联商品的分类名称已同步。'
  } catch (e) {
    error.value = message(e)
  } finally {
    busy.value = false
  }
}
async function remove(category: Category) {
  if (!window.confirm(`删除分类“${category.name}”？`)) return
  busy.value = true
  error.value = ''
  try {
    await adminApi.deleteCategory(category)
    if (selected.value === category.id) choose(undefined, true)
    await load()
    notice.value = '分类已删除。'
  } catch (e) {
    error.value = message(e)
  } finally {
    busy.value = false
  }
}
onMounted(() => void load())
</script>
<template>
  <section class="ad-content">
    <header class="ad-title">
      <div>
        <h1>商品分类</h1>
        <p>分类服务访客筛选。仍被商品使用的分类不能删除。</p>
      </div>
    </header>
    <div class="ad-category-layout">
      <div>
        <p v-if="busy" role="status">正在处理分类…</p>
        <div class="ad-table-wrap">
          <table class="ad-table">
            <caption class="sr-only">
              分类与使用数量
            </caption>
            <thead>
              <tr>
                <th scope="col">名称</th>
                <th scope="col">商品数</th>
                <th scope="col">排序</th>
                <th scope="col">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="category in categories" :key="category.id">
                <td>{{ category.name }}</td>
                <td>{{ category.productCount }}</td>
                <td>{{ category.sortOrder }}</td>
                <td class="ad-row-actions">
                  <button type="button" :disabled="busy" @click="choose(category)">
                    编辑<span class="sr-only">{{ category.name }}</span></button
                  ><button
                    type="button"
                    :disabled="busy || category.productCount > 0"
                    @click="remove(category)"
                  >
                    删除<span class="sr-only">{{ category.name }}</span>
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <form class="ad-category-form" @submit.prevent="save">
        <h2>{{ selected ? '编辑分类' : '新建分类' }}</h2>
        <label>分类名称<input v-model="form.name" required maxlength="40" /></label>
        <label
          >排序<input v-model.number="form.sortOrder" type="number" min="0" max="100000" required
        /></label>
        <p class="ad-muted">数字越小，排列越靠前。</p>
        <p v-if="error" role="alert" class="ad-error">
          {{ error }} <button type="button" @click="load">重新读取列表</button>
        </p>
        <p v-if="notice" role="status">{{ notice }}</p>
        <div class="ad-actions">
          <button type="submit" class="ad-primary" :disabled="busy">保存分类</button
          ><button v-if="selected" type="button" :disabled="busy" @click="choose()">
            新建其他分类
          </button>
        </div>
      </form>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { adminApi, message, type AdminDetail, type AdminItem, type Category } from '@/lib/admin/api'
import AdminProductEditor from './AdminProductEditor.vue'
const emit = defineEmits<{ dirty: [value: boolean] }>()
const products = ref<AdminItem[]>([]),
  categories = ref<Category[]>([]),
  selected = ref<AdminDetail | null>(null)
const query = ref(''),
  error = ref(''),
  loading = ref(false),
  editing = ref(false),
  creating = ref(false)
const choosingTemplate = ref(false),
  templateSlug = ref('')
const filtered = computed(() =>
  products.value.filter((p) => p.name.includes(query.value) || p.slug.includes(query.value)),
)
async function load() {
  loading.value = true
  error.value = ''
  try {
    ;[products.value, categories.value] = await Promise.all([
      adminApi.products(),
      adminApi.categories(),
    ])
  } catch (e) {
    error.value = message(e)
  } finally {
    loading.value = false
  }
}
async function edit(slug: string) {
  loading.value = true
  error.value = ''
  try {
    selected.value = await adminApi.detail(slug)
    creating.value = false
    editing.value = true
  } catch (e) {
    error.value = message(e)
  } finally {
    loading.value = false
  }
}
async function create() {
  if (!products.value.length) {
    error.value = '需要一个可用展示配置作为起点，请先准备规范配置。'
    return
  }
  loading.value = true
  try {
    selected.value = await adminApi.detail(templateSlug.value)
    creating.value = true
    editing.value = true
    choosingTemplate.value = false
  } catch (e) {
    error.value = message(e)
  } finally {
    loading.value = false
  }
}
function beginCreate() {
  templateSlug.value = products.value[0]?.slug ?? ''
  choosingTemplate.value = true
}
function close() {
  editing.value = false
  emit('dirty', false)
  void load()
}
onMounted(() => void load())
</script>
<template>
  <section class="ad-content">
    <AdminProductEditor
      v-if="editing && selected"
      :detail="selected"
      :categories="categories"
      :create="creating"
      @close="close"
      @dirty="emit('dirty', $event)"
    />
    <template v-else>
      <header class="ad-title">
        <div>
          <h1>商品与展示配置</h1>
          <p>先检查预览，再让商品出现在访客目录。</p>
        </div>
        <button
          type="button"
          class="ad-primary"
          :disabled="loading || !categories.length"
          @click="beginCreate"
        >
          新建商品
        </button>
      </header>
      <form v-if="choosingTemplate" class="ad-template-picker" @submit.prevent="create">
        <label
          >配置起点<select v-model="templateSlug" :disabled="loading" aria-label="配置起点">
            <option v-for="product in products" :key="product.slug" :value="product.slug">
              {{ product.name }} · {{ product.slug }}
            </option>
          </select></label
        >
        <p class="ad-muted">
          复制所选商品的展示配置与素材引用作为起点；新商品默认下架，创建前请检查内容。
        </p>
        <div class="ad-actions">
          <button type="submit" :disabled="loading || !templateSlug">使用此配置开始</button
          ><button type="button" :disabled="loading" @click="choosingTemplate = false">
            取消新建
          </button>
        </div>
      </form>
      <label class="ad-search"
        >查找商品<input v-model="query" placeholder="商品名称或标识" type="search"
      /></label>
      <p v-if="loading" role="status">正在读取商品…</p>
      <div v-else-if="error" class="ad-error" role="alert">
        {{ error }} <button type="button" @click="load">重新读取</button>
      </div>
      <p v-else-if="!filtered.length" class="ad-empty">
        没有匹配的商品。清除搜索或新建商品，完成配置后即可上架。
      </p>
      <div v-else class="ad-table-wrap">
        <table class="ad-table">
          <caption class="sr-only">
            全部商品，包含下架内容
          </caption>
          <thead>
            <tr>
              <th scope="col">商品</th>
              <th scope="col">分类</th>
              <th scope="col">资产状态</th>
              <th scope="col">目录状态</th>
              <th scope="col">排序</th>
              <th scope="col">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in filtered" :key="item.slug">
              <td class="ad-product-cell">
                <img v-if="item.cover" :src="item.cover" alt="" />
                <div>
                  <strong>{{ item.name }}</strong
                  ><span>{{ item.slug }}</span>
                </div>
              </td>
              <td>{{ item.category }}</td>
              <td>{{ item.displayStatus === 'formal' ? '正式展品' : '流程样板' }}</td>
              <td>
                <span class="ad-state" :class="{ 'is-listed': item.listed }">{{
                  item.listed ? '已上架' : '已下架'
                }}</span>
              </td>
              <td>{{ item.sortOrder }}</td>
              <td>
                <button type="button" :aria-label="'编辑' + item.name" @click="edit(item.slug)">
                  编辑
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </section>
</template>

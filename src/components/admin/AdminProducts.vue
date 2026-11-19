<script setup lang="ts">
import { computed, onMounted, onScopeDispose, ref } from 'vue'
import { adminApi, message, type AdminDetail, type AdminItem, type Category } from '@/lib/admin/api'
import { createInterfaceMotion } from '@/lib/workbench/interfaceMotion'
import UiLoadingTrack from '@/components/ui/UiLoadingTrack.vue'
import AdminProductEditor from './AdminProductEditor.vue'
type DetailRequest = { slug: string; create: boolean }
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
const pending = ref<DetailRequest | null>(null),
  failed = ref<DetailRequest | null>(null)
const busy = computed(() => loading.value || Boolean(pending.value))
const status = computed(() => {
  if (loading.value) return '正在读取商品…'
  if (!pending.value) return ''
  return pending.value.create ? '正在读取配置起点…' : '正在打开商品配置…'
})
const filtered = computed(() =>
  products.value.filter((p) => p.name.includes(query.value) || p.slug.includes(query.value)),
)
async function load() {
  if (busy.value) return
  loading.value = true
  error.value = ''
  failed.value = null
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
async function openDetail(slug: string, create = false) {
  if (busy.value || !slug) return
  pending.value = { slug, create }
  error.value = ''
  failed.value = null
  try {
    selected.value = await adminApi.detail(slug)
    creating.value = create
    editing.value = true
    choosingTemplate.value = false
  } catch (e) {
    error.value = message(e)
    failed.value = { slug, create }
  } finally {
    pending.value = null
  }
}
function retry() {
  if (failed.value) void openDetail(failed.value.slug, failed.value.create)
  else void load()
}
function beginCreate() {
  if (!products.value.length) {
    error.value = '需要一个可用展示配置作为起点，请先准备规范配置。'
    return
  }
  templateSlug.value = products.value[0]?.slug ?? ''
  choosingTemplate.value = true
}
function close() {
  editing.value = false
  emit('dirty', false)
  void load()
}
onMounted(() => void load())
const motion = createInterfaceMotion('soft')
onScopeDispose(motion.dispose)
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
      <Transition appear :css="false" @enter="motion.enter" @enter-cancelled="motion.cancel">
        <header class="ad-title">
          <div>
            <h1>商品与展示配置</h1>
            <p>先检查预览，再让商品出现在访客目录。</p>
          </div>
          <button
            type="button"
            class="ad-primary"
            :disabled="busy || !categories.length"
            @click="beginCreate"
          >
            新建商品
          </button>
        </header>
      </Transition>
      <Transition :css="false" @enter="motion.enter" @enter-cancelled="motion.cancel">
        <form
          v-if="choosingTemplate"
          class="ad-template-picker"
          @submit.prevent="openDetail(templateSlug, true)"
        >
          <label
            >配置起点<select v-model="templateSlug" :disabled="busy" aria-label="配置起点">
              <option v-for="product in products" :key="product.slug" :value="product.slug">
                {{ product.name }} · {{ product.slug }}
              </option>
            </select></label
          >
          <p class="ad-muted">
            复制所选商品的展示配置与素材引用作为起点；新商品默认下架，创建前请检查内容。
          </p>
          <div class="ad-actions">
            <button type="submit" :disabled="busy || !templateSlug">使用此配置开始</button
            ><button type="button" :disabled="busy" @click="choosingTemplate = false">
              取消新建
            </button>
          </div>
        </form>
      </Transition>
      <div class="ad-list-tools">
        <label class="ad-search"
          >查找商品<input v-model="query" placeholder="商品名称或标识" type="search"
        /></label>
        <div v-if="status" class="ad-request">
          <p role="status">{{ status }}</p>
          <UiLoadingTrack />
        </div>
      </div>
      <div v-if="error" class="ad-error ad-list-error" role="alert">
        {{ error }}
        <button type="button" @click="retry">{{ failed ? '重试打开' : '重新读取' }}</button>
      </div>
      <div v-if="filtered.length" class="ad-table-wrap" :aria-busy="busy">
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
                <button
                  type="button"
                  :aria-label="'编辑' + item.name"
                  :disabled="busy"
                  @click="openDetail(item.slug)"
                >
                  编辑
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-else-if="!busy && !error" class="ad-empty">
        没有匹配的商品。清除搜索或新建商品，完成配置后即可上架。
      </p>
    </template>
  </section>
</template>

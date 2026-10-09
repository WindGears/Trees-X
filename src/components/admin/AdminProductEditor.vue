<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, onScopeDispose, ref, watch } from 'vue'
import { adminApi, message, type AdminDetail, type Category } from '@/lib/admin/api'
import { createProductDraft, provideProductDraft } from '@/lib/admin/productDraft'
import { applyCameraCapture, editorSections } from '@/lib/admin/editor'
import type { CameraSnapshot } from '@/lib/workbench/cameraCapture'
import type { WorkbenchProduct } from '@/lib/workbench/types'
import AdminBasicFields from './AdminBasicFields.vue'
import AdminHotspots from './AdminHotspots.vue'
import AdminFinishes from './AdminFinishes.vue'
import AdminCamera from './AdminCamera.vue'
import AdminActions from './AdminActions.vue'
import AdminGuide from './AdminGuide.vue'
import AdminConfigEditor from './AdminConfigEditor.vue'
const AdminPreview = defineAsyncComponent(() => import('./AdminPreview.vue'))
const props = defineProps<{ detail: AdminDetail; categories: Category[]; create: boolean }>()
const emit = defineEmits<{ close: []; dirty: [value: boolean] }>()
const draft = createProductDraft(props.detail, props.create)
provideProductDraft(draft)
const { item, section, dirty, issues, advancedDirty } = draft
const creating = ref(props.create),
  busy = ref(false),
  error = ref(''),
  notice = ref('')
const preview = ref<WorkbenchProduct | null>(null)
const captureTarget = ref('default')
const blocked = computed(() => busy.value || advancedDirty.value || issues.value.length > 0)
watch(dirty, (value) => emit('dirty', value), { immediate: true })
async function save() {
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    const saved = await adminApi.save(draft.payload(), creating.value)
    draft.accept(saved)
    creating.value = false
    notice.value = saved.item.listed
      ? '已保存。访客重新加载后读取更新内容。'
      : '已保存。商品仍为下架状态，预览确认后可上架。'
  } catch (e) {
    error.value = message(e)
  } finally {
    busy.value = false
  }
}
async function showPreview(target: string = 'default') {
  captureTarget.value = typeof target === 'string' ? target : 'default'
  busy.value = true
  error.value = ''
  try {
    preview.value = await adminApi.preview(draft.payload())
  } catch (e) {
    error.value = message(e)
  } finally {
    busy.value = false
  }
}
function captured(target: string, snapshot: CameraSnapshot) {
  try {
    if (snapshot.slug !== preview.value?.slug)
      throw new Error('取景已过期，请重新打开当前商品预览。')
    applyCameraCapture(draft.presentation.value, target, snapshot)
    draft.choose('camera')
    notice.value = '取景已回填到表单，尚未保存到数据库。'
  } catch (e) {
    error.value = message(e)
  }
  preview.value = null
}
async function visibility() {
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    const updated = await adminApi.visibility(item.value, !item.value.listed)
    draft.accept({ item: updated, presentation: draft.presentation.value })
    notice.value = updated.listed
      ? '已上架，访客目录可见。'
      : '已下架，公开目录与详情已停止提供该商品。'
  } catch (e) {
    error.value = message(e)
  } finally {
    busy.value = false
  }
}
async function reload() {
  if (dirty.value && !window.confirm('重新读取将丢弃当前未保存修改，继续？')) return
  busy.value = true
  error.value = ''
  try {
    draft.accept(await adminApi.detail(item.value.slug))
  } catch (e) {
    error.value = message(e)
  } finally {
    busy.value = false
  }
}
function close() {
  if (!dirty.value || window.confirm('尚有未保存的修改，返回列表会丢弃。继续？')) emit('close')
}
const expired = () => {
  preview.value = null
}
onMounted(() => window.addEventListener('trees-admin-expired', expired))
onScopeDispose(() => window.removeEventListener('trees-admin-expired', expired))
</script>
<template>
  <AdminPreview
    v-if="preview"
    :product="preview"
    :capture-target="captureTarget"
    @close="preview = null"
    @capture="captured"
  />
  <template v-else>
    <header class="ad-title">
      <div>
        <button type="button" class="ad-back" :disabled="busy" @click="close">返回商品列表</button>
        <h1>{{ creating ? '新建商品' : item.name }}</h1>
        <p>编辑当前商品；预览和取景不保存数据库，完成后手动保存。</p>
      </div>
      <span class="ad-state">{{ dirty ? '有未保存修改' : item.listed ? '已上架' : '已下架' }}</span>
    </header>
    <form class="ad-editor" novalidate @submit.prevent="save">
      <nav class="ad-editor-tabs" aria-label="商品编辑分区">
        <button
          v-for="[id, label] in editorSections"
          :key="id"
          type="button"
          :aria-current="section === id ? 'page' : undefined"
          :disabled="busy"
          @click="draft.choose(id)"
        >
          {{ label }}
        </button>
      </nav>
      <fieldset :disabled="busy" class="ad-editor-body">
        <legend class="sr-only">商品与展示配置</legend>
        <AdminBasicFields
          v-show="section === 'info'"
          :categories="categories"
          :creating="creating"
        />
        <AdminHotspots v-show="section === 'hotspots'" />
        <AdminFinishes v-show="section === 'finishes'" />
        <AdminCamera v-show="section === 'camera'" @capture="showPreview" />
        <AdminActions v-show="section === 'actions'" />
        <AdminGuide v-show="section === 'guide'" />
        <AdminConfigEditor v-show="section === 'advanced'" />
      </fieldset>
      <div class="ad-savebar">
        <div v-if="issues.length" class="ad-error ad-issues" role="alert">
          <p>有{{ issues.length }}项需要修正，保存与预览暂不可用。</p>
          <button
            v-for="(issue, index) in issues"
            :key="issue.path + index"
            type="button"
            :disabled="busy"
            @click="draft.locate(issue)"
          >
            {{ issue.message }}
          </button>
        </div>
        <p v-if="advancedDirty" class="ad-muted">
          高级JSON尚未应用，请在高级配置中应用或放弃输入。
        </p>
        <p v-if="error" role="alert" class="ad-error">{{ error }}</p>
        <p v-if="notice" role="status">{{ notice }}</p>
        <div class="ad-actions">
          <button type="submit" class="ad-primary" :disabled="blocked">
            {{ busy ? '正在处理…' : '保存修改' }}</button
          ><button type="button" :disabled="blocked" @click="showPreview()">预览当前配置</button
          ><button v-if="!creating" type="button" :disabled="busy || dirty" @click="visibility">
            {{ item.listed ? '下架商品' : '上架商品' }}</button
          ><button v-if="!creating" type="button" :disabled="busy" @click="reload">重新读取</button>
        </div>
        <p class="ad-muted">
          {{ dirty ? '上下架前先保存修改。' : '保存上架商品后，访客重新加载读取更新内容。' }}
        </p>
      </div>
    </form>
  </template>
</template>

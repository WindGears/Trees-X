<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, onScopeDispose, ref, watch } from 'vue'
import { ArrowLeft } from '@lucide/vue'
import { adminApi, message, type AdminDetail, type Category } from '@/lib/admin/api'
import { createProductDraft, provideProductDraft } from '@/lib/admin/productDraft'
import { applyCameraCapture, editorSections, type EditorSection } from '@/lib/admin/editor'
import type { CameraSnapshot } from '@/lib/workbench/cameraCapture'
import type { WorkbenchProduct } from '@/lib/workbench/types'
import { createInterfaceMotion } from '@/lib/workbench/interfaceMotion'
import UiLoadingTrack from '@/components/ui/UiLoadingTrack.vue'
import AdminBasicFields from './AdminBasicFields.vue'
import AdminHotspots from './AdminHotspots.vue'
import AdminFinishes from './AdminFinishes.vue'
import AdminCamera from './AdminCamera.vue'
import AdminActions from './AdminActions.vue'
import AdminGuide from './AdminGuide.vue'
import AdminConfigEditor from './AdminConfigEditor.vue'
import AdminProductMenu from './AdminProductMenu.vue'
const loadPreview = () => import('./AdminPreview.vue')
const AdminPreview = defineAsyncComponent(loadPreview)
const requestLabels = {
  save: '正在保存修改…',
  preview: '正在准备三维预览…',
  visibility: '正在更新上架状态…',
  reload: '正在重新读取配置…',
}
const groups: { label: string; ids: EditorSection[] }[] = [
  { label: '商品资料', ids: ['info', 'finishes'] },
  { label: '展示内容', ids: ['hotspots', 'camera', 'actions', 'guide'] },
  { label: '高级设置', ids: ['advanced'] },
]
const sectionGroups = groups.map(({ label, ids }) => ({
  label,
  sections: editorSections.filter(([id]) => ids.includes(id)),
}))
const props = defineProps<{ detail: AdminDetail; categories: Category[]; create: boolean }>()
const emit = defineEmits<{ close: []; dirty: [value: boolean] }>()
const draft = createProductDraft(props.detail, props.create)
provideProductDraft(draft)
const { item, section, dirty, issues, advancedDirty } = draft
const creating = ref(props.create),
  pending = ref<keyof typeof requestLabels | null>(null),
  error = ref(''),
  notice = ref('')
const busy = computed(() => pending.value !== null)
const preview = ref<WorkbenchProduct | null>(null)
const captureTarget = ref('default')
const sectionBody = ref<HTMLElement>()
let previewRequest = 0
const motion = createInterfaceMotion('soft')
const blocked = computed(() => busy.value || advancedDirty.value || issues.value.length > 0)
watch(dirty, (value) => emit('dirty', value), { immediate: true })
watch(
  section,
  () => {
    if (sectionBody.value) motion.replace(sectionBody.value)
  },
  { flush: 'post' },
)
async function save() {
  if (blocked.value) return
  pending.value = 'save'
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
    pending.value = null
  }
}
async function showPreview(target: string = 'default') {
  if (blocked.value) return
  const request = ++previewRequest
  captureTarget.value = typeof target === 'string' ? target : 'default'
  pending.value = 'preview'
  error.value = ''
  try {
    const [product] = await Promise.all([adminApi.preview(draft.payload()), loadPreview()])
    if (request === previewRequest) preview.value = product
  } catch (e) {
    if (request === previewRequest) error.value = message(e)
  } finally {
    pending.value = null
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
  if (busy.value || dirty.value) return
  pending.value = 'visibility'
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
    pending.value = null
  }
}
async function reload() {
  if (busy.value) return
  if (dirty.value && !window.confirm('重新读取将丢弃当前未保存修改，继续？')) return
  pending.value = 'reload'
  error.value = ''
  notice.value = ''
  try {
    draft.accept(await adminApi.detail(item.value.slug))
  } catch (e) {
    error.value = message(e)
  } finally {
    pending.value = null
  }
}
function close() {
  if (!dirty.value || window.confirm('尚有未保存的修改，返回列表会丢弃。继续？')) emit('close')
}
const expired = () => {
  previewRequest++
  preview.value = null
}
onMounted(() => window.addEventListener('trees-admin-expired', expired))
onScopeDispose(() => {
  previewRequest++
  motion.dispose()
  window.removeEventListener('trees-admin-expired', expired)
})
</script>
<template>
  <AdminPreview
    v-if="preview"
    :product="preview"
    :capture-target="captureTarget"
    @close="preview = null"
    @capture="captured"
  />
  <form v-else class="ad-editor" novalidate @submit.prevent="save">
    <header class="ad-editor-header">
      <Transition appear :css="false" @enter="motion.enter" @enter-cancelled="motion.cancel">
        <div class="ad-editor-toolbar">
          <div class="ad-editor-identity">
            <button type="button" class="ad-back" :disabled="busy" @click="close">
              <ArrowLeft :size="15" aria-hidden="true" />返回商品列表
            </button>
            <h1>{{ item.name.trim() || (creating ? '新建商品' : '商品配置') }}</h1>
            <div class="ad-editor-meta">
              <span class="ad-state" :class="{ 'is-listed': item.listed }">
                {{ item.listed ? '已上架' : '已下架' }}
              </span>
              <span class="ad-state" :class="{ 'is-dirty': dirty }">
                {{ dirty ? '有未保存修改' : '已保存' }}
              </span>
            </div>
          </div>
          <div class="ad-editor-primary">
            <button type="button" :disabled="blocked" @click="showPreview()">预览当前配置</button>
            <button type="submit" class="ad-primary" :disabled="blocked">保存修改</button>
            <AdminProductMenu
              v-if="!creating"
              :busy="busy"
              :dirty="dirty"
              :listed="item.listed"
              @visibility="visibility"
              @reload="reload"
            />
          </div>
        </div>
      </Transition>
      <div v-if="pending" class="ad-request ad-editor-request">
        <p role="status">{{ requestLabels[pending] }}</p>
        <UiLoadingTrack />
      </div>
      <p v-if="error" role="alert" class="ad-error ad-editor-feedback">{{ error }}</p>
      <p v-if="!pending && notice" role="status" class="ad-editor-feedback">{{ notice }}</p>
    </header>
    <nav class="ad-editor-tabs" aria-label="商品编辑分区">
      <div v-for="group in sectionGroups" :key="group.label" role="group" :aria-label="group.label">
        <span aria-hidden="true">{{ group.label }}</span>
        <div class="ad-editor-section-buttons">
          <button
            v-for="[id, label] in group.sections"
            :key="id"
            type="button"
            :aria-current="section === id ? 'page' : undefined"
            :disabled="busy"
            @click="draft.choose(id)"
          >
            {{ label }}
          </button>
        </div>
      </div>
    </nav>
    <div v-if="issues.length || advancedDirty" class="ad-editor-validation">
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
      <p v-if="advancedDirty" class="ad-muted">高级JSON尚未应用，请在高级配置中应用或放弃输入。</p>
    </div>
    <fieldset ref="sectionBody" :disabled="busy" class="ad-editor-body">
      <legend class="sr-only">商品与展示配置</legend>
      <AdminBasicFields v-show="section === 'info'" :categories="categories" :creating="creating" />
      <AdminHotspots v-show="section === 'hotspots'" />
      <AdminFinishes v-show="section === 'finishes'" />
      <AdminCamera v-show="section === 'camera'" @capture="showPreview" />
      <AdminActions v-show="section === 'actions'" />
      <AdminGuide v-show="section === 'guide'" />
      <AdminConfigEditor v-show="section === 'advanced'" />
    </fieldset>
  </form>
</template>

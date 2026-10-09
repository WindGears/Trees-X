<script setup lang="ts">
import { computed, onMounted, onScopeDispose, ref } from 'vue'
import { useDocumentVisibility } from '@vueuse/core'
import {
  createCameraCaptureSession,
  provideCameraCaptureSession,
  type CameraSnapshot,
} from '@/lib/workbench/cameraCapture'
import { useWorkbenchStore } from '@/stores/workbench'
import type { Panel, WorkbenchProduct } from '@/lib/workbench/types'
import { provideMotionSession } from '@/lib/workbench/motionSession'
import WorkbenchStage from '@/components/workbench/WorkbenchStage.vue'
import WorkbenchPanel from '@/components/workbench/WorkbenchPanel.vue'
import WorkbenchTools from '@/components/workbench/WorkbenchTools.vue'
import '@/assets/styles/workbench.css'
import '@/assets/styles/workbench-accessibility.css'
import '@/assets/styles/workbench-motion.css'
const props = defineProps<{ product: WorkbenchProduct; captureTarget?: string }>()
const emit = defineEmits<{ close: []; capture: [target: string, snapshot: CameraSnapshot] }>()
const store = useWorkbenchStore()
const visibility = useDocumentVisibility()
const captureSession = createCameraCaptureSession(() => ({
  slug: store.slug,
  revision: store.revision,
  ready: store.available,
  active: visibility.value === 'visible',
}))
provideCameraCaptureSession(captureSession)
const captureTarget = ref(
    props.captureTarget === 'view:perspective' ? 'default' : (props.captureTarget ?? 'default'),
  ),
  captureError = ref('')
const canCapture = computed(
  () => store.available && visibility.value === 'visible' && captureSession.registered.value,
)
function capture() {
  const snapshot = captureSession.capture()
  if (!snapshot) {
    captureError.value = '当前场景尚未就绪，无法采集取景。请等待加载或重新进入预览。'
    return
  }
  emit('capture', captureTarget.value, snapshot)
}
provideMotionSession(store)
const titles = {
  appearance: '外观',
  details: '细节',
  actions: '结构与动作',
  guide: '商品导览',
  catalog: '目录',
}
function panel(value: Panel) {
  if (value !== 'catalog') store.openPanel(value)
}
onMounted(() => store.preview(props.product))
onScopeDispose(() => {
  captureSession.clear()
  store.dispose()
})
</script>
<template>
  <div class="ad-preview">
    <header class="ad-title">
      <div>
        <h1>{{ product.name }} · 配置预览</h1>
        <p>使用当前输入，不写入数据库。检查热点、视角、动作和导览后返回编辑。</p>
      </div>
      <button type="button" @click="emit('close')">返回编辑</button>
    </header>
    <div class="ad-capture-bar">
      <label
        >回填目标<select v-model="captureTarget" aria-label="回填目标">
          <option value="default">默认取景（含全景复位）</option>
          <option
            v-for="view in product.presentation.views.filter((v) => v.id !== 'perspective')"
            :key="view.id"
            :value="'view:' + view.id"
          >
            {{ view.label }}
          </option>
        </select></label
      >
      <button type="button" :disabled="!canCapture" @click="capture">使用此取景并返回</button>
      <p class="ad-muted">左键旋转 · 滚轮缩放 · 右键平移。只回填镜头，不保存外观或动作状态。</p>
      <p v-if="captureError" role="alert" class="ad-error">{{ captureError }}</p>
    </div>
    <div class="workbench" :data-status="store.status" :data-slug="store.slug">
      <main class="wb-layout" :class="{ 'with-inspector': store.panel }">
        <section class="wb-view" aria-label="管理预览">
          <WorkbenchStage preview /><WorkbenchTools v-if="!store.contentOnly" @panel="panel" />
        </section>
        <aside v-if="store.panel && store.panel !== 'catalog'" class="wb-panel wb-panel-right">
          <header>
            <h2>{{ titles[store.panel] }}</h2>
            <button type="button" aria-label="收起面板" @click="store.panel = null">收起</button>
          </header>
          <WorkbenchPanel />
        </aside>
      </main>
    </div>
  </div>
</template>

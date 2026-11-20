<script setup lang="ts">
import { computed, nextTick, onMounted, onScopeDispose, ref } from 'vue'
import { useDocumentVisibility } from '@vueuse/core'
import { ArrowLeft, Camera, ChevronDown } from '@lucide/vue'
import {
  createCameraCaptureSession,
  provideCameraCaptureSession,
  type CameraSnapshot,
} from '@/lib/workbench/cameraCapture'
import { useWorkbenchStore } from '@/stores/workbench'
import type { Panel, WorkbenchProduct } from '@/lib/workbench/types'
import { provideMotionSession } from '@/lib/workbench/motionSession'
import { createInterfaceMotion } from '@/lib/workbench/interfaceMotion'
import { adminExhibitionSearch } from '@/lib/workbench/exhibition'
import { showcaseRequested } from '@/lib/workbench/rendering/showcase'
import WorkbenchStage from '@/components/workbench/WorkbenchStage.vue'
import WorkbenchInspector from '@/components/workbench/WorkbenchInspector.vue'
import WorkbenchTools from '@/components/workbench/WorkbenchTools.vue'
import '@/assets/styles/workbench.css'
import '@/assets/styles/workbench-accessibility.css'
import '@/assets/styles/workbench-motion.css'
const props = defineProps<{ product: WorkbenchProduct; captureTarget?: string }>()
const emit = defineEmits<{ close: []; capture: [target: string, snapshot: CameraSnapshot] }>()
const store = useWorkbenchStore()
const exhibition = showcaseRequested(adminExhibitionSearch(location.search))
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
const motion = createInterfaceMotion('soft')
const inspector = ref<HTMLElement>()
const heading = ref<HTMLHeadingElement>()
let panelOpener: HTMLElement | null = null
const activeSection = computed(() => (store.panel === 'catalog' ? null : store.panel))
function closePanel() {
  store.panel = null
  panelOpener?.focus({ preventScroll: true })
  panelOpener = null
}
function panel(value: Panel) {
  if (value === 'catalog') return
  if (store.panel === value) {
    closePanel()
    return
  }
  panelOpener = document.activeElement instanceof HTMLElement ? document.activeElement : null
  const wasOpen = Boolean(activeSection.value)
  store.openPanel(value)
  void nextTick(() => {
    if (!wasOpen && store.panel === value)
      inspector.value?.querySelector<HTMLElement>('.wb-panel-close')?.focus({ preventScroll: true })
  })
}
onMounted(() => {
  store.preview(props.product)
  heading.value?.focus()
})
onScopeDispose(() => {
  motion.dispose()
  captureSession.clear()
  store.dispose()
})
</script>
<template>
  <div class="ad-preview">
    <Transition appear :css="false" @enter="motion.enter" @enter-cancelled="motion.cancel">
      <header class="ad-preview-header">
        <div class="ad-preview-identity">
          <button type="button" class="ad-back" @click="emit('close')">
            <ArrowLeft :size="15" aria-hidden="true" />返回编辑
          </button>
          <h1 ref="heading" tabindex="-1">{{ product.name }} · 配置预览</h1>
          <p>预览当前草稿。取景回填后可在表单中保存。</p>
        </div>
        <div class="ad-capture-bar">
          <label>
            <span>回填目标</span>
            <select v-model="captureTarget" aria-label="回填目标" @change="captureError = ''">
              <option value="default">默认取景（含全景复位）</option>
              <option
                v-for="view in product.presentation.views.filter((v) => v.id !== 'perspective')"
                :key="view.id"
                :value="'view:' + view.id"
              >
                {{ view.label }}
              </option>
            </select>
          </label>
          <button type="button" class="ad-primary" :disabled="!canCapture" @click="capture">
            <Camera :size="16" aria-hidden="true" />使用此取景并返回
          </button>
          <details class="ad-capture-help">
            <summary>操作提示<ChevronDown :size="14" aria-hidden="true" /></summary>
            <p>左键旋转，滚轮缩放，右键平移。只回填镜头，外观与结构状态不随取景保存。</p>
          </details>
        </div>
        <p v-if="captureError" role="alert" class="ad-error">{{ captureError }}</p>
      </header>
    </Transition>
    <div class="workbench" :data-status="store.status" :data-slug="store.slug">
      <div
        ref="inspector"
        class="wb-layout"
        :class="{ 'with-inspector': store.panel }"
        @keydown.esc="closePanel"
      >
        <section class="wb-view" aria-label="管理预览">
          <WorkbenchStage preview /><WorkbenchTools
            v-if="!store.contentOnly"
            :exhibition="exhibition"
            @panel="panel"
          />
        </section>
        <WorkbenchInspector :panel="activeSection" :exhibition="exhibition" @close="closePanel" />
      </div>
    </div>
  </div>
</template>

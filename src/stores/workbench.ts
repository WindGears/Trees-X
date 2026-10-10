import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { getProduct, getProducts } from '@/lib/workbench/api'
import type { LoadPhase } from '@/lib/workbench/assetBundle'
import { LatestRequest } from '@/lib/workbench/latest'
import type {
  MotionCommand,
  Panel,
  ProductSummary,
  SceneCommand,
  WorkbenchProduct,
} from '@/lib/workbench/types'

export const useWorkbenchStore = defineStore('workbench', () => {
  const product = ref<WorkbenchProduct | null>(null),
    products = ref<ProductSummary[]>([])
  const slug = ref('typewriter-study'),
    revision = ref(0)
  const status = ref<'loading' | 'ready' | 'content' | 'error'>('loading'),
    error = ref('')
  const contentOnly = ref(false),
    compatibilityReason = ref('')
  const loadPhase = ref<LoadPhase | 'config'>('config')
  const catalogStatus = ref<'loading' | 'ready' | 'error'>('loading'),
    catalogError = ref('')
  const panel = ref<Panel | null>(null),
    query = ref(''),
    category = ref('')
  const finishId = ref(''),
    selectedPart = ref(''),
    exploded = ref(false),
    guideStep = ref(-1)
  const actions = ref<Record<string, number>>({})
  const command = ref<SceneCommand>({ revision: 0, kind: 'view', id: 'perspective' })
  const motionCommand = ref<MotionCommand>({ revision: 0, operation: 'pause', id: '' })
  const pulse = ref({ id: '', revision: 0 })
  const manualRequest = ref(0),
    resetMotionRequest = ref(0),
    viewId = ref('perspective')
  const selection = new LatestRequest(),
    catalog = new LatestRequest()
  let previewProduct: WorkbenchProduct | null = null
  const presentation = computed(() => product.value?.presentation)
  const hotspot = computed(() =>
    presentation.value?.hotspots.find((h) => h.id === selectedPart.value),
  )
  const available = computed(() => status.value === 'ready')
  function issue(value: Omit<SceneCommand, 'revision'>) {
    command.value = { ...value, revision: command.value.revision + 1 }
  }
  function manual() {
    guideStep.value = -1
    manualRequest.value++
    viewId.value = ''
  }
  function view(id = 'perspective', fromGuide = false) {
    if (!presentation.value?.views.some((v) => v.id === id)) return
    if (!fromGuide) manual()
    viewId.value = id
    selectedPart.value = ''
    issue({ kind: 'view', id })
  }
  function focus(id: string, fromGuide = false) {
    if (!presentation.value?.hotspots.some((h) => h.id === id)) return
    if (!fromGuide) manual()
    viewId.value = ''
    selectedPart.value = id
    issue({ kind: 'focus', id })
  }
  function action(id: string, fromGuide = false) {
    const definition = presentation.value?.actions.find((a) => a.id === id)
    if (!definition) return
    if (definition.kind === 'progress') {
      motion('play', id, 1, fromGuide)
      return
    }
    if (!fromGuide) manual()
    if (definition.kind === 'pulse') pulse.value = { id, revision: pulse.value.revision + 1 }
    else actions.value = { ...actions.value, [id]: fromGuide ? 1 : actions.value[id] ? 0 : 1 }
  }
  function structure(value: boolean) {
    if (!presentation.value?.structure) return
    if (presentation.value.structureActionId) {
      motion('play', presentation.value.structureActionId, value ? 1 : 0)
      return
    }
    manual()
    exploded.value = value
  }
  function finish(id: string) {
    if (!presentation.value?.finishes.some((f) => f.id === id)) return
    manual()
    finishId.value = id
  }
  function resetActions(fromGuide = false) {
    if (!fromGuide) manual()
    resetMotionRequest.value++
    actions.value = {}
    exploded.value = false
  }
  function overview(fromGuide = false) {
    resetActions(true)
    view('perspective', fromGuide)
  }
  function restore() {
    finishId.value = presentation.value?.finishes[0]?.id ?? ''
    overview()
  }
  function guide(index: number) {
    const step = presentation.value?.guide[index]
    if (!step) return
    if (step.overview) overview(true)
    else {
      if (step.view) view(step.view, true)
      if (step.hotspotId) focus(step.hotspotId, true)
      if (step.explode !== undefined) {
        if (presentation.value?.structureActionId)
          motion('play', presentation.value.structureActionId, step.explode ? 1 : 0, true)
        else exploded.value = step.explode
      }
      if (step.actionId) action(step.actionId, true)
      if (step.progress) motion('seek', step.progress.actionId, step.progress.value, true)
    }
    guideStep.value = index
  }
  function zoom(direction: 1 | -1) {
    manual()
    issue({ kind: 'zoom', direction })
  }
  function motion(
    operation: MotionCommand['operation'],
    id: string,
    value?: number,
    fromGuide = false,
  ) {
    if (
      !available.value ||
      !presentation.value?.actions.some((a) => a.id === id && a.kind === 'progress')
    )
      return
    if (value !== undefined && (!Number.isFinite(value) || value < 0 || value > 1)) return
    if (!fromGuide) manual()
    motionCommand.value = { revision: motionCommand.value.revision + 1, operation, id, value }
  }
  function orbit(axis: 'horizontal' | 'vertical', direction: 1 | -1) {
    if (!available.value) return
    manual()
    issue({ kind: 'orbit', axis, direction })
  }
  function useContent(reason: string) {
    contentOnly.value = true
    compatibilityReason.value = reason
    panel.value = panel.value === 'catalog' ? 'catalog' : null
    manual()
    if (product.value) status.value = 'content'
  }
  function openPanel(value: Panel | null) {
    panel.value = panel.value === value ? null : value
  }
  async function loadCatalog() {
    catalogStatus.value = 'loading'
    catalogError.value = ''
    await catalog.run(
      (signal) => getProducts(signal, query.value, category.value),
      (result) => {
        products.value = result
        catalogStatus.value = 'ready'
      },
      (cause) => {
        catalogStatus.value = 'error'
        catalogError.value = cause instanceof Error ? cause.message : '目录加载失败'
      },
    )
  }
  function prepare(id: string) {
    slug.value = id
    revision.value++
    status.value = 'loading'
    loadPhase.value = 'config'
    error.value = ''
    product.value = null
    panel.value = null
    guideStep.value = -1
    selectedPart.value = ''
    exploded.value = false
    actions.value = {}
    viewId.value = 'perspective'
  }
  function preview(value: WorkbenchProduct) {
    selection.cancel()
    previewProduct = value
    prepare(value.slug)
    product.value = value
    finishId.value = value.presentation.finishes[0]!.id
    if (contentOnly.value) status.value = 'content'
  }
  function retry() {
    return previewProduct ? preview(previewProduct) : select(slug.value)
  }
  async function select(id: string) {
    previewProduct = null
    prepare(id)
    await selection.run(
      (signal) => getProduct(id, signal),
      (result) => {
        product.value = result
        finishId.value = result.presentation.finishes[0]!.id
        if (contentOnly.value) status.value = 'content'
      },
      (cause) => {
        status.value = 'error'
        error.value = cause instanceof Error ? cause.message : '商品加载失败'
      },
    )
  }
  function loading(id: string, generation: number, phase: LoadPhase) {
    if (slug.value === id && revision.value === generation && status.value === 'loading')
      loadPhase.value = phase
  }
  function ready(id: string, generation: number) {
    if (!contentOnly.value && slug.value === id && revision.value === generation)
      status.value = 'ready'
  }
  function failed(id: string, generation: number, message: string) {
    if (!contentOnly.value && slug.value === id && revision.value === generation) {
      status.value = 'error'
      error.value = message
    }
  }
  function dispose() {
    previewProduct = null
    selection.cancel()
    catalog.cancel()
    product.value = null
    panel.value = null
    contentOnly.value = false
    compatibilityReason.value = ''
  }
  return {
    product,
    products,
    slug,
    revision,
    status,
    contentOnly,
    compatibilityReason,
    useContent,
    loadPhase,
    loading,
    error,
    catalogStatus,
    catalogError,
    panel,
    query,
    category,
    finishId,
    selectedPart,
    hotspot,
    exploded,
    guideStep,
    actions,
    command,
    motionCommand,
    motion,
    pulse,
    manualRequest,
    resetMotionRequest,
    viewId,
    presentation,
    available,
    manual,
    view,
    focus,
    action,
    structure,
    finish,
    overview,
    resetActions,
    restore,
    guide,
    zoom,
    orbit,
    openPanel,
    loadCatalog,
    select,
    preview,
    retry,
    ready,
    failed,
    dispose,
  }
})

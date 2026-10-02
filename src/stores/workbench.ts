import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { getProduct, getProducts } from '@/lib/workbench/api'
import { LatestRequest } from '@/lib/workbench/latest'
import type { Panel, ProductSummary, SceneCommand, WorkbenchProduct } from '@/lib/workbench/types'

export const useWorkbenchStore = defineStore('workbench', () => {
  const product = ref<WorkbenchProduct | null>(null),
    products = ref<ProductSummary[]>([])
  const slug = ref('form-01'),
    revision = ref(0)
  const status = ref<'loading' | 'ready' | 'error'>('loading'),
    error = ref('')
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
  const pulse = ref({ id: '', revision: 0 })
  const manualRequest = ref(0),
    resetMotionRequest = ref(0),
    viewId = ref('perspective')
  const selection = new LatestRequest(),
    catalog = new LatestRequest()
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
    if (!fromGuide) manual()
    if (definition.kind === 'pulse') pulse.value = { id, revision: pulse.value.revision + 1 }
    else actions.value = { ...actions.value, [id]: fromGuide ? 1 : actions.value[id] ? 0 : 1 }
  }
  function structure(value: boolean) {
    if (!presentation.value?.structure) return
    manual()
    exploded.value = value
  }
  function finish(id: string) {
    if (!presentation.value?.finishes.some((f) => f.id === id)) return
    manual()
    finishId.value = id
  }
  function overview(fromGuide = false) {
    resetMotionRequest.value++
    actions.value = {}
    exploded.value = false
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
      if (step.explode !== undefined) exploded.value = step.explode
      if (step.actionId) action(step.actionId, true)
    }
    guideStep.value = index
  }
  function zoom(direction: 1 | -1) {
    manual()
    issue({ kind: 'zoom', direction })
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
  async function select(id: string) {
    slug.value = id
    revision.value++
    status.value = 'loading'
    error.value = ''
    product.value = null
    panel.value = null
    guideStep.value = -1
    selectedPart.value = ''
    exploded.value = false
    actions.value = {}
    viewId.value = 'perspective'
    await selection.run(
      (signal) => getProduct(id, signal),
      (result) => {
        product.value = result
        finishId.value = result.presentation.finishes[0]!.id
      },
      (cause) => {
        status.value = 'error'
        error.value = cause instanceof Error ? cause.message : '商品加载失败'
      },
    )
  }
  function ready(id: string, generation: number) {
    if (slug.value === id && revision.value === generation) status.value = 'ready'
  }
  function failed(id: string, generation: number, message: string) {
    if (slug.value === id && revision.value === generation) {
      status.value = 'error'
      error.value = message
    }
  }
  function dispose() {
    selection.cancel()
    catalog.cancel()
    product.value = null
    panel.value = null
  }
  return {
    product,
    products,
    slug,
    revision,
    status,
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
    restore,
    guide,
    zoom,
    openPanel,
    loadCatalog,
    select,
    ready,
    failed,
    dispose,
  }
})

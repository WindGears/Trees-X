import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { demoProduct } from '@/data/products'
import { findProduct } from '@/data/collection'
import { stageFor, storyFor } from '@/data/exhibition'

export type ViewPreset = 'perspective' | 'front' | 'back' | 'detail' | 'structure'
export type ModelStatus = 'loading' | 'ready' | 'error'
export type VisualQuality = 'cinematic' | 'eco'
export type StudioPanel = 'appearance' | 'details' | 'structure' | 'gesture' | 'console' | 'info'

export const useProductStore = defineStore('product', () => {
  const product = ref(findProduct('form-01') ?? demoProduct)
  const catalogOpen = ref(false)
  const panel = ref<StudioPanel | null>(null)
  const manualRequest = ref(0)
  const cameraStatus = ref<'off' | 'starting' | 'running' | 'error'>('off')
  const cameraStopRequest = ref(0)
  const stage = computed(() => stageFor(product.value))
  const storySteps = computed(() => storyFor(product.value))
  const selectionRevision = ref(0)
  const status = ref<ModelStatus>('loading')
  const quality = ref<VisualQuality>('cinematic')
  const visualIntroRequest = ref(0)
  const viewPreset = ref<ViewPreset>('perspective')
  const viewRequest = ref(0)
  const zoomRequest = ref(0)
  const zoomDirection = ref<1 | -1>(1)
  const finishId = ref('silver')
  const exploded = ref(false)
  const activePartId = ref('woofer')
  const guideStep = ref<number | null>(null)
  const guideLength = computed(() => storySteps.value.length)
  const activePart = computed(() =>
    product.value.hotspots.find((part) => part.id === activePartId.value),
  )
  const activeFinish = computed(
    () =>
      product.value.finishes.find((finish) => finish.id === finishId.value) ??
      product.value.finishes[0]!,
  )

  function setView(preset: ViewPreset) {
    guideStep.value = null
    viewPreset.value = preset
    viewRequest.value += 1
  }
  function openPanel(value: StudioPanel | null) {
    manualRequest.value++
    panel.value = value
  }
  function returnToOverview() {
    exploded.value = false
    setView('perspective')
  }

  function zoom(direction: 1 | -1) {
    guideStep.value = null
    zoomDirection.value = direction
    zoomRequest.value += 1
  }

  function focusPart(id = activePartId.value) {
    if (!product.value.hotspots.some((part) => part.id === id)) return
    activePartId.value = id
    setView('detail')
  }

  function setStructure(value: boolean) {
    if (!product.value.structure.length) return
    exploded.value = value
    setView(value ? 'structure' : 'perspective')
  }

  function resetExperience() {
    finishId.value = product.value.finishes[0]!.id
    activePartId.value = product.value.hotspots[0]?.id ?? ''
    exploded.value = false
    guideStep.value = null
    setView('perspective')
  }

  function goToGuideStep(requestedStep: number) {
    const index = Math.max(0, Math.min(guideLength.value - 1, requestedStep))
    const step = storySteps.value[index]!
    exploded.value = step.view === 'structure'
    if (step.partId) focusPart(step.partId)
    else setView(step.view ?? 'perspective')
    guideStep.value = index
  }

  function replayVisualIntro() {
    visualIntroRequest.value += 1
  }

  function selectProduct(id: string) {
    const next = findProduct(id)
    if (!next) return false
    catalogOpen.value = false
    if (next.id === product.value.id) return true
    status.value = 'loading'
    selectionRevision.value++
    product.value = next
    if (panel.value !== 'console') panel.value = null
    resetExperience()
    return true
  }

  return {
    product,
    stage,
    storySteps,
    panel,
    openPanel,
    returnToOverview,
    manualRequest,
    cameraStatus,
    cameraStopRequest,
    catalogOpen,
    selectionRevision,
    selectProduct,
    guideLength,
    status,
    quality,
    visualIntroRequest,
    viewPreset,
    viewRequest,
    zoomRequest,
    zoomDirection,
    finishId,
    activeFinish,
    exploded,
    activePartId,
    activePart,
    guideStep,
    focusPart,
    setStructure,
    resetExperience,
    goToGuideStep,
    replayVisualIntro,
    setView,
    zoom,
  }
})

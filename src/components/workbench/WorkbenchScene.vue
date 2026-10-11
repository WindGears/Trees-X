<script setup lang="ts">
import { computed, nextTick, onMounted, onScopeDispose, watch } from 'vue'
import { useLoop, useTres, useTresContext } from '@tresjs/core'
import {
  PerspectiveCamera,
  Color,
  Fog,
  PMREMGenerator,
  WebGLRenderer,
  type WebGLRenderTarget,
} from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { createStageController } from '@/lib/workbench/controller'
import { hasTypewriterStudio, resolveWorkbenchStage } from '@/lib/workbench/studioPreset'
import WorkbenchLighting from './WorkbenchLighting.vue'
import { useWorkbenchStore } from '@/stores/workbench'
import { useMotionSession } from '@/lib/workbench/motionSession'
import { useCameraCaptureSession } from '@/lib/workbench/cameraCapture'
import type { PlaceCallout } from '@/lib/workbench/calloutProjection'
import { createViewportFraming } from '@/lib/workbench/viewportFraming'

const props = defineProps<{
  active: boolean
  place: PlaceCallout
  commit: () => void
  gallery?: boolean
  inspector?: boolean
  catalog?: boolean
}>()
const emit = defineEmits<{ restore: [] }>()
const store = useWorkbenchStore()
const motionSession = useMotionSession()
const captureSession = useCameraCaptureSession()
let unregisterCapture: (() => void) | undefined
let motionSlug = '',
  motionRevision = -1
const { scene, camera, renderer, sizes, invalidate } = useTres()
const context = useTresContext()
const { start, stop, isActive, onBeforeRender } = useLoop()
const background = new Color('#151c25')
const fog = new Fog(background, 12, 38)
scene.value.background = background
scene.value.fog = fog
const studio = computed(() => hasTypewriterStudio(store.presentation))
const stage = computed(() => resolveWorkbenchStage(store.presentation, Boolean(props.gallery)))
watch(
  stage,
  (value) => {
    background.set(value.background)
    fog.color.copy(background)
    scene.value.environmentIntensity = value.environmentIntensity
    if (renderer instanceof WebGLRenderer) renderer.toneMappingExposure = value.exposure
    invalidate()
  },
  { immediate: true },
)
let controller: ReturnType<typeof createStageController> | undefined
onBeforeRender(() => controller?.beforeRender())
let environment: WebGLRenderTarget | undefined,
  disposed = false,
  generation = 0
let removeFrame: (() => void) | undefined, removeListeners: (() => void) | undefined
async function load() {
  const request = ++generation
  removeFrame?.()
  removeFrame = undefined
  controller?.unload()
  const product = store.product,
    revision = store.revision
  if (!controller || !product) return
  motionSlug = product.slug
  motionRevision = revision
  try {
    const loaded = await controller.load(product, (phase) => {
      if (!disposed && request === generation) store.loading(product.slug, revision, phase)
    })
    if (!loaded || disposed || request !== generation) return
    controller.sync(store.finishId, store.exploded, store.actions, true)
    if (!(renderer instanceof WebGLRenderer) || !camera.value) return
    store.loading(product.slug, revision, 'first-frame')
    await renderer.compileAsync(scene.value, camera.value)
    if (disposed || request !== generation) return
    const frame = context.renderer.onRender(() => {
      frame.off()
      if (!disposed && request === generation) {
        controller?.enableInteraction()
        store.ready(product.slug, revision)
        void nextTick(() => {
          if (!disposed && request === generation) invalidate()
        })
      }
    })
    removeFrame = frame.off
    invalidate()
  } catch (cause) {
    if (!disposed && request === generation) {
      controller?.unload()
      store.failed(
        product.slug,
        revision,
        cause instanceof Error ? cause.message : '三维模型加载失败，请重试。',
      )
    }
  }
}
function updateActive() {
  controller?.setActive(props.active)
  if (!context.renderer.isInitialized.value) return
  if (props.active) {
    if (!isActive.value) start()
    invalidate()
  } else if (isActive.value) stop()
}
const readyListener = context.renderer.onReady(updateActive)
onMounted(() => {
  if (!(renderer instanceof WebGLRenderer) || !(camera.value instanceof PerspectiveCamera)) {
    store.failed(store.slug, store.revision, '当前浏览器无法启动三维工作台。请开启图形加速。')
    return
  }
  const room = new RoomEnvironment(),
    generator = new PMREMGenerator(renderer)
  try {
    environment = generator.fromScene(room)
    scene.value.environment = environment.texture
    scene.value.environmentIntensity = stage.value.environmentIntensity
  } finally {
    room.dispose()
    generator.dispose()
  }
  controller = createStageController(
    renderer,
    scene.value,
    camera.value,
    invalidate,
    store.manual,
    (id) => {
      store.focus(id)
      store.panel = 'details'
    },
    (id, status) => motionSession.report(motionSlug, motionRevision, id, status),
    motionSession.snapshot,
    { allowPan: Boolean(captureSession) },
  )
  unregisterCapture = captureSession?.register(() => {
    const pose = controller?.snapshotCamera()
    return pose ? { ...pose, slug: motionSlug, revision: motionRevision } : undefined
  })
  const loss = (event: Event) => {
    event.preventDefault()
    generation++
    removeFrame?.()
    controller?.setActive(false)
    controller?.unload()
    stop()
    store.failed(store.slug, store.revision, '图形连接已中断，正在等待恢复。')
  }
  const restore = () => emit('restore')
  const canvas = renderer.domElement
  canvas.addEventListener('webglcontextlost', loss)
  canvas.addEventListener('webglcontextrestored', restore)
  removeListeners = () => {
    canvas.removeEventListener('webglcontextlost', loss)
    canvas.removeEventListener('webglcontextrestored', restore)
  }
  void load()
  updateActive()
})
watch(
  // Preview retry may reuse the exact config object; the selection generation
  // must still trigger a new adapter load after a binding failure.
  () => [store.product, store.revision] as const,
  () => void load(),
  { flush: 'post' },
)
watch(
  () => store.command,
  (value) => controller?.command(value),
  { flush: 'post' },
)
watch(
  () => store.manualRequest,
  () => controller?.pauseObservation(),
)
watch(
  () => store.motionCommand,
  (value) => controller?.motionCommand(value),
  { flush: 'post' },
)
watch(
  () => store.resetMotionRequest,
  () => controller?.resetMotion(),
)
watch(
  () => [store.finishId, store.exploded, store.actions],
  () => controller?.sync(store.finishId, store.exploded, store.actions),
  { flush: 'post' },
)
watch(
  () => store.pulse,
  (value) => controller?.pulse(value.id),
)
watch(() => props.active, updateActive)
const framing = createViewportFraming(invalidate)
watch(
  () => props.active,
  (active) => {
    if (!active) framing.finish()
  },
)
watch(
  () =>
    [
      sizes.width.value,
      sizes.height.value,
      camera.value,
      props.gallery,
      props.inspector,
      props.catalog,
    ] as const,
  ([width, height, current, gallery, inspector, catalog]) => {
    if (!(current instanceof PerspectiveCamera) || !width || !height) return
    framing.update(current, width, height, Boolean(gallery), Boolean(inspector), Boolean(catalog))
  },
  { immediate: true, flush: 'post' },
)
const projection = context.renderer.onRender(() => {
  controller?.project(sizes.width.value, sizes.height.value, props.place, store.selectedPart)
  props.commit()
})
onScopeDispose(() => {
  framing.dispose()
  unregisterCapture?.()
  disposed = true
  generation++
  removeFrame?.()
  projection.off()
  readyListener.off()
  removeListeners?.()
  controller?.dispose()
  stop()
  if (scene.value.environment === environment?.texture) scene.value.environment = null
  if (scene.value.background === background) scene.value.background = null
  if (scene.value.fog === fog) scene.value.fog = null
  environment?.dispose()
})
</script>

<template>
  <WorkbenchLighting :stage="stage" :studio="studio" />
</template>

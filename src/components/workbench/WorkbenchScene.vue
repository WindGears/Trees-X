<script setup lang="ts">
import { computed, nextTick, onMounted, onScopeDispose, shallowRef, watch } from 'vue'
import { useLoop, useTres, useTresContext } from '@tresjs/core'
import {
  PerspectiveCamera,
  Color,
  Fog,
  PMREMGenerator,
  Vector3,
  WebGLRenderer,
  type WebGLRenderTarget,
} from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { createStageController } from '@/lib/workbench/controller'
import { defaultStage } from '@/lib/workbench/presentationV2'
import { useWorkbenchStore } from '@/stores/workbench'

const props = defineProps<{
  active: boolean
  place: (id: string, x: number, y: number, visible: boolean) => void
}>()
const emit = defineEmits<{ restore: [] }>()
const store = useWorkbenchStore()
const { scene, camera, renderer, sizes, invalidate } = useTres()
const context = useTresContext()
const { start, stop, isActive } = useLoop()
const background = new Color('#151c25')
const fog = new Fog(background, 12, 38)
scene.value.background = background
scene.value.fog = fog
const keyPosition = shallowRef(new Vector3()),
  rimPosition = shallowRef(new Vector3()),
  groundPosition = shallowRef(new Vector3())
const stage = computed(() => store.presentation?.stage ?? defaultStage)
watch(
  stage,
  (value) => {
    keyPosition.value = new Vector3().fromArray(value.key.position)
    rimPosition.value = new Vector3().fromArray(value.rim.position)
    groundPosition.value = new Vector3(0, value.groundY, 0)
    background.set(value.background)
    fog.color.copy(background)
    scene.value.environmentIntensity = value.environmentIntensity
    if (renderer instanceof WebGLRenderer) renderer.toneMappingExposure = value.exposure
    invalidate()
  },
  { immediate: true },
)
let controller: ReturnType<typeof createStageController> | undefined
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
  )
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
  () => store.product,
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
  () => controller?.stopCamera(),
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
watch(
  () => [sizes.width.value, sizes.height.value, camera.value] as const,
  ([width, height, current]) => {
    if (!(current instanceof PerspectiveCamera) || !width || !height) return
    // Keep the observation pose. Only fit the projection to the available viewport.
    current.zoom = Math.max(
      0.15,
      Math.min(1, ((height - 250) / height) * 1.25, width / height / 1.4),
    )
    current.setViewOffset(width, height, 0, 28, width, height)
    current.updateProjectionMatrix()
    invalidate()
  },
  { immediate: true, flush: 'post' },
)
const projection = context.renderer.onRender(() => {
  controller?.project(sizes.width.value, sizes.height.value, props.place)
})
onScopeDispose(() => {
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
  <TresGroup name="workbench-lighting">
    <TresAmbientLight :intensity="stage.ambient" />
    <TresDirectionalLight
      :position="keyPosition"
      :intensity="stage.key.intensity"
      :color="stage.key.color"
      cast-shadow
    />
    <TresDirectionalLight
      :position="rimPosition"
      :intensity="stage.rim.intensity"
      :color="stage.rim.color"
    />
    <TresMesh :rotation="[-Math.PI / 2, 0, 0]" :position="groundPosition" receive-shadow>
      <TresPlaneGeometry :args="[200, 200]" />
      <TresMeshStandardMaterial
        :color="stage.ground"
        :roughness="1"
        :metalness="0"
        :env-map-intensity="0.1"
      />
    </TresMesh>
  </TresGroup>
</template>

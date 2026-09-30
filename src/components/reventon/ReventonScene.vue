<script setup lang="ts">
import { nextTick, onMounted, onScopeDispose, shallowRef, watch } from 'vue'
import { useLoop, useTres, useTresContext } from '@tresjs/core'
import {
  EquirectangularReflectionMapping,
  PerspectiveCamera,
  PMREMGenerator,
  WebGLRenderer,
} from 'three'
import type { Group, WebGLRenderTarget } from 'three'
import { loadReventon, setTextureQuality } from '@/lib/reventon/assets'
import type { ReventonAssets } from '@/lib/reventon/assets'
import { createMotionSampler } from '@/lib/reventon/motion'
import { createReventonDirector } from '@/lib/reventon/director'
import type { DirectorState } from '@/lib/reventon/director'
import { createContactShadow } from '@/lib/reventon/contactShadow'

const props = defineProps<{ active: boolean }>()
const emit = defineEmits<{
  ready: [value: { meshes: number; triangles: number }]
  state: [value: DirectorState]
  error: [message: string]
  restore: []
}>()
const { scene, camera, renderer, sizes, invalidate } = useTres()
const { start, stop, onBeforeRender } = useLoop()
const context = useTresContext()
const model = shallowRef<Group | null>(null)
const controller = new AbortController()
let assets: ReventonAssets | undefined
let environment: WebGLRenderTarget | undefined
let director: ReturnType<typeof createReventonDirector> | undefined
let removeContextListeners: (() => void) | undefined
let removeReadyListener: (() => void) | undefined
let contactShadow: ReturnType<typeof createContactShadow> | undefined
onBeforeRender(() => contactShadow?.render())

watch(
  () => props.active,
  (active) => {
    if (active) {
      start()
      invalidate()
    } else {
      director?.pause()
      stop()
    }
  },
  { immediate: true },
)
watch(
  () => sizes.aspectRatio.value,
  () => director?.refresh(),
)

onMounted(async () => {
  if (!(renderer instanceof WebGLRenderer)) {
    emit('error', '当前环境无法启动三维展台。请使用支持 WebGL 2 的桌面浏览器。')
    return
  }
  const canvas = renderer.domElement
  const lost = (event: Event) => {
    event.preventDefault()
    director?.pause()
    stop()
    emit('error', '显卡连接暂时中断，恢复后将重新载入展品。')
  }
  const restored = () => emit('restore')
  canvas.addEventListener('webglcontextlost', lost)
  canvas.addEventListener('webglcontextrestored', restored)
  removeContextListeners = () => {
    canvas.removeEventListener('webglcontextlost', lost)
    canvas.removeEventListener('webglcontextrestored', restored)
  }
  try {
    const loaded = await loadReventon(controller.signal)
    if (controller.signal.aborted) {
      loaded.release()
      return
    }
    assets = loaded
    setTextureQuality(loaded.model, renderer.capabilities.getMaxAnisotropy())
    loaded.environment.mapping = EquirectangularReflectionMapping
    const generator = new PMREMGenerator(renderer)
    try {
      environment = generator.fromEquirectangular(loaded.environment)
    } finally {
      generator.dispose()
    }
    scene.value.environment = environment.texture
    scene.value.environmentIntensity = 1.3
    const instance = camera.value
    if (!(instance instanceof PerspectiveCamera)) throw new Error('展台相机尚未就绪，请重试。')
    model.value = loaded.model
    await nextTick()
    if (controller.signal.aborted) return
    contactShadow = createContactShadow(renderer, scene.value, loaded.model)
    const sample = createMotionSampler(loaded.model, instance, loaded.motion)
    director = createReventonDirector(
      loaded.motion,
      (seconds) => {
        sample(seconds)
        contactShadow?.markDirty()
      },
      invalidate,
      (state) => emit('state', state),
    )
    await nextTick()
    await renderer.compileAsync(scene.value, instance)
    if (controller.signal.aborted) return
    const firstFrame = context.renderer.onRender(() => {
      firstFrame.off()
      if (!controller.signal.aborted)
        emit('ready', { meshes: loaded.meshes, triangles: loaded.triangles })
    })
    removeReadyListener = firstFrame.off
    invalidate()
  } catch (cause) {
    if (!controller.signal.aborted)
      emit('error', cause instanceof Error ? cause.message : '展品加载失败，请重试。')
  }
})
defineExpose({
  toggle: () => props.active && director?.toggle(),
  seek: (seconds: number) => director?.seek(seconds),
})
onScopeDispose(() => {
  controller.abort()
  director?.dispose()
  stop()
  removeContextListeners?.()
  removeReadyListener?.()
  if (scene.value.environment === environment?.texture) scene.value.environment = null
  environment?.dispose()
  contactShadow?.dispose()
  assets?.release()
  model.value = null
})
</script>

<template>
  <primitive v-if="model" :object="model" :dispose="null" />
</template>

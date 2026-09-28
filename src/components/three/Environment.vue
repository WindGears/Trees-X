<script setup lang="ts">
import { onMounted, onScopeDispose, watch } from 'vue'
import { useTres } from '@tresjs/core'
import { PMREMGenerator, Vector3, WebGLRenderer } from 'three'
import type { WebGLRenderTarget } from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { useProductStore } from '@/stores/product'
import SpeakerLighting from './SpeakerLighting.vue'

export type EnvironmentStatus = 'room' | 'loading' | 'hdr' | 'fallback'
const props = defineProps<{ cinematic: boolean }>()
const store = useProductStore()
const emit = defineEmits<{ status: [value: EnvironmentStatus] }>()
const { scene, renderer, invalidate } = useTres()
let roomEnvironment: WebGLRenderTarget | undefined
let hdrEnvironment: WebGLRenderTarget | undefined
let controller: AbortController | undefined
let revision = 0
// Tres resolves nested paths case-sensitively; mapSize must remain one property.
const shadowProps = {
  'shadow-mapSize-width': 2048,
  'shadow-mapSize-height': 2048,
  'shadow-normalBias': 0.035,
  'shadow-radius': 3,
}
const keyPosition = new Vector3(3, 5, 4)
const fillPosition = new Vector3(-4, 1, -2)
const rimPosition = new Vector3(1, 4, -4)

function useRoom(status: EnvironmentStatus = 'room') {
  if (!roomEnvironment) return
  scene.value.environment = roomEnvironment.texture
  scene.value.environmentIntensity = store.stage.environmentIntensity
  emit('status', status)
  invalidate()
}

async function syncEnvironment(cinematic: boolean) {
  const request = ++revision
  controller?.abort()
  controller = undefined
  if (!cinematic) {
    hdrEnvironment?.dispose()
    hdrEnvironment = undefined
    useRoom()
    return
  }
  useRoom('loading')
  const nextController = new AbortController()
  controller = nextController
  try {
    const { HDR_URL, loadHdrTexture } = await import('@/lib/three/environment')
    const source = await loadHdrTexture(HDR_URL, nextController.signal)
    if (request !== revision || nextController.signal.aborted) {
      source.dispose()
      return
    }
    if (!(renderer instanceof WebGLRenderer)) {
      source.dispose()
      return
    }
    const generator = new PMREMGenerator(renderer)
    generator.compileEquirectangularShader()
    const target = generator.fromEquirectangular(source)
    generator.dispose()
    source.dispose()
    if (request !== revision || nextController.signal.aborted) {
      target.dispose()
      return
    }
    hdrEnvironment?.dispose()
    hdrEnvironment = target
    scene.value.environment = target.texture
    scene.value.environmentIntensity = store.stage.environmentIntensity
    emit('status', 'hdr')
    invalidate()
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') return
    if (request === revision) useRoom('fallback')
  }
}

onMounted(() => {
  if (!(renderer instanceof WebGLRenderer)) return
  const room = new RoomEnvironment()
  const generator = new PMREMGenerator(renderer)
  roomEnvironment = generator.fromScene(room, 0.04)
  room.dispose()
  generator.dispose()
  useRoom()
  void syncEnvironment(props.cinematic)
})
watch(() => props.cinematic, syncEnvironment)
watch(
  () => store.stage,
  () => {
    scene.value.environmentIntensity = store.stage.environmentIntensity
    invalidate()
  },
)
onScopeDispose(() => {
  revision += 1
  controller?.abort()
  if (
    scene.value.environment === roomEnvironment?.texture ||
    scene.value.environment === hdrEnvironment?.texture
  )
    scene.value.environment = null
  hdrEnvironment?.dispose()
  roomEnvironment?.dispose()
})
</script>

<template>
  <SpeakerLighting v-if="store.product.id === 'form-01'" />
  <TresAmbientLight :intensity="cinematic ? 0.18 : 0.45" />
  <TresDirectionalLight
    :position="keyPosition"
    :intensity="store.stage.keyIntensity"
    :color="store.stage.keyColor"
    cast-shadow
    v-bind="shadowProps"
    :shadow-camera-left="-5"
    :shadow-camera-right="5"
    :shadow-camera-top="5"
    :shadow-camera-bottom="-5"
    :shadow-bias="-0.0005"
  />
  <TresDirectionalLight
    :position="fillPosition"
    :intensity="store.stage.fillIntensity"
    :color="store.stage.fillColor"
  />
  <TresDirectionalLight
    :position="rimPosition"
    :intensity="store.stage.rimIntensity"
    :color="store.stage.rimColor"
  />
</template>

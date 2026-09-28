<script setup lang="ts">
import { computed, onMounted, onScopeDispose, useTemplateRef } from 'vue'
import { ACESFilmicToneMapping, Euler, SRGBColorSpace, Vector3 } from 'three'
import { TresCanvas } from '@tresjs/core'
import { useTypewriterStore } from '@/stores/typewriter'
import { studyBridge } from '@/lib/typewriter/bridge'
import StudyRig from './StudyRig.vue'
import TypewriterModel from './TypewriterModel.vue'
import TypewriterOverlay from './TypewriterOverlay.vue'

/**
 * 打字机研究宿主：输入路由（左键拖=拆解，右键=旋转，滚轮=拆解，Ctrl+滚轮=缩放）
 * 与暖光/暗色摄影棚灯光。Canvas 唯一，Three 对象生命周期由子组件持有。
 */

defineProps<{ active: boolean }>()
const store = useTypewriterStore()
const host = useTemplateRef('host')
const modelRef = useTemplateRef('model')

const isDark = computed(() => store.theme === 'dark')
const dpr = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 2)

// ---- 输入 ----
let dragScrub = false
let lastX = 0
let downX = 0
let downY = 0
let hoverQueued = false
let hoverEvent: PointerEvent | null = null

function onPointerDown(e: PointerEvent) {
  if (e.button !== 0 || e.shiftKey) return // 右键/Shift 留给 OrbitControls 旋转
  dragScrub = true
  lastX = e.clientX
  downX = e.clientX
  downY = e.clientY
  host.value?.setPointerCapture(e.pointerId)
}

function onPointerMove(e: PointerEvent) {
  if (dragScrub) {
    const dx = e.clientX - lastX
    lastX = e.clientX
    if (dx !== 0) store.setProgress(store.progress + dx * 0.0009)
    return
  }
  if (e.buttons === 0) {
    hoverEvent = e
    if (!hoverQueued) {
      hoverQueued = true
      requestAnimationFrame(() => {
        hoverQueued = false
        if (hoverEvent) modelRef.value?.applyHover(hoverEvent.clientX, hoverEvent.clientY)
      })
    }
  }
}

function onPointerUp(e: PointerEvent) {
  if (!dragScrub) return
  dragScrub = false
  if (Math.hypot(e.clientX - downX, e.clientY - downY) < 6) {
    const id = studyBridge.pick(e.clientX, e.clientY)
    if (id) store.select(id)
  }
}

function onPointerLeave() {
  modelRef.value?.setHover(null)
}

function onWheel(e: WheelEvent) {
  e.preventDefault()
  if (e.ctrlKey || e.metaKey) {
    studyBridge.zoom(e.deltaY > 0 ? 1.12 : 0.89)
    return
  }
  store.setProgress(store.progress + e.deltaY * 0.00062)
}

function preventContext(e: Event) {
  e.preventDefault()
}

function onKeyDown(e: KeyboardEvent) {
  const tag = (e.target as HTMLElement | null)?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA') return
  const k = e.key
  if (k === ' ') {
    store.strike(' ')
    e.preventDefault()
  } else if (k === 'Enter') {
    store.strike('\n')
    e.preventDefault()
  } else if (k === 'ArrowLeft') {
    if (store.selectedId) store.stepSibling(-1)
    else store.setProgress(store.progress - 0.03)
    e.preventDefault()
  } else if (k === 'ArrowRight') {
    if (store.selectedId) store.stepSibling(1)
    else store.setProgress(store.progress + 0.03)
    e.preventDefault()
  } else if (k === 'p' || k === 'P') {
    store.togglePlay()
  } else if (k === 'r' || k === 'R') {
    store.reset()
    studyBridge.resetCamera()
  } else if (k === 't' || k === 'T') {
    store.toggleTheme()
  } else if (k === 'f' || k === 'F') {
    store.goFlat()
  } else if (k === 'Escape') {
    if (store.selectedId) store.select(null)
    else store.browserOpen = false
  } else {
    const ch = k.toUpperCase()
    if (ch.length === 1 && store.spec.strike.has(ch)) store.strike(ch)
  }
}

onMounted(() => {
  const el = host.value!
  el.addEventListener('pointerdown', onPointerDown)
  el.addEventListener('pointermove', onPointerMove)
  el.addEventListener('pointerup', onPointerUp)
  el.addEventListener('pointerleave', onPointerLeave)
  el.addEventListener('wheel', onWheel, { passive: false })
  el.addEventListener('contextmenu', preventContext)
  window.addEventListener('keydown', onKeyDown)
})

onScopeDispose(() => {
  const el = host.value
  el?.removeEventListener('pointerdown', onPointerDown)
  el?.removeEventListener('pointermove', onPointerMove)
  el?.removeEventListener('pointerup', onPointerUp)
  el?.removeEventListener('pointerleave', onPointerLeave)
  el?.removeEventListener('wheel', onWheel)
  el?.removeEventListener('contextmenu', preventContext)
  window.removeEventListener('keydown', onKeyDown)
})

const ambient = computed(() => (isDark.value ? 0.22 : 0.6))
const keyIntensity = computed(() => (isDark.value ? 2.8 : 4.2))
const fillIntensity = computed(() => (isDark.value ? 1.0 : 1.6))
const rimIntensity = computed(() => (isDark.value ? 0.7 : 1.1))
const groundColor = computed(() => (isDark.value ? '#16181d' : '#ece8e0'))

const keyLightPos = new Vector3(3.5, 5.5, 3.8)
const fillLightPos = new Vector3(-3, 3.5, -1.5)
const rimLightPos = new Vector3(-1.5, 3, 4)
const pointLightPos = new Vector3(0, 2.5, 1.2)
const groundPos = new Vector3(0, -0.06, 0)
const groundRot = new Euler(-Math.PI / 2, 0, 0)
</script>

<template>
  <div ref="host" class="study-host" :data-theme="store.theme" :data-mode="store.viewMode">
    <TresCanvas
      alpha
      shadows
      :clear-alpha="0"
      :antialias="true"
      :dpr="dpr"
      render-mode="always"
      :tone-mapping="ACESFilmicToneMapping"
      :output-color-space="SRGBColorSpace"
      :tone-mapping-exposure="1"
      power-preference="high-performance"
    >
      <StudyRig />
      <TresAmbientLight :intensity="ambient" color="#ffe8c8" />
      <TresDirectionalLight
        :position="keyLightPos"
        :intensity="keyIntensity"
        color="#ffe4c0"
        cast-shadow
        shadow-mapSize-width="2048"
        shadow-mapSize-height="2048"
        :shadow-camera-left="-6"
        :shadow-camera-right="6"
        :shadow-camera-top="6"
        :shadow-camera-bottom="-6"
        :shadow-bias="-0.0004"
      />
      <TresDirectionalLight :position="fillLightPos" :intensity="fillIntensity" color="#e8ecf0" />
      <TresDirectionalLight :position="rimLightPos" :intensity="rimIntensity" color="#ffffff" />
      <TresPointLight
        :position="pointLightPos"
        :intensity="isDark ? 0.5 : 0.8"
        color="#ffe8c8"
        :distance="12"
      />
      <TresMesh :position="groundPos" :rotation="groundRot" receive-shadow>
        <TresPlaneGeometry :args="[30, 30]" />
        <TresMeshStandardMaterial :color="groundColor" :roughness="0.94" :metalness="0" />
      </TresMesh>
      <TypewriterModel ref="model" />
    </TresCanvas>
    <TypewriterOverlay />
  </div>
</template>

<style scoped>
.study-host {
  position: relative;
  width: 100%;
  height: 100vh;
  overflow: hidden;
  background: #f2efe8;
  user-select: none;
}
.study-host[data-theme='dark'] {
  background: #0e1014;
}
</style>

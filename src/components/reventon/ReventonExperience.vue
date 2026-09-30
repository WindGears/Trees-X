<script setup lang="ts">
import { computed, ref, useTemplateRef } from 'vue'
import {
  useDocumentVisibility,
  useIntersectionObserver,
  usePreferredReducedMotion,
} from '@vueuse/core'
import { TresCanvas } from '@tresjs/core'
import { ACESFilmicToneMapping, PCFSoftShadowMap, SRGBColorSpace } from 'three'
import { Pause, Play, RotateCcw } from '@lucide/vue'
import { useProductStore } from '@/stores/product'
import ReventonScene from './ReventonScene.vue'
import ReventonStudio from './ReventonStudio.vue'
import type { DirectorState } from '@/lib/reventon/director'
import '@/assets/styles/reventon.css'

const props = defineProps<{ active: boolean }>()
const store = useProductStore()
const host = useTemplateRef('host')
const scene = useTemplateRef('scene')
const visible = ref(true)
const visibility = useDocumentVisibility()
const reducedMotion = usePreferredReducedMotion()
useIntersectionObserver(host, ([entry]) => {
  visible.value = entry?.isIntersecting ?? false
})
const running = computed(() => props.active && visible.value && visibility.value === 'visible')
const state = ref<DirectorState>({ seconds: 0, playing: false })
const status = ref<'loading' | 'ready' | 'error'>('loading')
const error = ref('')
const revision = ref(0)
const identity = ref({ meshes: 0, triangles: 0 })
const duration = 383 / 24
const chapters = [
  { label: '开启', time: 0, pose: 3.2, description: '沿楔形轮廓，观察剪刀门的升起。' },
  { label: '座舱', time: 4, pose: 6, description: '靠近座椅织物、碳纤维与中控细节。' },
  { label: '展开', time: 8, pose: 11.75, description: '观察车门、车轮与后舱盖的相对位置。' },
  { label: '合拢', time: 12.5, pose: duration, description: '部件重新归位，回到完整轮廓。' },
]
const chapter = computed(
  () => [...chapters].reverse().find((item) => state.value.seconds >= item.time) ?? chapters[0]!,
)
const dpr = Math.max(1, window.devicePixelRatio)
function retry() {
  error.value = ''
  status.value = 'loading'
  revision.value++
}
function ready(value: { meshes: number; triangles: number }) {
  identity.value = value
  status.value = 'ready'
}
function failed(message: string) {
  error.value = message
  status.value = 'error'
}
function seek(event: Event) {
  const seconds = Number((event.target as HTMLInputElement).value)
  // Native range End lands on the last 0.01-second tick below the 24 fps endpoint.
  scene.value?.seek(seconds >= duration - 0.01 ? duration : seconds)
}
</script>

<template>
  <div
    ref="host"
    class="reventon-experience"
    :data-chapter="chapter.label"
    :data-status="status"
    :data-meshes="identity.meshes"
    :data-triangles="identity.triangles"
    :data-seconds="state.seconds.toFixed(3)"
  >
    <div class="reventon-canvas">
      <TresCanvas
        clear-color="#dededb"
        :antialias="true"
        :dpr="dpr"
        shadows
        :shadow-map-type="PCFSoftShadowMap"
        render-mode="on-demand"
        :tone-mapping="ACESFilmicToneMapping"
        :tone-mapping-exposure="1"
        :output-color-space="SRGBColorSpace"
        power-preference="high-performance"
        @error="failed('三维展台启动失败，请检查浏览器的图形加速设置。')"
      >
        <ReventonStudio />
        <ReventonScene
          ref="scene"
          :key="revision"
          :active="running"
          @ready="ready"
          @state="state = $event"
          @error="failed"
          @restore="retry"
        />
      </TresCanvas>
    </div>
    <div class="reventon-title">
      <h1 id="showcase-heading">Reventón</h1>
      <p>轮廓之下，结构之间。</p>
    </div>
    <div
      v-if="status !== 'ready'"
      class="reventon-loading"
      :role="status === 'error' ? 'alert' : 'status'"
    >
      <p>{{ status === 'error' ? error : '正在准备车身、材质与光影…' }}</p>
      <div v-if="status === 'error'" class="reventon-recovery">
        <button type="button" @click="retry">重新加载</button>
        <button type="button" @click="store.catalogOpen = true">返回目录</button>
      </div>
    </div>
    <div class="reventon-console">
      <p class="reventon-caption">{{ chapter.description }}</p>
      <nav class="reventon-chapters" aria-label="展示章节">
        <button
          v-for="item in chapters"
          :key="item.label"
          type="button"
          :disabled="status !== 'ready'"
          :aria-current="chapter === item ? 'step' : undefined"
          @click="scene?.seek(item.pose)"
        >
          {{ item.label }}
        </button>
      </nav>
      <div class="reventon-playback">
        <button
          v-if="reducedMotion !== 'reduce'"
          type="button"
          :disabled="status !== 'ready'"
          :aria-label="state.playing ? '暂停演示' : '播放演示'"
          @click="scene?.toggle()"
        >
          <Pause v-if="state.playing" :size="18" /><Play v-else :size="18" />
          <span>{{ state.playing ? '暂停' : '播放演示' }}</span>
        </button>
        <label class="reventon-progress"
          ><span class="sr-only">演示进度</span>
          <input
            type="range"
            min="0"
            :max="duration"
            step="0.01"
            :value="state.seconds"
            :disabled="status !== 'ready'"
            aria-label="演示进度"
            :aria-valuetext="`${chapter.label}，${state.seconds.toFixed(1)} 秒`"
            @input="seek"
          />
        </label>
        <button
          type="button"
          :disabled="status !== 'ready'"
          aria-label="回到开始"
          @click="scene?.seek(0)"
        >
          <RotateCcw :size="17" />
        </button>
      </div>
      <p class="reventon-note">部件分离用于外观观察，不代表真实维修拆解顺序。</p>
    </div>
  </div>
</template>

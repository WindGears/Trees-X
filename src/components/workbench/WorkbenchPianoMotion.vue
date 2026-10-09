<script setup lang="ts">
import { computed } from 'vue'
import { Camera, Pause, Play, RotateCcw } from '@lucide/vue'
import { useWorkbenchStore } from '@/stores/workbench'
import { useMotionSession } from '@/lib/workbench/motionSession'
import type { ProgressAction } from '@/lib/workbench/types'

const props = defineProps<{ action: ProgressAction }>()
const store = useWorkbenchStore(),
  session = useMotionSession()
const status = computed(
  () => session.states.value[props.action.id] ?? { progress: 0, target: 1, playing: false },
)
const chapters = [
  { label: '整机', view: 'perspective', description: '观察外壳、琴盖与键盘组成的完整轮廓。' },
  { label: '剖切', view: 'piano-section', description: '透过剖切布局，查看外壳与内部结构的关系。' },
  { label: '键盘', view: 'piano-keys', description: '查看黑白键的排列，以及键盘在整机中的位置。' },
  {
    label: '击弦机构',
    view: 'piano-action',
    description: '观察键盘与击弦机构之间的部件关系。',
  },
  {
    label: '弦列与铁板',
    view: 'piano-strings',
    description: '查看弦列的走向，以及它们与铁板的相对位置。',
  },
  {
    label: '音板与弦桥',
    view: 'piano-soundboard',
    description: '观察音板与弦桥的形态和连接位置。',
  },
  {
    label: '制音器与踏板',
    view: 'piano-dampers',
    description: '查看制音器、踏板与相关连杆的结构关系。',
  },
  { label: '全部平铺', view: 'knoll', description: '将现有部件平铺，对照各组结构的组成与形态。' },
].map((chapter, index) => ({ ...chapter, value: index / 7 }))
const current = computed(() => chapters[Math.round(status.value.progress * 7)] ?? chapters[0]!)
const target = computed(() => chapters[Math.round(status.value.target * 7)] ?? chapters[0]!)
const view = computed(() =>
  store.presentation?.views.find((entry) => entry.id === current.value.view),
)
const atChapter = computed(() => Math.abs(status.value.progress - current.value.value) < 0.0001)
</script>

<template>
  <section
    class="wb-progress wb-piano-motion"
    :data-motion-id="action.id"
    :aria-label="action.label"
  >
    <h3>{{ action.label }}</h3>
    <p>选择任意一段观察钢琴内部结构，随时暂停并自由靠近。</p>
    <div class="wb-piano-chapters" role="group" aria-label="结构章节">
      <button
        v-for="chapter in chapters"
        :key="chapter.view"
        type="button"
        :disabled="!store.available"
        :aria-pressed="Math.abs(status.progress - chapter.value) < 0.0001"
        @click="store.motion('play', action.id, chapter.value)"
      >
        {{ chapter.label }}
      </button>
    </div>
    <p class="wb-piano-description">
      <strong>{{ current.label }}</strong
      >{{ current.description }}
    </p>
    <p class="wb-progress-state" role="status">
      {{
        status.playing
          ? `正在前往「${target.label}」，可随时暂停。`
          : atChapter
            ? `已停留在「${current.label}」，可自由观察。`
            : '结构已暂停，可自由观察或继续。'
      }}
    </p>
    <div class="wb-progress-buttons">
      <button
        type="button"
        :disabled="!store.available || (!status.playing && status.progress === status.target)"
        @click="store.motion(status.playing ? 'pause' : 'resume', action.id)"
      >
        <Pause v-if="status.playing" :size="15" /><Play v-else :size="15" />{{
          status.playing ? '暂停' : '继续'
        }}
      </button>
      <button type="button" :disabled="!store.available" @click="store.motion('reset', action.id)">
        <RotateCcw :size="15" />复原动作
      </button>
    </div>
    <p class="wb-note">结构变化保留你的观察视角。需要重新对准这一段时，使用章节取景。</p>
    <button
      v-if="view"
      type="button"
      class="wb-piano-view"
      :disabled="!store.available"
      @click="store.view(view.id)"
    >
      <Camera :size="15" />{{ current.label }}取景
    </button>
  </section>
</template>

<style scoped>
.wb-piano-chapters {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin-bottom: 18px;
}
.wb-piano-chapters button {
  justify-content: center;
  padding-inline: 8px;
  line-height: 1.5;
}
.wb-panel .wb-piano-description {
  margin-bottom: 14px;
}
.wb-piano-description strong {
  display: block;
  color: var(--wb-foreground, #f0f4fa);
  font-weight: 500;
  margin-bottom: 4px;
}
.wb-piano-view {
  width: 100%;
}
</style>

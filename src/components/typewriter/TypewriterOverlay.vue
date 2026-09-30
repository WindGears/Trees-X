<script setup lang="ts">
import { computed, onScopeDispose, ref, watch } from 'vue'
import { useTypewriterStore } from '@/stores/typewriter'
import { GROUPS } from '@/lib/typewriter/spec'
import { studyBridge } from '@/lib/typewriter/bridge'

const store = useTypewriterStore()

const phaseLabel = computed(() => {
  if (store.viewMode === 'machine') return '整机'
  if (store.viewMode === 'exploded') return '爆炸分解'
  return '平铺陈列'
})

const filtered = computed(() => store.filteredParts.slice(0, 120))

const hoverInfo = computed(() => {
  if (!store.hoverId) return null
  const part = store.spec.byId.get(store.hoverId)
  if (!part) return null
  return { part, pos: studyBridge.screenPos(part.id) }
})

const sel = computed(() => store.selectedPart)
const selGroup = computed(() => GROUPS.find((g) => g.id === sel.value?.group))

const sliderVal = ref(0)
watch(
  () => store.progress,
  (p) => (sliderVal.value = p),
)
function onSlider(e: Event) {
  store.setProgress(Number((e.target as HTMLInputElement).value))
}

// 打字演示：KIMI
let demoTimer: ReturnType<typeof setInterval> | undefined
onScopeDispose(() => clearInterval(demoTimer))
function typingDemo() {
  if (demoTimer) return
  const word = 'KIMI'
  let i = 0
  store.setProgress(0)
  demoTimer = setInterval(() => {
    if (i >= word.length) {
      clearInterval(demoTimer)
      demoTimer = undefined
      return
    }
    store.strike(word[i++]!)
  }, 420)
}
</script>

<template>
  <div class="tw-overlay" :data-theme="store.theme">
    <!-- 顶部工具条 -->
    <div class="tw-toolbar">
      <span class="tw-title">Kimi Portable · 机械研究</span>
      <span class="tw-count">572 件 · 8 组</span>
      <button type="button" :aria-pressed="store.playing" @click="store.togglePlay()">
        {{ store.playing ? '暂停' : '自动演示' }}
      </button>
      <button type="button" @click="store.reset()">复位整机</button>
      <button type="button" @click="store.goFlat()">平铺陈列</button>
      <button type="button" @click="typingDemo">打字演示</button>
      <button
        type="button"
        :aria-pressed="store.browserOpen"
        @click="store.browserOpen = !store.browserOpen"
      >
        零件浏览
      </button>
      <button type="button" :aria-pressed="store.theme === 'dark'" @click="store.toggleTheme()">
        {{ store.theme === 'dark' ? '亮色摄影棚' : '暗色摄影棚' }}
      </button>
    </div>

    <!-- 进度控制 -->
    <div class="tw-progress">
      <span class="tw-phase">{{ phaseLabel }}</span>
      <input
        type="range"
        min="0"
        max="1"
        step="0.001"
        :value="sliderVal"
        aria-label="拆解进度"
        @input="onSlider"
      />
      <span class="tw-pct">{{ Math.round(store.progress * 100) }}%</span>
    </div>

    <!-- 悬停提示 -->
    <div
      v-if="hoverInfo"
      class="tw-tooltip"
      :style="{ left: `${hoverInfo.pos?.x ?? 0}px`, top: `${hoverInfo.pos?.y ?? 0}px` }"
    >
      <b>{{ hoverInfo.part.name }}</b>
      <span>{{ hoverInfo.part.serial }}</span>
    </div>

    <!-- 零件浏览器 -->
    <aside v-if="store.browserOpen" class="tw-browser">
      <input
        v-model="store.query"
        type="search"
        placeholder="搜索名称 / 编号 / 字符"
        aria-label="搜索零件"
      />
      <div class="tw-groups">
        <button
          type="button"
          :aria-pressed="store.groupFilter === 'all'"
          @click="store.groupFilter = 'all'"
        >
          全部
        </button>
        <button
          v-for="g in GROUPS"
          :key="g.id"
          type="button"
          :aria-pressed="store.groupFilter === g.id"
          @click="store.groupFilter = g.id"
        >
          {{ g.name }}
        </button>
      </div>
      <ul>
        <li
          v-for="p in filtered"
          :key="p.id"
          :class="{ active: p.id === store.selectedId }"
          @mouseenter="store.hover(p.id)"
          @mouseleave="store.hover(null)"
          @click="store.select(p.id)"
        >
          <span>{{ p.name }}</span>
          <code>{{ p.serial }}</code>
        </li>
      </ul>
      <p v-if="store.filteredParts.length > 120" class="tw-more">
        共 {{ store.filteredParts.length }} 件，仅显示前 120
      </p>
    </aside>

    <!-- 检视面板 -->
    <aside v-if="sel" class="tw-inspector">
      <header>
        <div>
          <h2>{{ sel.name }}</h2>
          <span class="tw-serial">{{ sel.serial }}</span>
        </div>
        <button type="button" aria-label="关闭检视" @click="store.select(null)">×</button>
      </header>
      <p class="tw-group">
        <i :style="{ background: selGroup?.tint }"></i>{{ selGroup?.name }}组
        <em v-if="sel.certainty === 'uncertain'">推测重建</em>
        <em v-else>演绎件</em>
      </p>
      <p class="tw-desc">{{ sel.description }}</p>
      <footer>
        <button type="button" @click="store.stepSibling(-1)">← 上一件</button>
        <button type="button" @click="store.stepSibling(1)">下一件 →</button>
      </footer>
    </aside>

    <!-- 快捷键提示 -->
    <div class="tw-help">
      <span>拖动 / 滚轮：拆解</span>
      <span>右键拖拽：旋转</span>
      <span>Ctrl+滚轮：缩放</span>
      <span>A–Z：击发</span>
      <span>P 播放 · R 复位 · T 主题 · F 平铺</span>
    </div>

    <!-- 研究声明 -->
    <p class="tw-disclaimer">
      摄影机械研究：基于常见便携打字机结构的演绎重建，非工厂维修资料；标注「推测重建」的零件缺少直接参照。
    </p>
  </div>
</template>

<style scoped src="@/assets/styles/typewriter-overlay.css"></style>

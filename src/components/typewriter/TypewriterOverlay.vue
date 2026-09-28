<script setup lang="ts">
import { computed, ref, watch } from 'vue'
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
      <input v-model="store.query" type="search" placeholder="搜索名称 / 编号 / 字符" aria-label="搜索零件" />
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

<style scoped>
.tw-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
  font-family: 'Manrope', 'PingFang SC', 'Microsoft YaHei', sans-serif;
}
.tw-overlay > * {
  pointer-events: auto;
}
.tw-toolbar {
  position: absolute;
  top: 88px;
  left: 16px;
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}
.tw-title {
  font-weight: 700;
  font-size: 14px;
  margin-right: 4px;
}
.tw-count {
  font-size: 11px;
  opacity: 0.6;
  margin-right: 8px;
}
.tw-toolbar button {
  font-size: 12px;
  padding: 5px 10px;
  border-radius: 5px;
  border: 1px solid rgba(120, 110, 90, 0.35);
  background: rgba(255, 253, 248, 0.82);
  color: #2b2820;
  cursor: pointer;
}
.tw-overlay[data-theme='dark'] .tw-toolbar button {
  background: rgba(28, 30, 36, 0.85);
  color: #d8d4c8;
  border-color: rgba(150, 150, 160, 0.3);
}
.tw-toolbar button[aria-pressed='true'] {
  background: #b08d4f;
  color: #fff;
  border-color: #b08d4f;
}
.tw-progress {
  position: absolute;
  left: 50%;
  bottom: 20px;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 10px;
  width: min(560px, 70vw);
  padding: 8px 14px;
  border-radius: 8px;
  background: rgba(255, 253, 248, 0.88);
  border: 1px solid rgba(120, 110, 90, 0.3);
}
.tw-overlay[data-theme='dark'] .tw-progress {
  background: rgba(24, 26, 32, 0.88);
  border-color: rgba(150, 150, 160, 0.25);
}
.tw-phase {
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}
.tw-progress input[type='range'] {
  flex: 1;
  accent-color: #b08d4f;
}
.tw-pct {
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  width: 36px;
  text-align: right;
}
.tw-tooltip {
  position: fixed;
  transform: translate(12px, -50%);
  padding: 5px 9px;
  border-radius: 5px;
  background: rgba(24, 22, 18, 0.9);
  color: #f0ead8;
  font-size: 11px;
  pointer-events: none;
  display: flex;
  gap: 8px;
  align-items: baseline;
  z-index: 30;
}
.tw-tooltip code,
.tw-serial {
  font-family: ui-monospace, monospace;
  opacity: 0.75;
}
.tw-browser {
  position: absolute;
  top: 96px;
  right: 14px;
  width: 250px;
  max-height: calc(100vh - 140px);
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border-radius: 8px;
  background: rgba(255, 253, 248, 0.94);
  border: 1px solid rgba(120, 110, 90, 0.3);
  overflow: hidden;
}
.tw-overlay[data-theme='dark'] .tw-browser {
  background: rgba(22, 24, 30, 0.94);
  color: #d8d4c8;
}
.tw-browser input {
  width: 100%;
  font-size: 12px;
  padding: 5px 8px;
  border-radius: 5px;
  border: 1px solid rgba(120, 110, 90, 0.35);
  background: transparent;
  color: inherit;
}
.tw-groups {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.tw-groups button {
  font-size: 11px;
  padding: 3px 7px;
  border-radius: 4px;
  border: 1px solid rgba(120, 110, 90, 0.3);
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.tw-groups button[aria-pressed='true'] {
  background: #b08d4f;
  color: #fff;
  border-color: #b08d4f;
}
.tw-browser ul {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  flex: 1;
}
.tw-browser li {
  display: flex;
  justify-content: space-between;
  gap: 6px;
  font-size: 11px;
  padding: 3px 5px;
  border-radius: 4px;
  cursor: pointer;
}
.tw-browser li:hover,
.tw-browser li.active {
  background: rgba(176, 141, 79, 0.18);
}
.tw-browser li code {
  font-family: ui-monospace, monospace;
  font-size: 10px;
  opacity: 0.6;
}
.tw-more {
  font-size: 10px;
  opacity: 0.55;
  margin: 0;
}
.tw-inspector {
  position: absolute;
  top: 96px;
  left: 16px;
  width: 250px;
  padding: 14px;
  border-radius: 8px;
  background: rgba(255, 253, 248, 0.94);
  border: 1px solid rgba(120, 110, 90, 0.35);
}
.tw-overlay[data-theme='dark'] .tw-inspector {
  background: rgba(22, 24, 30, 0.94);
  color: #d8d4c8;
}
.tw-inspector header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}
.tw-inspector h2 {
  font-size: 16px;
  margin: 0 0 2px;
}
.tw-inspector header button {
  font-size: 18px;
  line-height: 1;
  border: none;
  background: none;
  cursor: pointer;
  color: inherit;
  opacity: 0.6;
}
.tw-group {
  display: flex;
  gap: 6px;
  align-items: center;
  font-size: 11px;
  margin: 8px 0;
}
.tw-group i {
  width: 10px;
  height: 10px;
  border-radius: 3px;
  display: inline-block;
}
.tw-group em {
  font-style: normal;
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(176, 141, 79, 0.2);
  font-size: 10px;
}
.tw-desc {
  font-size: 12px;
  line-height: 1.75;
  margin: 0 0 12px;
}
.tw-inspector footer {
  display: flex;
  gap: 8px;
}
.tw-inspector footer button {
  flex: 1;
  font-size: 11px;
  padding: 5px;
  border-radius: 5px;
  border: 1px solid rgba(120, 110, 90, 0.35);
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.tw-help {
  position: absolute;
  bottom: 20px;
  left: 16px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 10px;
  opacity: 0.55;
}
.tw-disclaimer {
  position: absolute;
  bottom: 20px;
  right: 16px;
  max-width: 300px;
  font-size: 10px;
  line-height: 1.6;
  opacity: 0.55;
  text-align: right;
  margin: 0;
}
</style>

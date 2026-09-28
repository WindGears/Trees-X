import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { typewriterSpec } from '@/lib/typewriter/machine'
import { GROUPS, type GroupId } from '@/lib/typewriter/spec'

/**
 * 打字机机械研究的 UI 状态。
 * 只保存可序列化意图（进度、主题、筛选、选中）；Three 对象不进 store。
 */

export type Theme = 'light' | 'dark'
export type ViewMode = 'machine' | 'exploded' | 'flat'

export const useTypewriterStore = defineStore('typewriter', () => {
  const spec = typewriterSpec()

  // 拆解进度 0..1
  const progress = ref(0)
  const playing = ref(false)
  /** 播放方向：1=向平铺，-1=回整机 */
  const playDirection = ref<1 | -1>(1)
  const theme = ref<Theme>('light')
  /** 选中的零件 id（进入检视） */
  const selectedId = ref<string | null>(null)
  /** 检视前的视图快照（返回时恢复） */
  const savedView = ref<{ progress: number } | null>(null)
  /** 悬停零件 id（tooltip） */
  const hoverId = ref<string | null>(null)
  /** 搜索串与组筛选 */
  const query = ref('')
  const groupFilter = ref<GroupId | 'all'>('all')
  /** 击发演示当前字符（用于高亮） */
  const strikingChar = ref<string | null>(null)
  /** 键盘快捷键提示显隐 */
  const showHelp = ref(false)
  /** 浏览器侧边栏是否展开 */
  const browserOpen = ref(false)

  const viewMode = computed<ViewMode>(() => {
    if (progress.value < 0.225) return 'machine'
    if (progress.value < 0.72) return 'exploded'
    return 'flat'
  })

  const selectedPart = computed(() =>
    selectedId.value ? (spec.byId.get(selectedId.value) ?? null) : null,
  )

  /** 筛选后的零件列表（浏览器面板） */
  const filteredParts = computed(() => {
    const q = query.value.trim().toLowerCase()
    return spec.parts.filter((p) => {
      if (groupFilter.value !== 'all' && p.group !== groupFilter.value) return false
      if (!q) return true
      return (
        p.name.toLowerCase().includes(q) ||
        p.serial.toLowerCase().includes(q) ||
        (p.char ?? '').toLowerCase() === q
      )
    })
  })

  const groupMeta = GROUPS

  function setProgress(v: number) {
    progress.value = Math.min(1, Math.max(0, v))
    if (progress.value !== 1 && playDirection.value === 1) playing.value = false
    if (progress.value !== 0 && playDirection.value === -1) playing.value = false
  }

  function togglePlay() {
    if (playing.value) {
      playing.value = false
      return
    }
    // 到达端点时反向
    if (progress.value >= 1) playDirection.value = -1
    else if (progress.value <= 0) playDirection.value = 1
    playing.value = true
  }

  /** 复位代次：场景层据此清空打字位置等瞬态 */
  const resetCount = ref(0)

  function reset() {
    playing.value = false
    progress.value = 0
    selectedId.value = null
    savedView.value = null
    strikingChar.value = null
    resetCount.value += 1
  }

  function goFlat() {
    playing.value = false
    playDirection.value = 1
    progress.value = 1
  }

  function toggleTheme() {
    theme.value = theme.value === 'light' ? 'dark' : 'light'
  }

  function select(id: string | null) {
    if (id === null) {
      // 返回：恢复视图
      selectedId.value = null
      if (savedView.value) {
        progress.value = savedView.value.progress
        savedView.value = null
      }
      return
    }
    if (!spec.byId.has(id)) return
    if (selectedId.value === null) savedView.value = { progress: progress.value }
    selectedId.value = id
  }

  /** 同组内前后导航 */
  function stepSibling(direction: 1 | -1) {
    if (!selectedId.value) return
    const part = spec.byId.get(selectedId.value)!
    const list = spec.byGroup.get(part.group)!
    const idx = list.findIndex((p) => p.id === part.id)
    const next = list[(idx + direction + list.length) % list.length]!
    selectedId.value = next.id
  }

  function hover(id: string | null) {
    hoverId.value = id
  }

  function strike(char: string) {
    if (char !== ' ' && char !== '\n' && !spec.strike.has(char)) return
    strikingChar.value = char
    // 动画结束后由场景层清除
  }

  function clearStrike() {
    strikingChar.value = null
  }

  return {
    spec,
    progress,
    playing,
    playDirection,
    theme,
    selectedId,
    selectedPart,
    savedView,
    hoverId,
    query,
    groupFilter,
    strikingChar,
    showHelp,
    browserOpen,
    resetCount,
    viewMode,
    filteredParts,
    groupMeta,
    setProgress,
    togglePlay,
    reset,
    goFlat,
    toggleTheme,
    select,
    stepSibling,
    hover,
    strike,
    clearStrike,
  }
})

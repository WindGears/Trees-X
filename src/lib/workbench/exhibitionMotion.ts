import type { ProgressAction } from './types'

interface ExhibitMotionStep {
  value: number
  label: string
  view?: string
  description?: string
}

export const typewriterMotionSteps: ExhibitMotionStep[] = [
  { value: 0, label: '合拢整机', view: 'perspective' },
  { value: 0.6, label: '分层展开', view: 'structure' },
  { value: 1, label: '平铺部件', view: 'knoll' },
]

export const pianoMotionSteps: ExhibitMotionStep[] = [
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

export function exhibitMotionSteps(action: ProgressAction): ExhibitMotionStep[] {
  const program = action.motion.program?.type
  if (program === 'piano-sound-path-v1') return pianoMotionSteps
  if (program === 'typewriter-layout-v1') return typewriterMotionSteps
  const view =
    action.id === 'open-doors'
      ? 'car-cabin'
      : action.id === 'explore-parts'
        ? 'car-structure'
        : undefined
  return [
    { value: 0, label: action.motion.closeLabel, view: 'perspective' },
    { value: 1, label: action.motion.openLabel, view },
  ]
}

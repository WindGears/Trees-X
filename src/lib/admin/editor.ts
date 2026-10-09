import { parseProduct } from '@/lib/workbench/api'
import { localPath } from '@/lib/workbench/validation'
import type { ProductPresentation, Vec3 } from '@/lib/workbench/types'
import type { AdminItem } from './api'

export const editorSections = [
  ['info', '基本信息'],
  ['hotspots', '部件热点'],
  ['finishes', '外观'],
  ['camera', '镜头'],
  ['actions', '动作'],
  ['guide', '导览'],
  ['advanced', '高级配置'],
] as const
export type EditorSection = (typeof editorSections)[number][0]
export interface EditorIssue {
  section: EditorSection
  path: string
  message: string
}
export type EditableList = 'hotspots' | 'finishes' | 'views' | 'guide'
export function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
export function nextId(items: { id: string }[], prefix: string) {
  let n = 1
  while (items.some((item) => item.id === `${prefix}-${n}`)) n++
  return `${prefix}-${n}`
}
export function fieldId(path: string) {
  return 'ad-field-' + path.replace(/[^a-zA-Z0-9_-]/g, '-')
}
export function moveItem<T>(items: T[], index: number, direction: 1 | -1) {
  const destination = index + direction
  if (destination < 0 || destination >= items.length) return
  const [item] = items.splice(index, 1)
  if (item !== undefined) items.splice(destination, 0, item)
}
export function removalReasons(p: ProductPresentation, key: EditableList, id: string): string[] {
  if (key === 'finishes') return p.finishes.length <= 1 ? ['至少保留一种外观。'] : []
  if (key === 'views' && id === 'perspective') return ['全景视角为必需项，不能删除。']
  if (key !== 'hotspots' && key !== 'views') return []
  return p.guide.flatMap((step, index) =>
    (key === 'hotspots' ? step.hotspotId === id : step.view === id)
      ? [`导览第${index + 1}步「${step.title}」正在引用；请先解除引用。`]
      : [],
  )
}
export function applyCameraCapture(
  p: ProductPresentation,
  target: string,
  pose: { position: Vec3; target: Vec3 },
) {
  if (![...pose.position, ...pose.target].every(Number.isFinite))
    throw new Error('取景包含无效坐标。')
  const distance = Math.hypot(...pose.position.map((v, i) => v - pose.target[i]!))
  if (distance < p.camera.minDistance - 0.00001 || distance > p.camera.maxDistance + 0.00001)
    throw new Error('取景超出当前缩放范围，请调整镜头或缩放范围后再试。')
  const viewId =
    target === 'default' ? 'perspective' : target.startsWith('view:') ? target.slice(5) : undefined
  const view = p.views.find((v) => v.id === viewId)
  if (!view) throw new Error('回填目标视角已不存在。')
  view.position = [...pose.position]
  view.target = [...pose.target]
  if (viewId === 'perspective') {
    p.camera.position = [...pose.position]
    p.camera.target = [...pose.target]
  }
}
export function validateEditor(item: AdminItem, p: ProductPresentation): EditorIssue[] {
  const issues: EditorIssue[] = []
  const add = (section: EditorSection, path: string, message: string) =>
    issues.push({ section, path, message })
  const text = (section: EditorSection, path: string, value: string, label: string) => {
    if (!value.trim()) add(section, path, `请填写${label}。`)
  }
  text('info', 'info.name', item.name, '商品名称')
  text('info', 'info.description', item.description, '商品介绍')
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(item.slug))
    add('info', 'info.slug', '商品标识只能使用小写字母、数字及连字符。')
  if (!Number.isInteger(item.sortOrder) || item.sortOrder < 0 || item.sortOrder > 100000)
    add('info', 'info.sortOrder', '排序须为0—100000的整数。')
  if (item.cover?.trim()) {
    try {
      localPath(item.cover.trim())
    } catch {
      add('info', 'info.cover', '封面须使用同源静态路径，不能包含空路径段或上级目录。')
    }
  }
  if (!(p.camera.minDistance > 0)) add('camera', 'camera.minDistance', '最近距离必须大于零。')
  if (!(p.camera.maxDistance > p.camera.minDistance))
    add('camera', 'camera.maxDistance', '最远距离必须大于最近距离。')
  for (const key of ['hotspots', 'finishes', 'views', 'actions', 'guide'] as const) {
    const ids = new Set<string>()
    for (const value of p[key]) {
      if (!value.id.trim() || ids.has(value.id))
        add('advanced', 'advanced', '标识为空或重复，请在高级配置中修正。')
      ids.add(value.id)
    }
  }
  for (const h of p.hotspots) {
    text('hotspots', `hotspots.${h.id}.name`, h.name, '部件名称')
    text('hotspots', `hotspots.${h.id}.description`, h.description, '部件说明')
    text('hotspots', `hotspots.${h.id}.node`, h.node, '绑定节点')
  }
  for (const f of p.finishes) {
    text('finishes', `finishes.${f.id}.name`, f.name, '外观名称')
    if (!/^#[0-9a-fA-F]{6}$/.test(f.color))
      add('finishes', `finishes.${f.id}.color`, '颜色须为六位十六进制，例如#8090A0。')
  }
  for (const v of p.views) text('camera', `views.${v.id}.label`, v.label, '视角名称')
  for (const a of p.actions) {
    text('actions', `actions.${a.id}.label`, a.label, '动作名称')
    if (a.motion) {
      text('actions', `actions.${a.id}.openLabel`, a.motion.openLabel, '展开文字')
      text('actions', `actions.${a.id}.closeLabel`, a.motion.closeLabel, '合拢文字')
      if (!(a.motion.duration > 0))
        add('actions', `actions.${a.id}.duration`, '完整行程必须大于零秒。')
    }
  }
  for (const s of p.guide) {
    text('guide', `guide.${s.id}.title`, s.title, '导览标题')
    text('guide', `guide.${s.id}.description`, s.description, '导览说明')
    for (const [key, list] of [
      ['view', p.views],
      ['hotspotId', p.hotspots],
      ['actionId', p.actions],
    ] as const)
      if (s[key] && !list.some((v) => v.id === s[key]))
        add('guide', `guide.${s.id}.${key}`, '引用内容不存在，请重新选择。')
    if (
      s.progress &&
      (!p.actions.some((a) => a.id === s.progress!.actionId && a.kind === 'progress') ||
        s.progress.value < 0 ||
        s.progress.value > 1)
    )
      add('guide', `guide.${s.id}.progress`, '停留进度须引用进度动作，范围为0—100%。')
  }
  if (!issues.length) {
    try {
      parseProduct({ ...item, cover: item.cover?.trim() || null, presentation: p })
    } catch (e) {
      add('advanced', 'advanced', e instanceof Error ? e.message : '展示配置无效。')
    }
  }
  return issues
}

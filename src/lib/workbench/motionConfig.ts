import { list, number, object, positive, relativePath, string, vector } from './validation'
import type { MotionTrack, ProductPresentation, ProgressAction, ProgressMotion } from './types'

export function progressActions(p: ProductPresentation): ProgressAction[] {
  return p.actions.filter((a): a is ProgressAction => a.kind === 'progress' && Boolean(a.motion))
}
export function parseProgress(value: unknown) {
  const p = object(value),
    progress = number(p.value)
  if (progress < 0 || progress > 1) throw new Error('结构进度必须在 0—1 之间')
  return { actionId: string(p.actionId), value: progress }
}
export function parseMotion(value: unknown): ProgressMotion {
  const p = object(value)
  const timing = {
    duration: positive(p.duration),
    openLabel: string(p.openLabel),
    closeLabel: string(p.closeLabel),
  }
  if (p.program != null) {
    const program = object(p.program)
    if (
      p.tracks != null ||
      (program.type !== 'typewriter-layout-v1' && program.type !== 'piano-sound-path-v1')
    )
      throw new Error('未注册的运动程序或重复绑定')
    return {
      ...timing,
      program: { type: program.type, file: relativePath(program.file) },
    }
  }
  const result = {
    ...timing,
    tracks: list(p.tracks, (value): MotionTrack => {
      const t = object(value)
      if (!Array.isArray(t.range) || t.range.length !== 2) throw new Error('动作区间无效')
      const range: [number, number] = [number(t.range[0]), number(t.range[1])]
      if (range[0] < 0 || range[1] > 1 || range[0] >= range[1]) throw new Error('动作区间无效')
      const base = { node: string(t.node), range }
      if (t.type === 'translate') return { ...base, type: 'translate', offset: vector(t.offset) }
      if (t.type !== 'rotate') throw new Error('未注册的进度轨道')
      const axis = vector(t.axis),
        angle = number(t.angle)
      if (Math.abs(Math.hypot(...axis) - 1) > 0.001 || Math.abs(angle) > Math.PI)
        throw new Error('旋转须使用单位轴，单段角度不超过 180°')
      return { ...base, type: 'rotate', axis, angle }
    }),
  }
  if (!result.tracks.length) throw new Error('进度动作缺少轨道')
  return result
}
export function validateMotionBindings(p: ProductPresentation) {
  const actions = progressActions(p)
  const programs = actions.filter((a) => a.motion.program)
  const strikes = p.actions.filter((a) => a.behavior?.type === 'typewriter-strike')
  const typewriter = p.source.kind === 'glb' && p.source.adapter === 'typewriter-v1'
  const piano = p.source.kind === 'glb' && p.source.adapter === 'piano-v1'
  const programType = typewriter
    ? 'typewriter-layout-v1'
    : piano
      ? 'piano-sound-path-v1'
      : undefined
  if (
    (programs.length || strikes.length || programType) &&
    (!programType ||
      p.version !== 3 ||
      programs.length !== 1 ||
      programs[0]?.motion.program?.type !== programType ||
      programs[0]?.id !== p.structureActionId ||
      actions.length !== 1 ||
      (piano && p.actions.length !== 1) ||
      p.source.kind !== 'glb' ||
      p.source.explode.length ||
      p.actions.some(
        (a) =>
          a.behavior &&
          (!typewriter || a.behavior.type !== 'typewriter-strike' || a.kind !== 'pulse'),
      ))
  )
    throw new Error('运动程序须匹配注册适配器与唯一结构进度，打字机之外不能绑定其他行为')
  if (actions.some((a) => a.id === 'explosion')) throw new Error('进度动作编号使用了保留通道')
  if (
    p.version !== 3 &&
    (actions.length ||
      p.structureActionId ||
      p.hotspots.some((h) => h.anchor) ||
      p.guide.some((s) => s.progress))
  )
    throw new Error('进度动作和局部锚点需要 v3 配置')
  if (
    p.actions.some((a) => (a.kind === 'progress') !== Boolean(a.motion) || (a.motion && a.behavior))
  )
    throw new Error('动作类型与运动配置不一致')
  if (p.structureActionId && (!p.structure || !actions.some((a) => a.id === p.structureActionId)))
    throw new Error('结构动作引用无效')
  for (const step of p.guide)
    if (step.progress && !actions.some((a) => a.id === step.progress?.actionId))
      throw new Error('导览进度动作引用无效')
  const owned = new Set<string>()
  const claim = (node: string, type: string, strict = false) => {
    const key = node + ':' + type
    if (strict && owned.has(key)) throw new Error('部件变换通道被重复控制：' + key)
    owned.add(key)
  }
  for (const a of p.actions) {
    if (a.behavior) claim(a.node, a.behavior.type)
    else if (a.kind !== 'progress' && p.source.kind === 'procedural') {
      if (p.source.key === 'speaker' && a.id === 'turn-knob') claim('knob', 'rotate')
      if (p.source.key === 'car' && a.id === 'open-doors') {
        claim('door-left', 'rotate')
        claim('door-right', 'rotate')
      }
      if (p.source.key === 'typewriter' && a.id === 'press-key') {
        claim('key', 'translate')
        claim('lever', 'rotate')
        claim('carriage', 'translate')
      }
    }
  }
  if (p.source.kind === 'glb' && !p.structureActionId)
    for (const e of p.source.explode) claim(e.node, 'translate')
  if (p.source.kind === 'procedural' && p.structure && !p.structureActionId) {
    const nodes =
      p.source.key === 'speaker'
        ? ['shell', 'front', 'driver', 'knob']
        : p.source.key === 'car'
          ? [
              'body',
              'cabin',
              'door-left',
              'door-right',
              'wheel--1--1.14',
              'wheel--1-1.14',
              'wheel-1--1.14',
              'wheel-1-1.14',
            ]
          : ['shell', 'keys', 'lever', 'carriage']
    for (const node of nodes) claim(node, 'translate')
  }
  for (const a of actions) for (const t of a.motion.tracks ?? []) claim(t.node, t.type, true)
}

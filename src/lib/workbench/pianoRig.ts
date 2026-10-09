import { list, number, object, string, vector } from './validation'
export interface PianoPart {
  id: string
  node: string
  name: string
  layer: string
  section: string[]
  flat: string[]
  restPoint: [number, number, number]
}
export interface PianoRig {
  version: 1
  type: 'piano-sound-path-v1'
  clip: string
  duration: number
  sampleStep: number
  parts: PianoPart[]
  curves: number[][]
  surfaces: { node: string; curves: number[]; line: boolean; castShadow: boolean }[]
}
export function parsePianoRig(value: unknown): PianoRig {
  const p = object(value)
  if (p.version !== 1 || p.type !== 'piano-sound-path-v1' || p.clip !== 'piano-sound-path')
    throw new Error('钢琴动作资源版本无效')
  const duration = number(p.duration),
    sampleStep = number(p.sampleStep)
  if (duration !== 7 || sampleStep !== 0.01) throw new Error('钢琴动作采样无效')
  const parts = list(p.parts, (value) => {
    const item = object(value)
    return {
      id: string(item.id),
      node: string(item.node),
      name: string(item.name),
      layer: string(item.layer),
      section: list(item.section, string),
      flat: list(item.flat, string),
      restPoint: vector(item.restPoint),
    }
  })
  if (
    !parts.length ||
    parts.length > 2000 ||
    new Set(parts.map((p) => p.node)).size !== parts.length ||
    new Set(parts.map((p) => p.id)).size !== parts.length
  )
    throw new Error('钢琴部件编号缺失或重复')
  const curves = list(p.curves, (values) =>
    list(values, (value) => {
      const n = number(value)
      if (n < 0 || n > 1) throw new Error('钢琴透明度超出范围')
      return n
    }),
  )
  if (!curves.length || curves.length > 1000 || curves.some((c) => c.length !== 701))
    throw new Error('钢琴透明度曲线采样不完整')
  const surfaces = list(p.surfaces, (value) => {
    const s = object(value),
      refs = list(s.curves, number)
    if (
      !refs.length ||
      refs.some((i) => !Number.isInteger(i) || !curves[i]) ||
      typeof s.line !== 'boolean' ||
      typeof s.castShadow !== 'boolean'
    )
      throw new Error('钢琴表面曲线引用无效')
    return { node: string(s.node), curves: refs, line: s.line, castShadow: s.castShadow }
  })
  if (
    !surfaces.length ||
    surfaces.length > 20000 ||
    new Set(surfaces.map((s) => s.node)).size !== surfaces.length
  )
    throw new Error('钢琴表面名称重复或缺失')
  const names = new Set(surfaces.map((s) => s.node))
  if (parts.some((p) => [...p.section, ...p.flat].some((n) => !names.has(n))))
    throw new Error('钢琴语义部件引用无效')
  return {
    version: 1,
    type: 'piano-sound-path-v1',
    clip: 'piano-sound-path',
    duration,
    sampleStep,
    parts,
    curves,
    surfaces,
  }
}
export function samplePianoCurve(curve: readonly number[], progress: number) {
  const frame = Math.max(0, Math.min(1, progress)) * 700,
    lower = Math.floor(frame),
    upper = Math.min(700, lower + 1)
  return curve[lower]! + (curve[upper]! - curve[lower]!) * (frame - lower)
}

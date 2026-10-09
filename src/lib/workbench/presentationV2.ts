import type { Action, GlbSource, ProductPresentation, SampleKey, StageConfig } from './types'
import {
  color,
  hash,
  integer,
  list,
  localPath,
  number,
  object,
  positive,
  relativePath,
  string,
  vector,
} from './validation'

export const defaultStage: StageConfig = {
  background: '#151c25',
  ground: '#05080d',
  groundY: -0.04,
  exposure: 1.1,
  environmentIntensity: 0.7,
  ambient: 0.25,
  key: { position: [3, 6, 4], intensity: 3.5, color: '#eef5ff' },
  rim: { position: [-4, 3, -2], intensity: 2, color: '#afbdd4' },
}
function light(value: unknown) {
  const p = object(value)
  return { position: vector(p.position), color: color(p.color), intensity: positive(p.intensity) }
}
export function parseStage(value: unknown): StageConfig {
  const p = object(value)
  return {
    background: color(p.background),
    ground: color(p.ground),
    groundY: number(p.groundY),
    exposure: positive(p.exposure),
    environmentIntensity: positive(p.environmentIntensity),
    ambient: positive(p.ambient),
    key: light(p.key),
    rim: light(p.rim),
    ...(p.environmentFile == null ? {} : { environmentFile: relativePath(p.environmentFile) }),
  }
}
export function parseSource(version: unknown, value: unknown): ProductPresentation['source'] {
  const p = object(value)
  if (version !== 1 && version !== 2 && version !== 3) throw new Error('暂不支持此商品展示版本')
  if (p.kind === 'procedural' && ['speaker', 'typewriter', 'car'].includes(string(p.key)))
    return { kind: 'procedural', key: p.key as SampleKey }
  if (
    version === 1 ||
    p.kind !== 'glb' ||
    !['pbr-v1', 'typewriter-v1', 'piano-v1'].includes(string(p.adapter))
  )
    throw new Error('未注册的商品适配器')
  const b = object(p.bundle),
    t = object(p.transform)
  const result: GlbSource = {
    kind: 'glb',
    adapter: p.adapter as GlbSource['adapter'],
    bundle: {
      manifest: localPath(b.manifest),
      id: string(b.id),
      version: integer(b.version),
      sha256: hash(b.sha256),
    },
    transform: {
      position: vector(t.position),
      rotation: vector(t.rotation),
      scale: positive(t.scale),
    },
    finishMaterials: list(p.finishMaterials, string),
    explode: list(p.explode, (v) => {
      const x = object(v)
      return { node: string(x.node), offset: vector(x.offset) }
    }),
  }
  if (
    new Set(result.finishMaterials).size !== result.finishMaterials.length ||
    new Set(result.explode.map((e) => e.node)).size !== result.explode.length
  )
    throw new Error('资源绑定重复')
  return result
}
export function parseBehavior(value: unknown): Action['behavior'] {
  if (value == null) return undefined
  const p = object(value)
  if (p.type === 'typewriter-strike') {
    const index = number(p.index)
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index > 43 ||
      p.axis != null ||
      (p.amount != null && p.amount !== 0)
    )
      throw new Error('击发按键编号或行为无效')
    return { type: 'typewriter-strike', index }
  }
  const axis = vector(p.axis)
  if (
    !['rotate', 'translate'].includes(string(p.type)) ||
    Math.abs(Math.hypot(...axis) - 1) > 0.001
  )
    throw new Error('动作必须使用已注册行为与单位轴')
  return { type: p.type as 'rotate' | 'translate', axis, amount: number(p.amount) }
}

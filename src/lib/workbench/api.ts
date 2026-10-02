import type {
  Action,
  GuideStep,
  ProductPresentation,
  ProductSummary,
  SampleKey,
  Vec3,
  WorkbenchProduct,
} from './types'

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('商品配置格式不正确')
  return value as Record<string, unknown>
}
function string(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('商品配置缺少文字字段')
  return value
}
function number(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('商品配置包含无效数值')
  return value
}
function vector(value: unknown): Vec3 {
  if (!Array.isArray(value) || value.length !== 3) throw new Error('商品视角配置不正确')
  return [number(value[0]), number(value[1]), number(value[2])]
}
function list<T>(value: unknown, parse: (v: unknown) => T): T[] {
  if (!Array.isArray(value)) throw new Error('商品配置缺少列表')
  return value.map(parse)
}
function unique(items: { id: string }[]) {
  if (new Set(items.map((i) => i.id)).size !== items.length) throw new Error('商品配置存在重复编号')
}
export function parseSummary(value: unknown): ProductSummary {
  const p = object(value)
  return {
    slug: string(p.slug),
    name: string(p.name),
    category: string(p.category),
    description: string(p.description),
  }
}
export function parseProduct(value: unknown): WorkbenchProduct {
  const root = object(value),
    p = object(root.presentation),
    source = object(p.source),
    camera = object(p.camera)
  if (
    p.version !== 1 ||
    source.kind !== 'procedural' ||
    !['speaker', 'typewriter', 'car'].includes(string(source.key))
  )
    throw new Error('暂不支持此商品展示版本')
  const presentation: ProductPresentation = {
    version: 1,
    source: { kind: 'procedural', key: source.key as SampleKey },
    camera: {
      position: vector(camera.position),
      target: vector(camera.target),
      minDistance: number(camera.minDistance),
      maxDistance: number(camera.maxDistance),
    },
    views: list(p.views, (v) => {
      const x = object(v)
      return {
        id: string(x.id),
        label: string(x.label),
        position: vector(x.position),
        target: vector(x.target),
      }
    }),
    hotspots: list(p.hotspots, (v) => {
      const x = object(v)
      return {
        id: string(x.id),
        node: string(x.node),
        name: string(x.name),
        description: string(x.description),
        cameraOffset: vector(x.cameraOffset),
      }
    }),
    finishes: list(p.finishes, (v) => {
      const x = object(v)
      const color = string(x.color)
      if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error('商品配色无效')
      return { id: string(x.id), name: string(x.name), color }
    }),
    actions: list(p.actions, (v) => {
      const x = object(v)
      if (x.kind !== 'toggle' && x.kind !== 'pulse') throw new Error('商品动作无效')
      return {
        id: string(x.id),
        label: string(x.label),
        kind: x.kind,
        node: string(x.node),
      } as Action
    }),
    structure: p.structure === true,
    guide: list(p.guide, (v) => {
      const x = object(v),
        step: GuideStep = {
          id: string(x.id),
          title: string(x.title),
          description: string(x.description),
        }
      for (const k of ['view', 'hotspotId', 'actionId'] as const)
        if (x[k] != null) step[k] = string(x[k])
      for (const k of ['explode', 'overview'] as const)
        if (x[k] != null) {
          if (typeof x[k] !== 'boolean') throw new Error('导览配置无效')
          step[k] = x[k]
        }
      return step
    }),
  }
  const cfg = presentation
  if (
    typeof p.structure !== 'boolean' ||
    !cfg.finishes.length ||
    !cfg.views.some((v) => v.id === 'perspective') ||
    cfg.camera.minDistance <= 0 ||
    cfg.camera.maxDistance <= cfg.camera.minDistance
  )
    throw new Error('商品默认展示配置无效')
  for (const items of [cfg.views, cfg.hotspots, cfg.finishes, cfg.actions, cfg.guide]) unique(items)
  for (const step of cfg.guide) {
    if (
      (step.view && !cfg.views.some((v) => v.id === step.view)) ||
      (step.hotspotId && !cfg.hotspots.some((v) => v.id === step.hotspotId)) ||
      (step.actionId && !cfg.actions.some((v) => v.id === step.actionId)) ||
      (step.explode && !cfg.structure)
    )
      throw new Error('导览引用了不存在的内容')
  }
  return { ...parseSummary(root), presentation }
}
async function request(path: string, signal: AbortSignal): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(path, { signal, headers: { Accept: 'application/json' } })
  } catch (error) {
    if (signal.aborted) throw error
    throw new Error('无法连接商品服务，请检查后端是否启动后重试。', { cause: error })
  }
  if (!response.ok)
    throw new Error(
      response.status === 404
        ? '未找到该商品，请从目录重新选择。'
        : '商品服务暂时不可用，请稍后重试。',
    )
  try {
    return (await response.json()) as unknown
  } catch {
    throw new Error('商品服务返回格式不正确，请检查 API 连接。')
  }
}
export async function getProducts(signal: AbortSignal, q = '', category = '') {
  const query = new URLSearchParams({ q, category })
  return list(await request('/api/v1/products?' + query, signal), parseSummary)
}
export async function getProduct(slug: string, signal: AbortSignal) {
  const product = parseProduct(
    await request('/api/v1/products/' + encodeURIComponent(slug), signal),
  )
  if (product.slug !== slug) throw new Error('商品响应与当前选择不一致')
  return product
}

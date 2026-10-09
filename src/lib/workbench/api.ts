import { object, string, number, vector, list, unique, color, localPath } from './validation'
import { parseSource, parseStage, parseBehavior } from './presentationV2'
import { parseMotion, parseProgress, validateMotionBindings } from './motionConfig'
import type {
  Action,
  GuideStep,
  ProductPresentation,
  ProductSummary,
  WorkbenchProduct,
} from './types'

export function parseSummary(value: unknown): ProductSummary {
  const p = object(value)
  if (p.displayStatus != null && p.displayStatus !== 'prototype' && p.displayStatus !== 'formal')
    throw new Error('商品展示状态无效')
  return {
    ...(p.cover == null ? {} : { cover: localPath(p.cover) }),
    displayStatus: p.displayStatus === 'formal' ? 'formal' : 'prototype',
    slug: string(p.slug),
    name: string(p.name),
    category: string(p.category),
    description: string(p.description),
  }
}
export function parseProduct(value: unknown): WorkbenchProduct {
  const root = object(value),
    p = object(root.presentation),
    source = parseSource(p.version, p.source),
    camera = object(p.camera)
  const format =
    p.version === 1 && source.kind === 'procedural'
      ? { version: 1 as const, source }
      : {
          version: p.version === 3 ? (3 as const) : (2 as const),
          source,
          stage: parseStage(p.stage),
        }
  const presentation: ProductPresentation = {
    ...format,
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
      if (x.marker != null && typeof x.marker !== 'boolean') throw new Error('热点标记状态无效')
      return {
        id: string(x.id),
        node: string(x.node),
        name: string(x.name),
        description: string(x.description),
        cameraOffset: vector(x.cameraOffset),
        ...(x.anchor == null ? {} : { anchor: vector(x.anchor) }),
        ...(x.group == null ? {} : { group: string(x.group) }),
        ...(x.marker == null ? {} : { marker: x.marker === true }),
      }
    }),
    finishes: list(p.finishes, (v) => {
      const x = object(v)
      return { id: string(x.id), name: string(x.name), color: color(x.color) }
    }),
    actions: list(p.actions, (v) => {
      const x = object(v)
      if (x.kind !== 'toggle' && x.kind !== 'pulse' && x.kind !== 'progress')
        throw new Error('商品动作无效')
      return {
        id: string(x.id),
        label: string(x.label),
        kind: x.kind,
        node: string(x.node),
        ...(x.behavior == null ? {} : { behavior: parseBehavior(x.behavior) }),
        ...(x.motion == null ? {} : { motion: parseMotion(x.motion) }),
      } as Action
    }),
    structure: p.structure === true,
    ...(p.structureActionId == null ? {} : { structureActionId: string(p.structureActionId) }),
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
      if (x.progress != null) step.progress = parseProgress(x.progress)
      return step
    }),
  }
  if (source.kind === 'glb') {
    if (
      presentation.actions.some((a) => a.kind !== 'progress' && !a.behavior) ||
      presentation.structure !==
        (source.explode.length > 0 || Boolean(presentation.structureActionId)) ||
      (presentation.structureActionId && source.explode.length > 0)
    )
      throw new Error('GLB 动作或结构绑定不完整')
    if (presentation.finishes.length > 1 && !source.finishMaterials.length)
      throw new Error('GLB 缺少可试色材质')
  } else if (presentation.actions.some((a) => a.behavior) || presentation.stage?.environmentFile)
    throw new Error('样板不能覆盖注册行为或引用包外环境')
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
  validateMotionBindings(cfg)
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
export async function getCategories(signal: AbortSignal) {
  return list(await request('/api/v1/categories', signal), (value) => string(object(value).name))
}
export async function getProduct(slug: string, signal: AbortSignal) {
  const product = parseProduct(
    await request('/api/v1/products/' + encodeURIComponent(slug), signal),
  )
  if (product.slug !== slug) throw new Error('商品响应与当前选择不一致')
  return product
}

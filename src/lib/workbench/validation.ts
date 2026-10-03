import type { Vec3 } from './types'

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('商品配置格式不正确')
  return value as Record<string, unknown>
}
export function string(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('商品配置缺少文字字段')
  return value
}
export function number(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('商品配置包含无效数值')
  return value
}
export function vector(value: unknown): Vec3 {
  if (!Array.isArray(value) || value.length !== 3) throw new Error('商品视角配置不正确')
  return [number(value[0]), number(value[1]), number(value[2])]
}
export function list<T>(value: unknown, parse: (v: unknown) => T): T[] {
  if (!Array.isArray(value)) throw new Error('商品配置缺少列表')
  return value.map(parse)
}
export function unique(items: { id: string }[]) {
  if (new Set(items.map((i) => i.id)).size !== items.length) throw new Error('商品配置存在重复编号')
}
export function color(value: unknown) {
  const text = string(value)
  if (!/^#[0-9a-f]{6}$/i.test(text)) throw new Error('商品配色无效')
  return text
}
export function positive(value: unknown) {
  const result = number(value)
  if (result <= 0) throw new Error('资源数值必须大于零')
  return result
}
export function integer(value: unknown) {
  const result = positive(value)
  if (!Number.isSafeInteger(result)) throw new Error('资源数值必须是正整数')
  return result
}
export function hash(value: unknown) {
  const result = string(value)
  if (!/^[a-f0-9]{64}$/.test(result)) throw new Error('资源校验值无效')
  return result
}
export function relativePath(value: unknown) {
  const result = string(value)
  if (
    !/^[a-zA-Z0-9_.\-/]+$/.test(result) ||
    result.split('/').some((s) => !s || s === '.' || s === '..')
  )
    throw new Error('资源路径必须是包内相对路径')
  return result
}
export function localPath(value: unknown) {
  const result = string(value)
  if (!result.startsWith('/')) throw new Error('资源必须使用同源路径')
  relativePath(result.slice(1))
  return result
}

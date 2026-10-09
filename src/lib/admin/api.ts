import { parseProduct } from '@/lib/workbench/api'
import type { ProductPresentation } from '@/lib/workbench/types'

export interface Category {
  id: number
  name: string
  sortOrder: number
  revision: number
  productCount: number
}
export interface AdminItem {
  slug: string
  name: string
  category: string
  categoryId: number
  description: string
  cover: string | null
  displayStatus: 'prototype' | 'formal'
  sortOrder: number
  listed: boolean
  revision: number
}
export interface AdminDetail {
  item: AdminItem
  presentation: ProductPresentation
}
export interface Edit extends Omit<AdminItem, 'category' | 'listed'> {
  presentation: ProductPresentation
}
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}
const base = '/api/v1/admin'
async function response<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      ...init,
      credentials: 'same-origin',
      headers: { Accept: 'application/json', ...init.headers },
    })
  } catch {
    throw new ApiError('无法连接管理服务，请检查后端并重试。当前输入仍保留。', 0)
  }
  const payload: unknown = res.status === 204 ? null : await res.json().catch(() => null)
  if (!res.ok) {
    const detail =
      payload && typeof payload === 'object' && 'detail' in payload ? payload.detail : null
    if (res.status === 401 || res.status === 403)
      window.dispatchEvent(new Event('trees-admin-expired'))
    throw new ApiError(
      typeof detail === 'string' ? detail : '请求失败，请检查输入后重试。',
      res.status,
    )
  }
  return payload as T
}
async function mutate<T>(path: string, method: string, body?: unknown): Promise<T> {
  const csrf = await response<{ headerName: string; token: string }>(base + '/session/csrf')
  return response<T>(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', [csrf.headerName]: csrf.token },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}
export const adminApi = {
  session: () => response<{ username: string }>(base + '/session'),
  async login(username: string, password: string) {
    const csrf = await response<{ headerName: string; token: string }>(base + '/session/csrf')
    await response(base + '/session/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        [csrf.headerName]: csrf.token,
      },
      body: new URLSearchParams({ username, password }).toString(),
    })
    return this.session()
  },
  logout: () => mutate('/session/logout', 'POST'),
  products: () => response<AdminItem[]>(base + '/products'),
  detail: (slug: string) => response<AdminDetail>(base + '/products/' + encodeURIComponent(slug)),
  save: (edit: Edit, create: boolean) =>
    mutate<AdminDetail>(
      '/products' + (create ? '' : '/' + encodeURIComponent(edit.slug)),
      create ? 'POST' : 'PUT',
      edit,
    ),
  visibility: (item: AdminItem, listed: boolean) =>
    mutate<AdminItem>('/products/' + encodeURIComponent(item.slug) + '/visibility', 'PUT', {
      revision: item.revision,
      listed,
    }),
  async preview(edit: Edit) {
    return parseProduct(await mutate('/products/preview', 'POST', edit))
  },
  categories: () => response<Category[]>(base + '/categories'),
  saveCategory: (category: Pick<Category, 'name' | 'sortOrder' | 'revision'>, id?: number) =>
    mutate<Category>('/categories' + (id ? '/' + id : ''), id ? 'PUT' : 'POST', category),
  deleteCategory: (category: Category) =>
    mutate('/categories/' + category.id + '?revision=' + category.revision, 'DELETE'),
}
export function message(error: unknown) {
  return error instanceof Error ? error.message : '操作失败，请重试。'
}

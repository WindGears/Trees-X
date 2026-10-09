// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from 'vitest'
import { adminApi, ApiError } from './api'
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
test('writes use a fresh session CSRF token and do not automatically retry a failed mutation', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ headerName: 'X-CSRF-TOKEN', token: 'masked' })),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: '内容冲突，当前输入仍保留' }), { status: 409 }),
    )
  vi.stubGlobal('fetch', fetcher)
  await expect(
    adminApi.saveCategory({ name: '分类', sortOrder: 0, revision: 1 }, 4),
  ).rejects.toThrow('内容冲突')
  expect(fetcher).toHaveBeenCalledTimes(2)
  const [path, init] = fetcher.mock.calls[1]!
  expect(path).toBe('/api/v1/admin/categories/4')
  expect(init.headers['X-CSRF-TOKEN']).toBe('masked')
  expect(init.credentials).toBe('same-origin')
})
test('session expiry is visible to the shell and failed connections have a recovery message', async () => {
  const listener = vi.fn()
  window.addEventListener('trees-admin-expired', listener)
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ detail: '请先登录' }), { status: 401 })),
  )
  await expect(adminApi.session()).rejects.toBeInstanceOf(ApiError)
  expect(listener).toHaveBeenCalledOnce()
  window.removeEventListener('trees-admin-expired', listener)
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network')))
  await expect(adminApi.products()).rejects.toThrow('当前输入仍保留')
})

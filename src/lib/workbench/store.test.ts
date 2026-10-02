import { readFileSync } from 'node:fs'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { useWorkbenchStore } from '@/stores/workbench'
import { parseProduct } from './api'
const samples: unknown[] = JSON.parse(
  readFileSync('server/src/main/resources/samples/products.json', 'utf8'),
)
beforeEach(() => setActivePinia(createPinia()))
afterEach(() => vi.unstubAllGlobals())
it('gates controls until the current actual frame, ignores stale responses and resets per-product state', async () => {
  let resolve!: (response: Response) => void
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockImplementationOnce(() => new Promise<Response>((r) => (resolve = r)))
      .mockResolvedValueOnce(new Response(JSON.stringify(samples[2]))),
  )
  const store = useWorkbenchStore(),
    old = store.select('form-01')
  await store.select('reventon')
  resolve(new Response(JSON.stringify(samples[0])))
  await old
  expect(store.product?.slug).toBe('reventon')
  expect(store.available).toBe(false)
  store.ready('form-01', 1)
  store.failed('form-01', 1, 'old failure')
  expect(store.status).toBe('loading')
  store.ready('reventon', 2)
  expect(store.available).toBe(true)
  store.finish('copper')
  store.structure(true)
  store.action('open-doors')
  store.openPanel('appearance')
  store.openPanel('appearance')
  expect(store.finishId).toBe('copper')
  expect(store.exploded).toBe(true)
  store.view()
  expect(store.actions['open-doors']).toBe(1)
  expect(store.exploded).toBe(true)
  store.guide(1)
  expect(store.guideStep).toBe(1)
  store.manual()
  expect(store.guideStep).toBe(-1)
  expect(store.actions['open-doors']).toBe(1)
  store.overview()
  expect(store.finishId).toBe('copper')
  expect(store.exploded).toBe(false)
  store.restore()
  expect(store.finishId).toBe('slate')
  expect(store.actions).toEqual({})
  store.dispose()
})
it('shows API failure without fallback data and recovers through retry', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(new Response(JSON.stringify(samples[0]))),
  )
  const store = useWorkbenchStore()
  await store.select('form-01')
  expect(store.status).toBe('error')
  expect(store.product).toBeNull()
  await store.select('form-01')
  expect(store.product).toEqual(parseProduct(samples[0]))
  expect(store.status).toBe('loading')
})

import { readFileSync } from 'node:fs'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { useWorkbenchStore } from '@/stores/workbench'
import { parseProduct } from './api'
const samples: unknown[] = JSON.parse(
  readFileSync('server/src/main/resources/samples/products.json', 'utf8'),
)
const progressSamples: unknown[] = JSON.parse(
  readFileSync('server/src/main/resources/samples/progress-products.json', 'utf8'),
)
beforeEach(() => setActivePinia(createPinia()))
afterEach(() => vi.unstubAllGlobals())
it('admin preview cancels pending public selection, gates the first frame and retries without public API', async () => {
  let resolve!: (response: Response) => void
  const fetcher = vi.fn().mockImplementation(
    () =>
      new Promise<Response>((r) => {
        resolve = r
      }),
  )
  vi.stubGlobal('fetch', fetcher)
  const store = useWorkbenchStore(),
    old = store.select('form-01')
  const preview = parseProduct(progressSamples[1])
  store.preview(preview)
  const revision = store.revision
  expect(store.product).toEqual(preview)
  expect(store.available).toBe(false)
  store.ready('reventon', revision)
  expect(store.available).toBe(true)
  resolve(new Response(JSON.stringify(samples[0])))
  await old
  expect(store.product?.slug).toBe('reventon')
  store.failed('reventon', revision, 'preview binding')
  await store.retry()
  expect(store.status).toBe('loading')
  expect(store.revision).toBe(revision + 1)
  expect(fetcher).toHaveBeenCalledTimes(1)
  store.dispose()
  expect(store.product).toBeNull()
})
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
it('keeps real API errors in content mode and ignores late scene readiness after fallback', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(new Response(JSON.stringify(samples[0])))
      .mockResolvedValueOnce(new Response(JSON.stringify(samples[2]))),
  )
  const store = useWorkbenchStore()
  store.useContent('WebGL unavailable')
  await store.select('form-01')
  expect(store.status).toBe('error')
  expect(store.product).toBeNull()
  await store.select('form-01')
  expect(store.status).toBe('content')
  expect(store.product?.slug).toBe('form-01')
  store.ready('form-01', 2)
  store.failed('form-01', 2, 'late renderer failure')
  expect(store.status).toBe('content')
  expect(store.available).toBe(false)
  await store.select('reventon')
  expect(store.product?.slug).toBe('reventon')
  expect(store.status).toBe('content')
})
it('keyboard orbit leaves a guide without changing appearance, action or structure', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(samples[0]))))
  const store = useWorkbenchStore()
  await store.select('form-01')
  store.orbit('horizontal', 1)
  expect(store.command.kind).toBe('view')
  store.ready('form-01', 1)
  store.finish(store.presentation!.finishes[1]!.id)
  store.structure(true)
  store.guide(2)
  const finish = store.finishId,
    actions = { ...store.actions },
    exploded = store.exploded
  store.orbit('horizontal', -1)
  expect(store.guideStep).toBe(-1)
  expect(store.command).toMatchObject({ kind: 'orbit', axis: 'horizontal', direction: -1 })
  expect(store.finishId).toBe(finish)
  expect(store.actions).toEqual(actions)
  expect(store.exploded).toBe(exploded)
})
it('keeps live progress out of Pinia and issues bounded v3 commands without legacy structure writers', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(JSON.stringify(progressSamples[0]))),
  )
  const store = useWorkbenchStore()
  await store.select('form-01')
  store.motion('seek', 'explore-layers', 0.437)
  expect(store.motionCommand.revision).toBe(0)
  store.ready('form-01', 1)
  store.structure(true)
  expect(store.exploded).toBe(false)
  expect(store.motionCommand).toMatchObject({ operation: 'play', id: 'explore-layers', value: 1 })
  store.guide(2)
  expect(store.motionCommand).toMatchObject({ operation: 'seek', value: 0.7 })
  store.motion('seek', 'explore-layers', 0.437)
  expect(store.guideStep).toBe(-1)
  const command = { ...store.motionCommand }
  store.view()
  expect(store.motionCommand).toEqual(command)
  store.openPanel('actions')
  store.openPanel('actions')
  expect(store.motionCommand).toEqual(command)
  store.motion('seek', 'explore-layers', 1.1)
  expect(store.motionCommand).toEqual(command)
  expect(store.$state).not.toHaveProperty('progress')
  store.overview()
  expect(store.resetMotionRequest).toBe(1)
})

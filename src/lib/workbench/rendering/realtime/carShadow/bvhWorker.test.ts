import { afterEach, expect, it, vi } from 'vitest'
import { BufferAttribute, BufferGeometry } from 'three'
import { MeshBVH } from 'three-mesh-bvh'
import { buildCarShadowBlas } from './bvhWorker'
import type { CarShadowWorkerGeometry, CarShadowWorkerResponse } from './bvhWorkerProtocol'

class WorkerDouble {
  static last: WorkerDouble
  onmessage: ((event: MessageEvent<CarShadowWorkerResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessageerror: (() => void) | null = null
  terminate = vi.fn()
  sources: CarShadowWorkerGeometry[] = []
  transfers: Transferable[] = []
  constructor() {
    WorkerDouble.last = this
  }
  postMessage(sources: CarShadowWorkerGeometry[], transfers: Transferable[]) {
    this.sources = sources
    this.transfers = transfers
  }
  complete() {
    const results = this.sources.map(({ position, index }) => {
      const geometry = new BufferGeometry()
      geometry.setAttribute('position', new BufferAttribute(position, 3))
      geometry.setIndex(new BufferAttribute(index, 1))
      return {
        position,
        serialized: MeshBVH.serialize(new MeshBVH(geometry, { indirect: true })),
      }
    })
    this.onmessage?.({ data: { ok: true, results } } as MessageEvent<CarShadowWorkerResponse>)
  }
}
afterEach(() => vi.unstubAllGlobals())
function geometry() {
  const geometry = new BufferGeometry()
  geometry.setAttribute(
    'position',
    new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3),
  )
  geometry.setIndex(new BufferAttribute(new Uint32Array([0, 1, 2]), 1))
  return geometry
}

it('settles aborted Worker work immediately, removes all handlers and terminates the Worker', async () => {
  vi.stubGlobal('Worker', WorkerDouble)
  const source = geometry()
  const controller = new AbortController()
  const result = buildCarShadowBlas([source], controller.signal)
  const worker = WorkerDouble.last
  expect(worker.sources).toHaveLength(1)
  expect(worker.transfers).toHaveLength(2)
  controller.abort()
  await expect(result).rejects.toMatchObject({ name: 'AbortError' })
  expect(worker.terminate).toHaveBeenCalledTimes(1)
  expect(worker.onmessage).toBeNull()
  expect(worker.onerror).toBeNull()
  expect(worker.onmessageerror).toBeNull()
  worker.complete()
  expect(source.boundsTree).toBeUndefined()
})

it('restores independent arrays and a BLAS after a complete Worker response', async () => {
  vi.stubGlobal('Worker', WorkerDouble)
  const source = geometry()
  const result = buildCarShadowBlas([source], new AbortController().signal)
  WorkerDouble.last.complete()
  await result
  expect(source.boundsTree).toBeInstanceOf(MeshBVH)
  expect(source.index!.count).toBe(3)
  expect(source.boundingBox?.max.toArray()).toEqual([1, 1, 0])
  expect(WorkerDouble.last.terminate).toHaveBeenCalledTimes(1)
})

it('reports Worker failure and always frees its worker instead of leaving a pending lease', async () => {
  vi.stubGlobal('Worker', WorkerDouble)
  const source = geometry()
  const result = buildCarShadowBlas([source], new AbortController().signal)
  WorkerDouble.last.onerror?.({ message: 'synthetic worker failure' } as ErrorEvent)
  await expect(result).rejects.toThrow('synthetic worker failure')
  expect(WorkerDouble.last.terminate).toHaveBeenCalledTimes(1)
  expect(source.boundsTree).toBeUndefined()
})

it('does not start a Worker for an already aborted signal', async () => {
  const Worker = vi.fn()
  vi.stubGlobal('Worker', Worker)
  const controller = new AbortController()
  controller.abort()
  await expect(buildCarShadowBlas([geometry()], controller.signal)).rejects.toMatchObject({
    name: 'AbortError',
  })
  expect(Worker).not.toHaveBeenCalled()
})

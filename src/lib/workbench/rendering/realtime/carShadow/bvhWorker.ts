import { BufferAttribute, Box3 } from 'three'
import type { BufferGeometry } from 'three'
import { MeshBVH } from 'three-mesh-bvh'
import type { CarShadowWorkerGeometry, CarShadowWorkerResponse } from './bvhWorkerProtocol'

/** One cancellable Worker per owner; a rejected/aborted build always settles its Promise. */
export async function buildCarShadowBlas(
  geometries: BufferGeometry[],
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted()
  const worker = new Worker(new URL('./bvh.worker.ts', import.meta.url), { type: 'module' })
  try {
    const result = await new Promise<CarShadowWorkerResponse>((resolve, reject) => {
      const finish = (callback: () => void) => {
        signal.removeEventListener('abort', abort)
        worker.onmessage = null
        worker.onerror = null
        worker.onmessageerror = null
        callback()
      }
      const abort = () =>
        finish(() => reject(signal.reason ?? new DOMException('Aborted', 'AbortError')))
      signal.addEventListener('abort', abort, { once: true })
      worker.onmessage = (event: MessageEvent<CarShadowWorkerResponse>) =>
        finish(() => resolve(event.data))
      worker.onerror = (event) =>
        finish(() => reject(new Error(`Car key shadow Worker: ${event.message}`)))
      worker.onmessageerror = () =>
        finish(() => reject(new Error('Car key shadow Worker response could not be decoded')))
      try {
        const sources = geometries.map((geometry): CarShadowWorkerGeometry => {
          const position = geometry.getAttribute('position').array
          const index = geometry.index?.array
          if (!(position instanceof Float32Array) || !(index instanceof Uint32Array)) {
            throw new Error('Car key shadow Worker expects cloned Float32 POSITION / Uint32 index')
          }
          return { position, index }
        })
        const transfers = sources.flatMap((source) => [
          source.position.buffer as ArrayBuffer,
          source.index.buffer as ArrayBuffer,
        ])
        worker.postMessage(sources, transfers)
      } catch (error) {
        finish(() => reject(error))
      }
    })
    signal.throwIfAborted()
    if (!result.ok) throw new Error(`Car key shadow BVH build failed: ${result.error}`)
    if (result.results.length !== geometries.length) {
      throw new Error('Car key shadow Worker returned an incomplete geometry set')
    }
    geometries.forEach((geometry, index) => {
      const built = result.results[index]!
      geometry.setAttribute('position', new BufferAttribute(built.position, 3))
      if (!built.serialized.index) throw new Error('Car key shadow Worker omitted index')
      geometry.setIndex(new BufferAttribute(built.serialized.index, 1))
      geometry.boundsTree = MeshBVH.deserialize(built.serialized, geometry, { setIndex: false })
      geometry.boundingBox = geometry.boundsTree.getBoundingBox(new Box3())
    })
  } finally {
    worker.terminate()
  }
}

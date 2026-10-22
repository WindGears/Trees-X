import { BufferAttribute, BufferGeometry } from 'three'
import { MeshBVH, SAH } from 'three-mesh-bvh'
import type {
  CarShadowWorkerGeometry,
  CarShadowWorkerResponse,
  CarShadowWorkerResult,
} from './bvhWorkerProtocol'

// All ArrayBuffers here are independent clones, never the loader's originals.
self.onmessage = (event: MessageEvent<CarShadowWorkerGeometry[]>) => {
  const geometries: BufferGeometry[] = []
  try {
    const results: CarShadowWorkerResult[] = []
    const transfers: ArrayBuffer[] = []
    for (const source of event.data) {
      const geometry = new BufferGeometry()
      geometries.push(geometry)
      geometry.setAttribute('position', new BufferAttribute(source.position, 3))
      geometry.setIndex(new BufferAttribute(source.index, 1))
      const bvh = new MeshBVH(geometry, { strategy: SAH, indirect: true })
      const serialized = MeshBVH.serialize(bvh, { cloneBuffers: false })
      results.push({ position: source.position, serialized })
      transfers.push(source.position.buffer as ArrayBuffer, ...serialized.roots)
      if (serialized.index) transfers.push(serialized.index.buffer as ArrayBuffer)
      if (serialized.indirectBuffer) transfers.push(serialized.indirectBuffer.buffer as ArrayBuffer)
    }
    const response: CarShadowWorkerResponse = { ok: true, results }
    self.postMessage(response, { transfer: [...new Set(transfers)] })
  } catch (error) {
    const response: CarShadowWorkerResponse = {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
    self.postMessage(response)
  } finally {
    geometries.forEach((geometry) => geometry.dispose())
  }
}

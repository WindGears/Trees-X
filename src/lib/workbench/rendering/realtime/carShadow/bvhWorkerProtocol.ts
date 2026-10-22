import type { SerializedBVH } from 'three-mesh-bvh'

export interface CarShadowWorkerGeometry {
  position: Float32Array
  index: Uint32Array
}

export interface CarShadowWorkerResult {
  position: Float32Array
  serialized: SerializedBVH
}

export type CarShadowWorkerResponse =
  { ok: true; results: CarShadowWorkerResult[] } | { ok: false; error: string }

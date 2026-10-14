import type { PerspectiveCamera, TextureNode, WebGPURenderer } from 'three/webgpu'
import { createSignedReflectionSpatial } from './signedSpatial'
import { createSignedReflectionHistory } from './signedHistory'

/** Filter signed SSR correction, never the native Physical environment itself.
 * Misses carry zero, black hits retain -native, unsupported taps are rejected.
 * History advances only after the coordinator's successful complete frame.
 */
export function createReflectionResolve(
  renderer: WebGPURenderer,
  reflection: TextureNode,
  nativeSingle: TextureNode,
  depth: TextureNode,
  normal: TextureNode,
  velocity: TextureNode,
  camera: PerspectiveCamera,
) {
  const spatial = createSignedReflectionSpatial(reflection, nativeSingle, depth, normal, camera)
  let history: ReturnType<typeof createSignedReflectionHistory>
  try {
    history = createSignedReflectionHistory(renderer, camera, spatial.node, depth, normal, velocity)
  } catch (error) {
    spatial.dispose()
    throw error
  }
  let disposed = false
  return {
    raw: spatial.raw.rgb,
    filtered: history.node.rgb,
    prepare: history.prepare,
    commitFrame: history.commitFrame,
    cancelFrame: history.cancelFrame,
    dispose() {
      if (disposed) return
      disposed = true
      history.dispose()
      spatial.dispose()
    },
  }
}

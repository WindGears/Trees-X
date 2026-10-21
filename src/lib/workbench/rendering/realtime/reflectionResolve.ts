import type { PerspectiveCamera, TextureNode, WebGPURenderer } from 'three/webgpu'
import { createSignedReflectionSpatial } from './signedSpatial'
import { createSignedReflectionHistory } from './signedHistory'
import type { ReflectionKernel } from './reflectionSampling'

/** Filter signed SSR correction, never the native Physical environment itself.
 * Misses carry zero, black hits retain -native, unsupported taps are rejected.
 * History advances only after the coordinator's successful complete frame.
 */
export function createReflectionResolve(
  renderer: WebGPURenderer,
  reflection: TextureNode | readonly TextureNode[],
  nativeSingle: TextureNode,
  depth: TextureNode,
  normal: TextureNode,
  velocity: TextureNode,
  camera: PerspectiveCamera,
  kernel: ReflectionKernel = 'rotating',
  varianceHistory = false,
) {
  const spatial = createSignedReflectionSpatial(
    reflection,
    nativeSingle,
    depth,
    normal,
    camera,
    kernel,
  )
  let history: ReturnType<typeof createSignedReflectionHistory>
  try {
    history = createSignedReflectionHistory(
      renderer,
      camera,
      spatial.node,
      depth,
      normal,
      velocity,
      varianceHistory ? { varianceHistory: true, raw: spatial.raw } : {},
    )
  } catch (error) {
    spatial.dispose()
    throw error
  }
  let disposed = false
  return {
    raw: spatial.raw.rgb,
    filtered: history.node.rgb,
    prepare(width: number, height: number) {
      spatial.prepare()
      try {
        history.prepare(width, height)
      } catch (error) {
        spatial.cancelFrame()
        throw error
      }
    },
    commitFrame() {
      try {
        history.commitFrame()
        spatial.commitFrame()
      } catch (error) {
        spatial.cancelFrame()
        throw error
      }
    },
    cancelFrame() {
      history.cancelFrame()
      spatial.cancelFrame()
    },
    resetHistory() {
      if (!disposed) history.resetHistory()
    },
    snapshot: spatial.snapshot,
    historySnapshot: history.snapshot,
    dispose() {
      if (disposed) return
      disposed = true
      history.dispose()
      spatial.dispose()
    },
  }
}

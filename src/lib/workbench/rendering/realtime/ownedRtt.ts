import { HalfFloatType, Material, REVISION } from 'three'
import type { Node } from 'three/webgpu'
import { rtt } from 'three/tsl'

/** r185 RTTNode has no dispose(). Own its target and quad material explicitly. */
export function createOwnedRtt(input: Node, revision = REVISION) {
  if (revision !== '185') throw new Error('RTT ownership must be reviewed for this Three revision')
  // Passing an options object replaces RTTNode's { type: HalfFloatType }
  // default. Explicitly retain signed HDR and SSR's 10000 miss sentinel;
  // RGBA8 silently clamps both radiance and ray length before denoising.
  const node = rtt(input, null, null, { type: HalfFloatType, depthBuffer: false })
  const quad: unknown = Reflect.get(node, '_quadMesh')
  const material: unknown =
    quad && typeof quad === 'object' ? Reflect.get(quad, 'material') : undefined
  const target = node.renderTarget
  if (!(material instanceof Material) || !target) {
    target?.dispose()
    throw new Error('The inspected r185 RTT ownership contract changed')
  }
  let disposed = false
  return {
    node,
    dispose() {
      if (disposed) return
      disposed = true
      target.dispose()
      material.dispose()
      // QuadMesh geometry is a Three module singleton; it is never owned here.
      // Input nodes, loader maps and upstream pass textures are also borrowed.
    },
  }
}

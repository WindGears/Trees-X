import type { Node } from 'three/webgpu'
import { vec4 } from 'three/tsl'
import { bloom } from 'three/addons/tsl/display/BloomNode.js'
import { createOwnedRtt } from '../realtime/ownedRtt'

/** Lens glow only: never included in the lighting probe or DDGI energy. */
export function createShowroomBloom(input: Node) {
  const source = createOwnedRtt(input)
  // Threshold is linear HDR, before the sole output transform. Preserve dark
  // walls and ordinary paint; spread the much brighter softboxes gently.
  const glow = bloom(source.node, 0.06, 0.1, 2.5)
  let disposed = false
  return {
    node: vec4(source.node.rgb.add(glow.rgb), source.node.a),
    dispose() {
      if (disposed) return
      disposed = true
      glow.dispose()
      source.dispose()
    },
  }
}

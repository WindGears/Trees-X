import SSRNode from 'three/addons/tsl/display/SSRNode.js'
import type { Node } from 'three/webgpu'

export interface WorldReflectionRay {
  origin: Node<'vec3'>
  direction: Node<'vec3'>
  normal: Node<'vec3'>
  roughness: Node<'float'>
}

/** Build-time callback: unweighted, linear HDR outgoing radiance + world distance.
 * Alpha zero declines the hit and preserves native fallback. No Three ownership. */
export type WorldReflectionFallback = (ray: WorldReflectionRay) => Node<'vec4'>

export default class SSRWorldNode extends SSRNode {
  worldFallback: WorldReflectionFallback | null
}

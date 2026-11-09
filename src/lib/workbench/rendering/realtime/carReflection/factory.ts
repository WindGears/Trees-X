import { nodeObject } from 'three/tsl'
import type { ssr } from 'three/addons/tsl/display/SSRNode.js'
import SSRWorldNode, { type WorldReflectionFallback } from './vendor/SSRWorldNode.js'

/** Load this module only after world-query preparation succeeds. Each effect
 * owns its native targets; the callback borrows the separate query/material owner.
 * Callback bindings are immutable for a compiled graph; value updates use uniforms.
 */
export function createWorldReflectionFactory(fallback: WorldReflectionFallback): typeof ssr {
  return (color, depth, normal, options) => {
    const effect = new SSRWorldNode(color, depth, normal, options)
    effect.worldFallback = fallback
    return nodeObject(effect)
  }
}

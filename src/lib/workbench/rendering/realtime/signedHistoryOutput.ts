import { HalfFloatType, Material, REVISION } from 'three'
import type { Node } from 'three/webgpu'
import { rtt, texture } from 'three/tsl'

/** Reviewed r185 RTT with two outputs in one fullscreen draw. The second
 * attachment is owned here; it adds eight bytes/pixel, not another pass.
 */
export function createSignedHistoryOutput(expression: Node) {
  if (REVISION !== '185') throw new Error('Signed history MRT requires reviewed Three r185')
  if (Reflect.get(expression, 'isOutputStructNode') !== true)
    throw new Error('Signed history MRT requires a top-level output struct')
  const node = rtt(expression, null, null, {
    type: HalfFloatType,
    depthBuffer: false,
    count: 2,
  })
  const quad: unknown = Reflect.get(node, '_quadMesh'),
    material: unknown =
      quad && typeof quad === 'object' ? Reflect.get(quad, 'material') : undefined,
    target = node.renderTarget
  if (!target) throw new Error('The reviewed signed history MRT target changed')
  const statistics = target.textures[1]
  if (!(material instanceof Material) || !statistics) {
    target.dispose()
    throw new Error('The reviewed signed history MRT contract changed')
  }
  statistics.name = 'TreesX.Reflection.statistics'
  const setup = node.setup
  // r185 wraps the fragment in ContextNode, whose type forwards to the input
  // but whose output-struct marker does not. NodeMaterial/WGSL otherwise emit
  // a single `color` output alongside invalid `output.m0/m1` assignments.
  // Forward only this marker in this owned RTT, retaining its shared context.
  node.setup = function (builder) {
    const result = setup.call(this, builder),
      fragment: unknown = Reflect.get(this, '_rttNode')
    if (
      !fragment ||
      typeof fragment !== 'object' ||
      Reflect.get(fragment, 'isContextNode') !== true ||
      Reflect.get(fragment, 'node') !== expression
    )
      throw new Error('The reviewed signed history MRT fragment context changed')
    Reflect.set(fragment, 'isOutputStructNode', true)
    return result
  }
  let disposed = false
  return {
    node,
    statistics: texture(statistics),
    dispose() {
      if (disposed) return
      disposed = true
      target.dispose()
      material.dispose()
    },
  }
}

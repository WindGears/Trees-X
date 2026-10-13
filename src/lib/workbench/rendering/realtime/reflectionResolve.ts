import { vec4 } from 'three/tsl'
import type { Node, PerspectiveCamera, TextureNode } from 'three/webgpu'
import { temporalReproject } from 'three/addons/tsl/display/TemporalReprojectNode.js'
import { recurrentDenoise } from 'three/addons/tsl/display/RecurrentDenoiseNode.js'
import { createOwnedRtt } from './ownedRtt'

/** Resolve each ray before filtering. Independent color and coverage filters
 * have different luminance-dependent weights and cannot cancel matching IBL.
 * Misses use the exact stable native single-scattering term, never a random HDR
 * sample. One filter owns the complete replacement signal and its history.
 */
export function createReflectionResolve(
  reflection: TextureNode,
  nativeSingle: TextureNode,
  depth: TextureNode,
  normal: TextureNode,
  velocity: TextureNode,
  metalRoughness: Node<'vec2'>,
  camera: PerspectiveCamera,
) {
  // r185 SSR alpha is world ray length; an environment miss writes 10000.
  const hit = reflection.a.greaterThan(0).and(reflection.a.lessThan(9999))
  const radiance = nativeSingle.a
    .greaterThan(0)
    .select(hit.select(reflection.rgb.mul(nativeSingle.a), nativeSingle.rgb), vec4(0).rgb)
  const raw = createOwnedRtt(vec4(radiance, reflection.a))
  const temporal = temporalReproject(raw.node, depth, normal, velocity, camera, {
    mode: 'specular',
    accumulate: false,
  })
  temporal.maxFrames.value = 16
  temporal.clampIntensity.value = 0.35
  const filtered = recurrentDenoise(temporal, camera, {
    depth,
    normal,
    raw: raw.node,
    metalRoughness,
    mode: 'specular',
    accumulate: true,
  })
  filtered.alphaSource = 'raylength'
  filtered.radius.value = 5
  temporal.setHistoryTexture(filtered)
  let disposed = false
  return {
    raw: raw.node.rgb,
    filtered: filtered.rgb,
    dispose() {
      if (disposed) return
      disposed = true
      filtered.dispose()
      temporal.dispose()
      raw.dispose()
    },
  }
}

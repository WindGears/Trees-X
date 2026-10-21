import type { Object3D } from 'three'
import { isAuditedReventonSource } from './reventonCandidate'
import type { GlbSource } from './types'

export type CarStudioQuality = 'studio'

/** Local renderer option, never a presentation/database field. The adapter also
 * requires an actual WebGPU renderer before applying or publishing this flag. */
export function resolveCarStudioQuality(
  source: GlbSource,
  search: string,
): CarStudioQuality | undefined {
  return new URLSearchParams(search).get('carQuality') === 'studio' &&
    isAuditedReventonSource(source)
    ? 'studio'
    : undefined
}

/** Only the generated, audited adapter root owns the capability marker. */
export function isCarStudioScene(scene: Object3D): boolean {
  let enabled = false
  scene.traverse((object) => {
    if (object.userData.adapter === 'reventon-v1' && object.userData.carStudioQuality === 'studio')
      enabled = true
  })
  return enabled
}

/** Frozen once for the same-input SSR/shadow comparisons. These are artistic
 * studio calibrations, not measured automotive material/light properties. */
export const carStudioLighting = Object.freeze({
  key: Object.freeze({
    intensity: 8.5,
    width: 5.5,
    height: 2.6,
    position: [-2.2, 3.8, -2.4] as const,
    target: [0, 0.55, -0.2] as const,
  }),
  strip: Object.freeze({
    intensity: 4.8,
    width: 4.6,
    height: 0.85,
    position: [3.3, 2.1, 1.4] as const,
    target: [0, 0.55, 0] as const,
  }),
})

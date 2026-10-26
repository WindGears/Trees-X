import type { Object3D } from 'three'
import { isCarStudioScene } from '../../carStudioQuality'
import type { RealtimeProductProfile } from './productProfile'

/** Adapter ID alone cannot identify audited-vs-custom car signal capabilities.
 * Rebuild only the local graph on capability handoff, never the host renderer.
 */
export function realtimeSignalIdentity(
  scene: Object3D,
  profile: RealtimeProductProfile,
  search = typeof location === 'undefined' ? '' : location.search,
) {
  if (profile.adapterId !== 'reventon-v1' || !isCarStudioScene(scene)) return profile.adapterId
  const query = new URLSearchParams(search)
  return `reventon-v1:studio:${query.get('carStudioReflections') === '1' ? 1 : 2}${query.get('carAntialias') === 'msaa' ? ':msaa4' : ''}`
}

export type LoungeProjection = 'infinite' | 'box' | 'depth'

/** Read-only experiment selection; scene code additionally requires realtime WebGPU. */
export function resolveLoungeProjection(
  search = typeof window === 'undefined' ? '' : window.location.search,
): LoungeProjection {
  const projection = new URLSearchParams(search).get('loungeSpatial')
  return projection === 'box' || projection === 'depth' ? projection : 'infinite'
}

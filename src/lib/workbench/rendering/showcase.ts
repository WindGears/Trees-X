import { isAuditedReventonSource } from '../reventonCandidate'
import type { ProductPresentation } from '../types'
import { isAuditedTypewriterSource } from '../typewriterCandidate'

const r18 = {
  reventonAsset: 'runtime-v2',
  assetLoading: 'streaming',
  carQuality: 'studio',
  carShowroom: 'cold-studio',
  carFloor: 'cycles',
  carFloorLight: 'local',
  carFloorReflection: 'planar',
  carStudioFinish: 'wrap-wide',
  carStudioPaint: 'silver',
  carStudioTrim: 'satin',
  carCabinLight: 'local',
  carAntialias: 'msaa',
  carKeyShadow: '1',
  indirectLighting: 'ddgi',
} as const

export function showcaseRequested(search = globalThis.location?.search ?? '') {
  return new URLSearchParams(search).get('renderPipeline') === 'showcase'
}

/** Keep the full R18 inputs available for a same-build performance comparison. */
export function r18PerformanceEnabled(search: string) {
  const query = new URLSearchParams(search)
  return (
    query.get('renderPipeline') === 'showcase' &&
    query.get('showcaseLoading') !== 'previous' &&
    query.get('r18Perf') !== 'reference'
  )
}

export function showcaseBayKind(source: ProductPresentation['source'] | undefined) {
  if (source?.kind !== 'glb') return
  const { bundle } = source
  if (isAuditedTypewriterSource(source)) return 'typewriter'
  if (
    source.adapter === 'piano-v1' &&
    bundle.id === 'kimi-piano' &&
    bundle.sha256 === 'fdb2cc50cbee9b677c23aa677553742292f087db19a1d7172b3daab04268df06'
  )
    return 'piano'
}

/** Resolve once per selection. Research URLs and administrator assets keep their own settings. */
export function productRenderSearch(
  source: ProductPresentation['source'] | undefined,
  search = globalThis.location?.search ?? '',
) {
  if (!showcaseRequested(search) || source?.kind !== 'glb') return search
  const query = new URLSearchParams(search)
  if (isAuditedReventonSource(source)) {
    for (const [key, value] of Object.entries(r18)) query.set(key, value)
  } else if (isAuditedTypewriterSource(source)) {
    query.set('typewriterAsset', 'v2')
  }
  return query.toString()
}

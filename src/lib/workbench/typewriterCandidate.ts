import type { GlbSource } from './types'
import bundle from './typewriterV2Bundle.json'
import paintBundle from './typewriterPaintBundle.json'

const originalHash = 'c216ad6101fabe469f7effa061a237fd3f1ad440550cafb10ff5c5f345a770bd'

function isOriginal(source: GlbSource) {
  return source.bundle.version === 1 && source.bundle.sha256 === originalHash
}

function isV2(source: GlbSource) {
  return (
    source.bundle.version === bundle.version &&
    source.bundle.sha256 === bundle.sha256 &&
    source.bundle.manifest === bundle.manifest
  )
}

export function isAuditedTypewriterSource(source: GlbSource) {
  return (
    source.adapter === 'typewriter-v1' &&
    source.bundle.id === bundle.id &&
    (isOriginal(source) || isV2(source))
  )
}

/** Audited local candidates only; administrator bundles and persisted data stay intact. */
export function typewriterCandidate(source: GlbSource, search: string): GlbSource {
  const query = new URLSearchParams(search)
  const asset = query.get('typewriterAsset')
  if (source.adapter !== 'typewriter-v1' || source.bundle.id !== 'kimi-typewriter') return source
  if (asset === 'paint-study')
    return isAuditedTypewriterSource(source) ? { ...source, bundle: { ...paintBundle } } : source
  const useCandidate =
    asset === 'v2' || (asset === null && query.get('renderPipeline') === 'realtime')
  if (!useCandidate || !isOriginal(source)) return source
  return { ...source, bundle: { ...bundle } }
}

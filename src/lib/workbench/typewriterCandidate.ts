import type { GlbSource } from './types'
import bundle from './typewriterV2Bundle.json'

const originalHash = 'c216ad6101fabe469f7effa061a237fd3f1ad440550cafb10ff5c5f345a770bd'

/** Verified v2 assets in the realtime entry; no backend changes or database writes. */
export function typewriterCandidate(source: GlbSource, search: string): GlbSource {
  const query = new URLSearchParams(search)
  const asset = query.get('typewriterAsset')
  const useCandidate =
    asset === 'v2' || (asset === null && query.get('renderPipeline') === 'realtime')
  if (
    !useCandidate ||
    source.adapter !== 'typewriter-v1' ||
    source.bundle.id !== 'kimi-typewriter' ||
    source.bundle.version !== 1 ||
    source.bundle.sha256 !== originalHash
  )
    return source
  return { ...source, bundle: { ...bundle } }
}

import type { GlbSource } from './types'
import bundle from './typewriterV2Bundle.json'

const originalHash = 'c216ad6101fabe469f7effa061a237fd3f1ad440550cafb10ff5c5f345a770bd'

/** Explicit asset-only candidate; no database writes or rendering-backend changes. */
export function typewriterCandidate(source: GlbSource, search: string): GlbSource {
  if (
    new URLSearchParams(search).get('typewriterAsset') !== 'v2' ||
    source.adapter !== 'typewriter-v1' ||
    source.bundle.id !== 'kimi-typewriter' ||
    source.bundle.version !== 1 ||
    source.bundle.sha256 !== originalHash
  )
    return source
  return { ...source, bundle: { ...bundle } }
}

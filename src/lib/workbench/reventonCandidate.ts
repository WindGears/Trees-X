import type { BundleReference, GlbSource } from './types'

// Generated only after the complete immutable candidate passes asset validation.
// A checkout without the local licensed package can still build its normal entry.
const references = import.meta.glob<BundleReference>('./reventonRuntimeBundle.json', {
  eager: true,
  import: 'default',
})
export const reventonRuntimeBundle = references['./reventonRuntimeBundle.json']

export const reventonOriginalBundle: BundleReference = Object.freeze({
  id: 'reventon-workbench',
  version: 1,
  manifest: '/models/reventon/workbench-manifest.json',
  sha256: '28031a60c0e0ce12c6f9e6ba5fdb5ba5b9bf0f17ba0cd8890bba3a46d96f739d',
})

function sameBundle(a: BundleReference, b: BundleReference) {
  return (
    a.id === b.id && a.version === b.version && a.manifest === b.manifest && a.sha256 === b.sha256
  )
}

export function isAuditedReventonSource(source: GlbSource, candidate = reventonRuntimeBundle) {
  return (
    source.adapter === 'reventon-v1' &&
    (sameBundle(source.bundle, reventonOriginalBundle) ||
      Boolean(candidate && sameBundle(source.bundle, candidate)))
  )
}

/** Explicit local candidate only. Never replace administrator/custom resources. */
export function reventonCandidate(
  source: GlbSource,
  search: string,
  candidate: BundleReference | null | undefined = reventonRuntimeBundle,
): GlbSource {
  if (
    new URLSearchParams(search).get('reventonAsset') !== 'runtime-v2' ||
    source.adapter !== 'reventon-v1' ||
    !sameBundle(source.bundle, reventonOriginalBundle)
  )
    return source
  if (!candidate) throw new Error('汽车4K资源包尚未准备完成，请使用原版入口。')
  if (
    candidate.id !== 'reventon-workbench' ||
    candidate.version !== 2 ||
    candidate.manifest !== '/models/reventon-runtime-v2/workbench-manifest.json' ||
    !/^[a-f0-9]{64}$/.test(candidate.sha256)
  )
    throw new Error('汽车4K资源包登记不完整，不能替换原版。')
  return { ...source, bundle: { ...candidate } }
}

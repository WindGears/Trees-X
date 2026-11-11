import type { BundleFile } from './assetBundle'

type CachedTexture = Pick<BundleFile, 'sha256' | 'bytes'>
interface NativeCache {
  version: 1
  bundleSha256: string
  files: Record<string, CachedTexture & { sourceSha256: string }>
}

// The source and its derived texture cache are local and optional at build time.
const registrations = import.meta.glob<NativeCache>('./reventonNativeTextureCache.json', {
  import: 'default',
  eager: true,
})

export function nativeCarTextureCache(source: string) {
  const cache = registrations['./reventonNativeTextureCache.json']
  if (cache?.version !== 1 || cache.bundleSha256 !== source) return undefined
  return (file: BundleFile) => {
    const result = cache.files?.[file.path]
    if (
      file.role !== 'texture' ||
      !/^texture-\d+-(linear|srgb)\.ktx2$/.test(file.path) ||
      result?.sourceSha256 !== file.sha256 ||
      !Number.isSafeInteger(result.bytes) ||
      result.bytes < 1 ||
      !/^[a-f0-9]{64}$/.test(result.sha256)
    )
      return undefined
    return { bytes: result.bytes, sha256: result.sha256, path: `native-bc7/${source}/${file.path}` }
  }
}

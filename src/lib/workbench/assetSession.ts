import {
  fetchBundleBytes,
  readBundleManifest,
  sha256,
  type AssetBundle,
  type LoadPhase,
  loadBundle,
} from './assetBundle'
import { verifiedByteResidency } from './assetResidency'
import { downloadWork } from './decodeQueue'
import type { BundleReference, GlbSource } from './types'
import { isAuditedReventonSource } from './reventonCandidate'

export interface VerifiedFiles {
  read(path: string): Promise<ArrayBuffer>
  /** Relinquishes the session's compressed bytes; a parser may still own decoded/container data. */
  release(path: string): void
  dispose(): void
}
export interface VerifiedAssetSession extends VerifiedFiles {
  bundle: AssetBundle
  signal: AbortSignal
}

export function useStreamingAssets(source: GlbSource, search: string) {
  return (
    new URLSearchParams(search).get('assetLoading') === 'streaming' &&
    isAuditedReventonSource(source)
  )
}

/** Legacy all-package barrier remains the default for comparable migration measurements. */
export async function openLegacyAssetSession(
  ref: BundleReference,
  signal: AbortSignal,
  phase: (p: LoadPhase) => void,
): Promise<VerifiedAssetSession> {
  const { bundle, bytes } = await loadBundle(ref, signal, phase)
  return {
    bundle,
    signal,
    async read(path) {
      signal.throwIfAborted()
      const data = bytes.get(path)
      if (!data) throw new Error('资源包缺少文件：' + path)
      return data
    },
    release: (path) => void bytes.delete(path),
    dispose: () => bytes.clear(),
  }
}

/** Demand-driven verification. Consumers must release before awaiting unrelated dependencies. */
export async function openAssetSession(
  ref: BundleReference,
  signal: AbortSignal,
  phase: (p: LoadPhase) => void,
): Promise<VerifiedAssetSession> {
  const abort = new AbortController()
  const currentSignal = AbortSignal.any([signal, abort.signal])
  const { bundle, base } = await readBundleManifest(ref, currentSignal, phase)
  const files = new Map(bundle.files.map((file) => [file.path, file]))
  interface Entry {
    promise: Promise<ArrayBuffer>
    pending: boolean
    released: boolean
    free?: () => void
  }
  const entries = new Map<string, Entry>(),
    owned = new Set<Entry>()
  let disposed = false
  function free(entry: Entry) {
    entry.released = true
    if (!entry.pending) {
      entry.free?.()
      owned.delete(entry)
    }
  }
  function dispose() {
    if (disposed) return
    disposed = true
    abort.abort()
    currentSignal.removeEventListener('abort', dispose)
    owned.forEach(free)
    entries.clear()
  }
  currentSignal.addEventListener('abort', dispose, { once: true })
  currentSignal.throwIfAborted()
  phase('download')
  return {
    bundle,
    signal: currentSignal,
    read(path) {
      currentSignal.throwIfAborted()
      const existing = entries.get(path)
      if (existing) return existing.promise
      const file = files.get(path)
      if (!file) return Promise.reject(new Error('模型请求了包外资源：' + path))
      const entry: Entry = {
        pending: true,
        released: false,
        promise: Promise.resolve(new ArrayBuffer(0)),
      }
      owned.add(entry)
      entry.promise = (async () => {
        try {
          entry.free = await verifiedByteResidency.reserve(file.bytes, currentSignal)
          currentSignal.throwIfAborted()
          const data = await downloadWork(currentSignal, () =>
            fetchBundleBytes(base + file.path, currentSignal, file.bytes),
          )
          if (data.byteLength !== file.bytes || (await sha256(data)) !== file.sha256)
            throw new Error('资源校验失败：' + path)
          currentSignal.throwIfAborted()
          return data
        } catch (error) {
          entry.released = true
          abort.abort(error)
          throw error
        } finally {
          entry.pending = false
          if (entry.released) free(entry)
        }
      })()
      entries.set(path, entry)
      return entry.promise
    },
    release(path) {
      const entry = entries.get(path)
      if (!entry) return
      entries.delete(path)
      free(entry)
    },
    dispose,
  }
}

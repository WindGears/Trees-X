import type { BundleReference } from './types'
import { hash, integer, list, object, relativePath, string, localPath } from './validation'

export interface BundleFile {
  path: string
  bytes: number
  sha256: string
  role: 'model' | 'texture' | 'environment' | 'motion'
}
export interface AssetBundle {
  schemaVersion: 1
  id: string
  version: number
  entry: string
  files: BundleFile[]
  budget: { maxBytes: number; maxTriangles: number }
  provenance: { author: string; source: string; license: string; redistribution: string }
}
export type LoadPhase = 'manifest' | 'download' | 'parse' | 'materials' | 'first-frame'
export const phaseLabels: Record<LoadPhase | 'config', string> = {
  config: '正在读取商品信息。',
  manifest: '正在核对展示资源。',
  download: '正在读取模型与纹理。',
  parse: '正在准备三维模型。',
  materials: '正在准备材质与光照。',
  'first-frame': '即将进入展示。',
}
export function parseBundle(value: unknown): AssetBundle {
  const p = object(value),
    budget = object(p.budget),
    provenance = object(p.provenance)
  if (p.schemaVersion !== 1) throw new Error('资源包版本不受支持')
  const files = list(p.files, (value): BundleFile => {
    const f = object(value)
    if (!['model', 'texture', 'environment', 'motion'].includes(string(f.role)))
      throw new Error('资源类型无效')
    return {
      path: relativePath(f.path),
      bytes: integer(f.bytes),
      sha256: hash(f.sha256),
      role: f.role as BundleFile['role'],
    }
  })
  const result: AssetBundle = {
    schemaVersion: 1,
    id: string(p.id),
    version: integer(p.version),
    entry: relativePath(p.entry),
    files,
    budget: { maxBytes: integer(budget.maxBytes), maxTriangles: integer(budget.maxTriangles) },
    provenance: {
      author: string(provenance.author),
      source: string(provenance.source),
      license: string(provenance.license),
      redistribution: string(provenance.redistribution),
    },
  }
  if (
    !files.length ||
    files.length > 4096 ||
    new Set(files.map((f) => f.path)).size !== files.length ||
    !files.some((f) => f.path === result.entry && f.role === 'model' && f.path.endsWith('.glb')) ||
    files.reduce((sum, f) => sum + f.bytes, 0) > result.budget.maxBytes
  )
    throw new Error('资源清单或预算不匹配')
  return result
}
export async function sha256(bytes: ArrayBuffer) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')
}
async function fetchBytes(url: string, signal: AbortSignal, maxBytes: number) {
  signal.throwIfAborted()
  const response = await fetch(localPath(url), {
    signal: AbortSignal.any([signal, AbortSignal.timeout(180_000)]),
    redirect: 'error',
  })
  if (!response.ok) throw new Error('资源读取失败，请重新加载。')
  if (Number(response.headers.get('Content-Length')) > maxBytes)
    throw new Error('资源大小超过清单记录')
  const bytes = await response.arrayBuffer()
  signal.throwIfAborted()
  if (bytes.byteLength > maxBytes) throw new Error('资源大小超过清单记录')
  return bytes
}
export async function loadBundle(
  ref: BundleReference,
  signal: AbortSignal,
  phase: (p: LoadPhase) => void,
) {
  phase('manifest')
  const manifest = await fetchBytes(ref.manifest, signal, 2 * 1024 * 1024)
  if ((await sha256(manifest)) !== ref.sha256) throw new Error('资源清单校验失败，请重新加载。')
  const bundle = parseBundle(JSON.parse(new TextDecoder().decode(manifest)) as unknown)
  if (bundle.id !== ref.id || bundle.version !== ref.version)
    throw new Error('资源包与商品配置不一致')
  const base = ref.manifest.slice(0, ref.manifest.lastIndexOf('/') + 1)
  const bytes = new Map<string, ArrayBuffer>()
  phase('download')
  // A small fixed pool bounds in-flight buffers. Nothing is requested outside this manifest.
  let next = 0
  const abort = new AbortController()
  const transferSignal = AbortSignal.any([signal, abort.signal, AbortSignal.timeout(180_000)])
  try {
    await Promise.all(
      Array.from({ length: Math.min(3, bundle.files.length) }, async () => {
        while (next < bundle.files.length) {
          const file = bundle.files[next++]!
          const data = await fetchBytes(base + file.path, transferSignal, file.bytes)
          if (data.byteLength !== file.bytes || (await sha256(data)) !== file.sha256)
            throw new Error('资源校验失败：' + file.path)
          transferSignal.throwIfAborted()
          bytes.set(file.path, data)
        }
      }),
    )
    signal.throwIfAborted()
    return { bundle, bytes }
  } catch (error) {
    abort.abort()
    bytes.clear()
    throw error
  }
}

import { DataTexture, HalfFloatType, RGBAFormat, Texture } from 'three'
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js'

export const HDR_URL = '/textures/studio_small_05_1k.hdr'
export const HDR_BUDGET_BYTES = 2 * 1024 * 1024

export interface DisposableEnvironment {
  readonly texture: Texture
  dispose(): void
}

export class LatestEnvironmentRequest {
  private revision = 0
  begin() {
    this.revision += 1
    return this.revision
  }
  cancel() {
    this.revision += 1
  }
  isCurrent(revision: number) {
    return revision === this.revision
  }
}

export class EnvironmentSlot {
  private current: DisposableEnvironment | undefined
  replace(next: DisposableEnvironment | undefined) {
    if (next === this.current) return
    const previous = this.current
    this.current = next
    previous?.dispose()
  }
  value() {
    return this.current
  }
  dispose() {
    this.replace(undefined)
  }
}

export async function fetchHdrBuffer(
  url: string,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
) {
  if (signal.aborted) throw new DOMException('HDR request aborted', 'AbortError')
  const response = await fetcher(url, { signal, credentials: 'same-origin' })
  if (!response.ok) throw new Error(`HDR 请求失败（${response.status}）`)
  const declaredSize = Number(response.headers.get('content-length') || 0)
  if (declaredSize > HDR_BUDGET_BYTES) throw new Error('HDR 资源超过 2 MB 预算')
  const buffer = await response.arrayBuffer()
  if (signal.aborted) throw new DOMException('HDR request aborted', 'AbortError')
  if (buffer.byteLength > HDR_BUDGET_BYTES) throw new Error('HDR 资源超过 2 MB 预算')
  return buffer
}

export function decodeHdrTexture(buffer: ArrayBuffer) {
  const data = new HDRLoader().setDataType(HalfFloatType).parse(buffer)
  const texture = new DataTexture(data.data, data.width, data.height, RGBAFormat, data.type)
  texture.colorSpace = data.colorSpace ?? texture.colorSpace
  texture.minFilter = data.minFilter ?? texture.minFilter
  texture.magFilter = data.magFilter ?? texture.magFilter
  texture.generateMipmaps = data.generateMipmaps ?? false
  texture.flipY = data.flipY ?? true
  texture.needsUpdate = true
  return texture
}

export async function loadHdrTexture(
  url: string,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
) {
  return decodeHdrTexture(await fetchHdrBuffer(url, signal, fetcher))
}

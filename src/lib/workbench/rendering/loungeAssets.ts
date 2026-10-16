import {
  ClampToEdgeWrapping,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RepeatWrapping,
  SRGBColorSpace,
  Texture,
} from 'three'
import { sha256 } from '../assetBundle'

export type LoungeAssets = {
  panorama: Texture
  baseColor: Texture
  roughness: Texture
  normal: Texture
  dispose(): void
}

type AssetKey = 'panorama' | 'baseColor' | 'roughness' | 'normal'
type AssetRecord = {
  key: AssetKey
  file: string
  bytes: number
  sha256: string
  width: number
  height: number
}
const packId = 'amber-lounge-v1'
const baseUrl = '/studio/amber-lounge/v1/'
// Audited manifest whitelist. No database or fetched manifest can add external URLs.
const records: readonly Readonly<AssetRecord>[] = Object.freeze(
  [
    {
      key: 'panorama',
      file: 'lounge-panorama.png',
      bytes: 1679093,
      sha256: 'fdab4d13b88d04526f6acb4da84334a2dd11d2e6441e0f66e1378713370b5402',
      width: 1774,
      height: 887,
    },
    {
      key: 'baseColor',
      file: 'stone-basecolor.png',
      bytes: 3416536,
      sha256: '5f4fda38955a43e7e6cffe8aa51bca4dafe64241008709d03e5bfc398c22ce82',
      width: 1254,
      height: 1254,
    },
    {
      key: 'roughness',
      file: 'stone-roughness.png',
      bytes: 66034,
      sha256: '0c3150f4371d1ea84143c3d6dc405f62a480d3ed578df2896a78e91774aabc06',
      width: 512,
      height: 512,
    },
    {
      key: 'normal',
      file: 'stone-normal.png',
      bytes: 176399,
      sha256: '39f6f92747dc4f7363951bea0154c6f71af07461cde42c5ad29dcdac9d72c2ba',
      width: 512,
      height: 512,
    },
  ].map((record) => Object.freeze(record as AssetRecord)),
)

/** ImageBitmap decode cannot be cancelled; close a late bitmap without allocating a texture. */
export function decodeBitmap(bytes: ArrayBuffer, signal: AbortSignal): Promise<ImageBitmap> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    let finished = false
    const fail = (error: unknown) => {
      if (finished) return
      finished = true
      signal.removeEventListener('abort', onAbort)
      reject(error)
    }
    const onAbort = () => fail(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
    try {
      void createImageBitmap(new Blob([bytes], { type: 'image/png' }), {
        imageOrientation: 'flipY',
        premultiplyAlpha: 'none',
        colorSpaceConversion: 'none',
      }).then((bitmap) => {
        if (finished || signal.aborted) {
          bitmap.close()
          fail(signal.reason)
          return
        }
        finished = true
        signal.removeEventListener('abort', onAbort)
        resolve(bitmap)
      }, fail)
    } catch (error) {
      fail(error)
    }
  })
}

export function ownTexture(texture: Texture, bitmap: ImageBitmap) {
  let disposed = false
  return {
    texture,
    dispose() {
      if (disposed) return
      disposed = true
      try {
        texture.dispose()
      } finally {
        bitmap.close()
      }
    },
  }
}

async function loadTexture(record: Readonly<AssetRecord>, signal: AbortSignal) {
  signal.throwIfAborted()
  const url = baseUrl + record.file
  const response = await fetch(url, {
    signal,
    mode: 'same-origin',
    credentials: 'same-origin',
    redirect: 'error',
  })
  signal.throwIfAborted()
  if (!response.ok) throw new Error(`暖光舞台资源读取失败：${record.file} (${response.status})`)
  if (Number(response.headers.get('Content-Length')) > record.bytes)
    throw new Error(`暖光舞台资源大小不符：${record.file}`)
  const bytes = await response.arrayBuffer()
  signal.throwIfAborted()
  if (bytes.byteLength !== record.bytes || (await sha256(bytes)) !== record.sha256)
    throw new Error(`暖光舞台资源校验失败：${record.file}`)
  signal.throwIfAborted()
  const bitmap = await decodeBitmap(bytes, signal)
  let texture: Texture | undefined
  try {
    signal.throwIfAborted()
    if (bitmap.width !== record.width || bitmap.height !== record.height)
      throw new Error(`暖光舞台资源尺寸不符：${record.file}`)
    texture = new Texture(bitmap)
    texture.name = `Trees X / ${packId} / ${record.file}`
    texture.flipY = false // The ImageBitmap already contains the requested vertical flip.
    texture.colorSpace =
      record.key === 'panorama' || record.key === 'baseColor' ? SRGBColorSpace : NoColorSpace
    texture.generateMipmaps = true
    texture.minFilter = LinearMipmapLinearFilter
    texture.magFilter = LinearFilter
    texture.wrapS = record.key === 'baseColor' ? ClampToEdgeWrapping : RepeatWrapping
    texture.wrapT =
      record.key === 'panorama' || record.key === 'baseColor' ? ClampToEdgeWrapping : RepeatWrapping
    if (record.key === 'roughness' || record.key === 'normal') texture.repeat.set(8, 8)
    texture.userData.loungeAsset = { packId, ...record, url }
    texture.needsUpdate = true
    return ownTexture(texture, bitmap)
  } catch (error) {
    try {
      texture?.dispose()
    } finally {
      bitmap.close()
    }
    throw error
  }
}

/** The stage owns the returned pack. Abort affects loading, never a previously returned pack. */
export async function loadLoungeAssets(signal: AbortSignal): Promise<LoungeAssets> {
  signal.throwIfAborted()
  const siblings = new AbortController()
  const transferSignal = AbortSignal.any([signal, siblings.signal, AbortSignal.timeout(180_000)])
  const results = await Promise.allSettled(
    records.map(async (record) => {
      try {
        return await loadTexture(record, transferSignal)
      } catch (error) {
        siblings.abort(error)
        throw error
      }
    }),
  )
  const owners = results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []))
  const dispose = () => owners.forEach((owner) => owner.dispose())
  const failure = results.find((result) => result.status === 'rejected')
  if (failure || transferSignal.aborted) {
    dispose()
    if (signal.aborted) signal.throwIfAborted()
    if (failure?.status === 'rejected') throw failure.reason
    transferSignal.throwIfAborted()
  }
  return {
    panorama: owners[0]!.texture,
    baseColor: owners[1]!.texture,
    roughness: owners[2]!.texture,
    normal: owners[3]!.texture,
    dispose,
  }
}

import {
  ClampToEdgeWrapping,
  LinearFilter,
  LinearMipmapLinearFilter,
  SRGBColorSpace,
  Texture,
} from 'three'
import { sha256 } from '../assetBundle'
import { decodeBitmap, ownTexture } from './loungeAssets'

export interface LoungeLayerAssets {
  cleanRoom: Texture
  chair: Texture
  lamp: Texture
  dispose(): void
}

type LayerKey = 'cleanRoom' | 'chair' | 'lamp'
interface LayerRecord {
  key: LayerKey
  file: string
  bytes: number
  sha256: string
  width: number
  height: number
  hasAlpha: boolean
}

const baseUrl = '/studio/amber-lounge/layers-v1/',
  packId = 'amber-lounge-layers-v1'
// Audited copies of the three manifest records. A fetched manifest, database
// value or URL parameter cannot substitute a path or add another resource.
const records = [
  {
    key: 'cleanRoom',
    file: 'clean-room.png',
    bytes: 1717615,
    sha256: 'a9398aad5aeb4e35b7658b8a2ea6aad677b8127ec975db792c567c3754ef925e',
    width: 1774,
    height: 887,
    hasAlpha: false,
  },
  {
    key: 'chair',
    file: 'chair-table.png',
    bytes: 2569845,
    sha256: '7bea5e02b29e29cdcef0272ee0eee4cbe07c967a04f82d623e1a3eefd358fd69',
    width: 1536,
    height: 1024,
    hasAlpha: true,
  },
  {
    key: 'lamp',
    file: 'table-lamp.png',
    bytes: 890314,
    sha256: '0ca571ff6c1db21f8bd7d0c84645f480ff9d09217bb6b09797ae4dd1eae52dfb',
    width: 1280,
    height: 1229,
    hasAlpha: true,
  },
] as const satisfies readonly LayerRecord[]

async function loadTexture(record: Readonly<LayerRecord>, signal: AbortSignal) {
  signal.throwIfAborted()
  const url = baseUrl + record.file,
    response = await fetch(url, {
      signal,
      mode: 'same-origin',
      credentials: 'same-origin',
      redirect: 'error',
    })
  signal.throwIfAborted()
  if (!response.ok) throw new Error(`分层舞台资源读取失败：${record.file} (${response.status})`)
  if (Number(response.headers.get('Content-Length')) > record.bytes)
    throw new Error(`分层舞台资源大小不符：${record.file}`)
  const bytes = await response.arrayBuffer()
  signal.throwIfAborted()
  if (bytes.byteLength !== record.bytes || (await sha256(bytes)) !== record.sha256)
    throw new Error(`分层舞台资源校验失败：${record.file}`)
  signal.throwIfAborted()
  const bitmap = await decodeBitmap(bytes, signal)
  let texture: Texture | undefined
  try {
    signal.throwIfAborted()
    if (bitmap.width !== record.width || bitmap.height !== record.height)
      throw new Error(`分层舞台资源尺寸不符：${record.file}`)
    texture = new Texture(bitmap)
    texture.name = `Trees X / ${packId} / ${record.file}`
    texture.flipY = false
    texture.colorSpace = SRGBColorSpace
    texture.generateMipmaps = true
    texture.minFilter = LinearMipmapLinearFilter
    texture.magFilter = LinearFilter
    texture.wrapS = texture.wrapT = ClampToEdgeWrapping
    texture.userData.loungeLayerAsset = { packId, ...record, url }
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

/** The caller exclusively owns the returned textures/bitmaps. After return,
 * aborting the request does not dispose a pack already attached to the stage.
 */
export async function loadLoungeLayerAssets(signal: AbortSignal): Promise<LoungeLayerAssets> {
  signal.throwIfAborted()
  const siblings = new AbortController(),
    transfer = AbortSignal.any([signal, siblings.signal, AbortSignal.timeout(180_000)]),
    results = await Promise.allSettled(
      records.map(async (record) => {
        try {
          return await loadTexture(record, transfer)
        } catch (error) {
          siblings.abort(error)
          throw error
        }
      }),
    ),
    owners = results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : [])),
    dispose = () => owners.forEach((owner) => owner.dispose()),
    failure = results.find((result) => result.status === 'rejected')
  if (failure || transfer.aborted) {
    dispose()
    if (signal.aborted) signal.throwIfAborted()
    if (failure?.status === 'rejected') throw failure.reason
    transfer.throwIfAborted()
  }
  return {
    cleanRoom: owners[0]!.texture,
    chair: owners[1]!.texture,
    lamp: owners[2]!.texture,
    dispose,
  }
}

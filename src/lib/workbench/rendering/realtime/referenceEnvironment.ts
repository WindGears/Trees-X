import { EquirectangularReflectionMapping } from 'three'
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js'
import type { WebGPURenderer } from 'three/webgpu'
import { ownEnvironmentPmrem } from '../environmentPMREM'
import { sha256 } from '../../assetBundle'
import { realtimeReference } from './reference'

/** The adapter owns the original HDR and its native PMREM, never the renderer. */
export async function createRealtimeReferenceEnvironment(
  renderer: WebGPURenderer,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted()
  const record = realtimeReference.environment
  const response = await fetch(record.url, { signal })
  if (!response.ok) throw new Error('打字机参考光照读取失败，请重试。')
  const bytes = await response.arrayBuffer()
  signal?.throwIfAborted()
  if (bytes.byteLength !== record.bytes || (await sha256(bytes)) !== record.sha256)
    throw new Error('打字机参考光照校验失败，请检查本地资源。')
  signal?.throwIfAborted()
  const texture = new HDRLoader().createDataTexture(bytes)
  texture.name = 'Trees X / Studio Small 05 reference HDR'
  texture.mapping = EquirectangularReflectionMapping
  texture.userData.reference = { ...record }
  try {
    signal?.throwIfAborted()
    return ownEnvironmentPmrem(renderer, texture)
  } catch (error) {
    texture.dispose()
    throw error
  }
}

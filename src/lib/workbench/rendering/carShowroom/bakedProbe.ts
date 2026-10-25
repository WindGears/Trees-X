import {
  DataTexture,
  FloatType,
  HalfFloatType,
  RGBAFormat,
  EquirectangularReflectionMapping,
  LinearSRGBColorSpace,
  LinearFilter,
} from 'three'
import type { WebGPURenderer } from 'three/webgpu'
import { sha256 } from '../../assetBundle'
import { ownEnvironmentPmrem } from '../environmentPMREM'
import type { CarShowroomConfig } from './config'
import { bakedStudioRecords } from './bakedRecords'
import { cyclesStudioRecords } from './cyclesRecords'
import type { createColdStudioProbe } from './probe'

/** Persisted raster capture or offline Cycles radiance, not a surface lightmap.
 * The stage owns this texture and PMREM; no room capture targets are allocated here.
 */
export async function loadBakedStudioProbe(
  renderer: WebGPURenderer,
  config: CarShowroomConfig,
  role: 'specular' | 'indirect',
  signal: AbortSignal,
  kind: 'raster' | 'cycles' = 'raster',
): Promise<Awaited<ReturnType<typeof createColdStudioProbe>>> {
  signal.throwIfAborted()
  const bundle = kind === 'cycles' ? cyclesStudioRecords : bakedStudioRecords
  if (JSON.stringify(config) !== JSON.stringify(bundle.config))
    throw new Error('摄影棚配置已改变，需要重新生成静态反射资源')
  const record = bundle.records.find((item) => item.role === role)
  if (!record) throw new Error('摄影棚静态反射记录缺失')
  const directory = kind === 'cycles' ? 'cycles-r10' : 'baked-r10'
  const response = await fetch('/studio/cold-studio/' + directory + '/' + record.file, {
    signal,
    mode: 'same-origin',
    redirect: 'error',
  })
  if (!response.ok) throw new Error(`静态反射读取失败：${record.file}`)
  const compressed = await response.arrayBuffer()
  signal.throwIfAborted()
  if (compressed.byteLength !== record.bytes || (await sha256(compressed)) !== record.sha256)
    throw new Error(`静态反射摘要不符：${record.file}`)
  // Decompression is bounded by a trusted, hash-verified asset, never an uploaded blob.
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'))
  const raw = await new Response(stream).arrayBuffer()
  signal.throwIfAborted()
  if (raw.byteLength !== record.rawBytes || (await sha256(raw)) !== record.rawSha256)
    throw new Error(`静态反射解码校验失败：${record.file}`)
  signal.throwIfAborted()
  const half = 'dataType' in record && record.dataType === 'float16'
  const texture = new DataTexture(
    half ? new Uint16Array(raw) : new Float32Array(raw),
    record.width,
    record.height,
    RGBAFormat,
    half ? HalfFloatType : FloatType,
  )
  texture.name = `Trees X / ${kind} baked cold studio ${role} r${config.revision}`
  texture.mapping = EquirectangularReflectionMapping
  texture.colorSpace = LinearSRGBColorSpace
  texture.minFilter = texture.magFilter = LinearFilter
  texture.generateMipmaps = false
  texture.flipY = false
  texture.needsUpdate = true
  try {
    const owner = ownEnvironmentPmrem(renderer, texture)
    return {
      texture,
      snapshot: Object.freeze({
        faces: 6 as const,
        role,
        faceResolution: kind === 'cycles' || role === 'specular' ? 1024 : 256,
        width: record.width,
        height: record.height,
        linearHDR: true as const,
        captureVersion: config.revision,
        cpuBytes: raw.byteLength,
        cubeColorBytes: 0,
        conversionColorBytes: 0,
      }),
      dispose: () => owner.dispose(),
    }
  } catch (error) {
    texture.dispose()
    throw error
  }
}

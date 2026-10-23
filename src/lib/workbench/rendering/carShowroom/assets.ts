import {
  Texture,
  RepeatWrapping,
  MirroredRepeatWrapping,
  SRGBColorSpace,
  NoColorSpace,
  LinearMipmapLinearFilter,
} from 'three'
import { sha256 } from '../../assetBundle'
import { showroomAssetRecords } from './assetRecords'

/** One stage owns the six decoded images, borrowed by visible and capture rooms. */
export async function loadShowroomAssets(signal: AbortSignal) {
  const owned: { texture: Texture; bitmap: ImageBitmap }[] = []
  let disposed = false
  const dispose = () => {
    if (disposed) return
    disposed = true
    for (const { texture, bitmap } of owned) {
      texture.dispose()
      bitmap.close()
    }
  }
  try {
    for (const record of showroomAssetRecords) {
      signal.throwIfAborted()
      const response = await fetch('/studio/cold-studio/concept-v2/' + record.file, {
        signal,
        mode: 'same-origin',
        redirect: 'error',
      })
      if (!response.ok) throw new Error(`摄影棚贴图读取失败：${record.file}`)
      const bytes = await response.arrayBuffer()
      signal.throwIfAborted()
      if (bytes.byteLength !== record.bytes || (await sha256(bytes)) !== record.sha256)
        throw new Error(`摄影棚贴图校验失败：${record.file}`)
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }), {
        imageOrientation: 'flipY',
        premultiplyAlpha: 'none',
        colorSpaceConversion: 'none',
      })
      if (signal.aborted || bitmap.width !== record.width || bitmap.height !== record.height) {
        bitmap.close()
        signal.throwIfAborted()
        throw new Error('摄影棚贴图尺寸不符')
      }
      const texture = new Texture(bitmap)
      owned.push({ texture, bitmap })
      texture.name = `Cold studio / ${record.file}`
      texture.flipY = false
      texture.colorSpace = record.channel === 'basecolor' ? SRGBColorSpace : NoColorSpace
      // The generated albedo is not a measured seamless scan. Mirror its edge
      // samples so long walls do not acquire a hard horizontal repeat seam.
      // Periodic technical maps keep RepeatWrapping and their tangent signs.
      texture.wrapS = texture.wrapT =
        record.role === 'wall' && record.channel === 'basecolor'
          ? MirroredRepeatWrapping
          : RepeatWrapping
      texture.generateMipmaps = true
      texture.minFilter = LinearMipmapLinearFilter
      texture.anisotropy = 8
      texture.needsUpdate = true
    }
    return {
      floor: {
        map: owned[0]!.texture,
        normalMap: owned[1]!.texture,
        roughnessMap: owned[2]!.texture,
      },
      wall: {
        map: owned[3]!.texture,
        normalMap: owned[4]!.texture,
        roughnessMap: owned[5]!.texture,
      },
      dispose,
    }
  } catch (error) {
    dispose()
    throw error
  }
}

import { Mesh, Source, Texture, type Object3D } from 'three'
import type { VerifiedFiles } from '../../../assetSession'

interface TraceImage {
  source: Source<ImageBitmap>
  path: string
  views: Map<Texture, Texture>
}
const traceImages = new WeakMap<Source<unknown>, TraceImage>()
const maximumTraceImageSize = 256

export interface CompressedTraceTextureOwner {
  dispose(): void
}

export function isCompressedTraceTexture(texture: Texture | null | undefined): boolean {
  return (
    texture !== null &&
    texture !== undefined &&
    Reflect.get(texture, 'isCompressedTexture') === true
  )
}

/** Only the CPU tracing proxy may borrow these views. Never bind them to a
 * rendered mesh: the original compressed textures remain the raster inputs.
 */
export function resolveCompressedTraceTexture(texture: Texture): Texture
export function resolveCompressedTraceTexture(texture: null): null
export function resolveCompressedTraceTexture(texture: undefined): undefined
export function resolveCompressedTraceTexture(
  texture: Texture | null | undefined,
): Texture | null | undefined
export function resolveCompressedTraceTexture(
  texture: Texture | null | undefined,
): Texture | null | undefined {
  if (!isCompressedTraceTexture(texture)) return texture
  const original = texture as Texture,
    image = traceImages.get(original.source)
  if (!image)
    throw new Error('DDGI 压缩纹理缺少已登记的 CPU 追踪副本：' + (original.name || original.uuid))
  if (original.userData.treesTraceImage !== image.path)
    throw new Error('DDGI 压缩纹理的 CPU 追踪副本标记不一致')
  let view = image.views.get(original)
  if (!view) {
    view = new Texture()
    view.source = image.source
    view.userData = { ...original.userData }
    view.generateMipmaps = false
    image.views.set(original, view)
  }
  // Copy sampling configuration explicitly. Texture.copy() shares source and
  // sets needsUpdate, which would mutate the original compressed Source.
  view.name = original.name
  view.mapping = original.mapping
  view.channel = original.channel
  view.wrapS = original.wrapS
  view.wrapT = original.wrapT
  view.magFilter = original.magFilter
  view.minFilter = original.minFilter
  view.anisotropy = original.anisotropy
  view.offset.copy(original.offset)
  view.repeat.copy(original.repeat)
  view.center.copy(original.center)
  view.rotation = original.rotation
  view.matrixAutoUpdate = original.matrixAutoUpdate
  view.matrix.copy(original.matrix)
  view.premultiplyAlpha = original.premultiplyAlpha
  view.flipY = original.flipY
  view.unpackAlignment = original.unpackAlignment
  view.colorSpace = original.colorSpace
  return view
}

/** Source-owned, verified 256px PNGs feed Speedball 0.8.0's CPU atlas reader.
 * Their owner is separate from the loader's GPU textures and ImageBitmaps.
 * Decoding is serial and cancellation also closes a decoder's late result.
 * Successful preparation transfers ownership out of the download session;
 * its later abort/disposal cannot close images still borrowed by the proxy.
 */
export async function prepareCompressedTraceTextures(
  root: Object3D,
  files: VerifiedFiles,
  signal: AbortSignal,
): Promise<CompressedTraceTextureOwner> {
  const sources = new Map<Source<unknown>, string>(),
    owned = new Map<Source<unknown>, TraceImage>(),
    bitmaps = new Set<ImageBitmap>()
  let disposed = false
  function dispose() {
    if (disposed) return
    disposed = true
    signal.removeEventListener('abort', dispose)
    for (const [original, image] of owned) {
      if (traceImages.get(original) === image) traceImages.delete(original)
      image.views.forEach((view) => view.dispose())
      image.views.clear()
    }
    bitmaps.forEach((bitmap) => bitmap.close())
    bitmaps.clear()
    owned.clear()
  }
  signal.throwIfAborted()
  signal.addEventListener('abort', dispose, { once: true })
  try {
    root.traverse((node) => {
      if (!(node instanceof Mesh)) return
      const materials = Array.isArray(node.material) ? node.material : [node.material]
      for (const material of materials)
        for (const value of Object.values(material)) {
          if (!(value instanceof Texture) || !isCompressedTraceTexture(value)) continue
          const path: unknown = value.userData.treesTraceImage
          if (typeof path !== 'string' || !/^trace\/[^?#]+\.png$/.test(path))
            throw new Error('DDGI 压缩纹理缺少有效的 CPU 追踪副本标记')
          if (sources.has(value.source) && sources.get(value.source) !== path)
            throw new Error('DDGI 同一纹理 Source 不能引用不同的 CPU 追踪副本')
          sources.set(value.source, path)
        }
    })
    for (const [original, path] of sources) {
      signal.throwIfAborted()
      if (traceImages.has(original)) throw new Error('DDGI CPU 追踪纹理已有资源拥有者')
      try {
        const bytes = await files.read(path)
        signal.throwIfAborted()
        const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }), {
          imageOrientation: 'none',
          premultiplyAlpha: 'none',
          colorSpaceConversion: 'none',
        })
        if (disposed || signal.aborted) {
          bitmap.close()
          signal.throwIfAborted()
          throw new Error('DDGI CPU 追踪纹理拥有者已释放')
        }
        bitmaps.add(bitmap)
        if (
          !Number.isInteger(bitmap.width) ||
          !Number.isInteger(bitmap.height) ||
          bitmap.width < 1 ||
          bitmap.height < 1 ||
          Math.max(bitmap.width, bitmap.height) > maximumTraceImageSize
        )
          throw new Error('DDGI CPU 追踪副本尺寸必须在 1–256 像素范围内：' + path)
        owned.set(original, { source: new Source(bitmap), path, views: new Map() })
      } finally {
        files.release(path)
      }
    }
    signal.throwIfAborted()
    for (const original of owned.keys())
      if (traceImages.has(original)) throw new Error('DDGI CPU 追踪纹理已有资源拥有者')
    for (const [original, image] of owned) traceImages.set(original, image)
    signal.removeEventListener('abort', dispose)
    return { dispose }
  } catch (error) {
    dispose()
    throw error
  }
}

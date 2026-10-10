import { LoadingManager, Texture, WebGLRenderer, type Group } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import { checkGlbDocument } from './glbDocument'
import { ownedResources } from './ownedResources'
import { decodeQueue } from './decodeQueue'
import type { AssetBundle } from './assetBundle'

export async function decodeGlb(
  bundle: AssetBundle,
  bytes: Map<string, ArrayBuffer>,
  renderer: WebGLRenderer,
  signal: AbortSignal,
) {
  const data = bytes.get(bundle.entry)
  if (!data) throw new Error('资源包缺少模型入口')
  checkGlbDocument(data, bundle)
  signal.throwIfAborted()
  const urls = new Map<string, string>(),
    resources = ownedResources()
  let root: Group | undefined,
    failedImage = false
  const manager = new LoadingManager()
  manager.onError = () => {
    failedImage = true
  }
  manager.setURLModifier((url) => {
    if (url.startsWith('blob:')) return url // GLTFLoader's own embedded-image object URLs.
    // KTX2Loader must use this manager for package textures and its fixed local decoder files.
    if (url === '/basis/basis_transcoder.js' || url === '/basis/basis_transcoder.wasm') return url
    const existing = urls.get(url)
    if (existing) return existing
    const source = bytes.get(url)
    if (!source) throw new Error('模型请求了包外资源')
    const result = URL.createObjectURL(new Blob([source]))
    urls.set(url, result)
    return result
  })
  // Decoder instances belong to this parse. All binaries are self-hosted.
  const draco = new DRACOLoader().setDecoderPath('/draco/').setWorkerLimit(2)
  const ktx = new KTX2Loader(manager)
    .setTranscoderPath('/basis/')
    .setWorkerLimit(2)
    .detectSupport(renderer)
  const loader = new GLTFLoader(manager)
    .setDRACOLoader(draco)
    .setKTX2Loader(ktx)
    .setMeshoptDecoder(MeshoptDecoder)
  const pending = new Set<Promise<unknown>>()
  function remember<T>(promise: Promise<T>): Promise<T> {
    const tracked = promise.then((value) => {
      resources.track(value)
      return value
    })
    pending.add(tracked)
    // Both branches handle rejection; do not create an unhandled finally() promise.
    void tracked.then(
      () => pending.delete(tracked),
      () => pending.delete(tracked),
    )
    return tracked
  }
  loader.register((parser) => {
    const imageSource = parser.loadImageSource.bind(parser)
    const imagePromises = new Map<number, ReturnType<typeof imageSource>>()
    const decode = decodeQueue(3, signal)
    parser.loadImageSource = (index, imageLoader) => {
      const existing = imagePromises.get(index)
      if (existing) return remember(existing.then((texture) => texture.clone()))
      const uri: unknown = parser.json.images[index]?.uri
      const promise = decode(async () => {
        const source = typeof uri === 'string' ? bytes.get(uri) : undefined
        if (
          source &&
          typeof createImageBitmap === 'function' &&
          'isImageBitmapLoader' in imageLoader &&
          imageLoader.isImageBitmapLoader === true &&
          typeof uri === 'string' &&
          /\.(png|jpe?g|webp)$/i.test(uri)
        ) {
          const bitmap = await createImageBitmap(new Blob([source]), {
            // glTF uses unflipped image rows. Texture.flipY=false cannot undo
            // a flip baked into ImageBitmap; match GLTFLoader's native decode.
            imageOrientation: 'none',
            premultiplyAlpha: 'none',
            colorSpaceConversion: 'none',
          })
          const texture = new Texture(bitmap)
          texture.needsUpdate = true
          const extra: unknown = parser.json.images[index]?.extras
          if (extra && typeof extra === 'object' && !Array.isArray(extra))
            Object.assign(texture.userData, extra)
          texture.userData.mimeType = uri.endsWith('.png')
            ? 'image/png'
            : uri.endsWith('.webp')
              ? 'image/webp'
              : 'image/jpeg'
          return texture
        }
        return imageSource(index, imageLoader)
      }).finally(() => {
        if (typeof uri !== 'string') return
        const url = urls.get(uri)
        if (url) URL.revokeObjectURL(url)
        urls.delete(uri)
        bytes.delete(uri)
      })
      imagePromises.set(index, promise)
      return remember(promise)
    }
    const dependency = parser.getDependency.bind(parser)
    parser.getDependency = (type, index) =>
      remember(
        (dependency(type, index) as Promise<unknown>).then((value) => {
          if (type === 'texture' && !value) failedImage = true
          return value
        }),
      )
    const geometries = parser.loadGeometries.bind(parser)
    parser.loadGeometries = (primitives) => remember(geometries(primitives))
    return { name: 'TREES_resource_ownership' }
  })
  try {
    const gltf = await loader.parseAsync(data, '')
    root = gltf.scene
    resources.track(gltf.scenes)
    signal.throwIfAborted()
    if (failedImage) throw new Error('模型纹理解析失败，请重新加载。')
    return {
      root,
      animations: gltf.animations,
      dispose() {
        root?.removeFromParent()
        resources.dispose()
        root?.clear()
      },
    }
  } catch (error) {
    resources.dispose()
    root?.removeFromParent()
    throw error
  } finally {
    // A failed parse may leave sibling decoder tasks running. Let them settle before terminating workers.
    while (pending.size) await Promise.allSettled([...pending])
    draco.dispose()
    ktx.dispose()
    urls.forEach((url) => URL.revokeObjectURL(url))
  }
}

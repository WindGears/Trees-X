import {
  BufferGeometry,
  Line,
  Material,
  Mesh,
  Object3D,
  Points,
  Skeleton,
  SkinnedMesh,
  Texture,
} from 'three'

/** Includes partial parse results and resources arriving after a failed parse. */
export function ownedResources() {
  const resources = new Set<BufferGeometry | Material | Texture | Skeleton>()
  const released = new Set<object>(),
    bitmaps = new Set<ImageBitmap>()
  let disposed = false
  function release(value: BufferGeometry | Material | Texture | Skeleton) {
    if (released.has(value)) return
    released.add(value)
    if (
      value instanceof Texture &&
      typeof ImageBitmap !== 'undefined' &&
      value.source.data instanceof ImageBitmap
    ) {
      const bitmap = value.source.data as ImageBitmap
      if (!bitmaps.has(bitmap)) {
        bitmaps.add(bitmap)
        bitmap.close()
      }
    }
    value.dispose()
  }
  function track(value: unknown): void {
    if (Array.isArray(value)) {
      value.forEach(track)
      return
    }
    if (value instanceof Object3D) {
      value.traverse((node) => {
        // glTF also creates final LineBasicMaterial / PointsMaterial variants.
        // They are not Mesh instances and must share the loader's unique release owner.
        if (node instanceof Mesh || node instanceof Line || node instanceof Points) {
          track(node.geometry)
          track(node.material)
        }
        if (node instanceof SkinnedMesh) track(node.skeleton)
      })
      return
    }
    if (value instanceof Material)
      Object.values(value).forEach((v) => {
        if (v instanceof Texture) track(v)
      })
    if (
      value instanceof BufferGeometry ||
      value instanceof Material ||
      value instanceof Texture ||
      value instanceof Skeleton
    ) {
      resources.add(value)
      if (disposed) release(value)
    }
  }
  return {
    track,
    dispose() {
      disposed = true
      resources.forEach(release)
    },
  }
}

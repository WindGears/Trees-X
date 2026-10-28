import { REVISION, Source, type FramebufferTexture } from 'three'
import type { WebGPURenderer } from 'three/webgpu'

type CopyRenderer = Pick<WebGPURenderer, 'copyFramebufferToTexture'>

/** r185 native transmission clones share Source/image across render targets.
 * Detach reflection size metadata before the first GPU copy. Textures remain
 * borrowed; only the synchronous renderer-instance method is intercepted.
 */
export function createReflectionViewportScope(revision = REVISION) {
  if (revision !== '185') throw new Error('Reflection viewport requires reviewed r185')
  const records = new Map<FramebufferTexture, () => void>()
  let running = false,
    disposed = false
  function isolate(texture: FramebufferTexture) {
    if (records.has(texture)) return
    const image: unknown = texture.image
    if (
      !image ||
      typeof image !== 'object' ||
      !('width' in image) ||
      !('height' in image) ||
      typeof image.width !== 'number' ||
      typeof image.height !== 'number'
    )
      throw new Error('Reflection viewport requires a 2D framebuffer size record')
    const original = texture.source,
      independent = new Source({ width: image.width, height: image.height })
    const forget = () => {
      texture.removeEventListener('dispose', forget)
      records.delete(texture)
    }
    records.set(texture, () => {
      forget()
      if (texture.source === independent) {
        texture.source = original
        texture.needsUpdate = true
      }
    })
    texture.addEventListener('dispose', forget)
    texture.source = independent
    // A first copy can encounter an allocation made before this scope attached.
    texture.needsUpdate = true
  }
  return {
    run<T>(renderer: CopyRenderer, draw: () => T): T {
      if (disposed || running) throw new Error('Reflection viewport scope is unavailable')
      const original = renderer.copyFramebufferToTexture
      if (typeof original !== 'function') throw new Error('Framebuffer copy contract changed')
      const copy: CopyRenderer['copyFramebufferToTexture'] = (texture, rectangle) => {
        isolate(texture)
        return original.call(renderer, texture, rectangle)
      }
      running = true
      renderer.copyFramebufferToTexture = copy
      try {
        return draw()
      } finally {
        if (renderer.copyFramebufferToTexture === copy) renderer.copyFramebufferToTexture = original
        running = false
      }
    },
    dispose() {
      if (disposed) return
      disposed = true
      for (const restore of records.values()) restore()
      records.clear()
    },
  }
}

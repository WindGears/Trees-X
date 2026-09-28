import type { Camera, Scene, WebGLRenderer } from 'three'

interface RenderHost {
  instance: Pick<WebGLRenderer, 'render' | 'setRenderTarget' | 'autoClear'>
  replaceRenderFunction: (render: (notifyRendered: () => void) => void) => void
}
const owners = new WeakMap<RenderHost['instance'], symbol>()

/** post-processing 3.7.4 disposes its composer but leaves its render callback installed. */
export function acquireComposerHandoff(
  host: RenderHost,
  scene: () => Scene,
  camera: () => Camera | undefined,
  invalidate: () => void,
) {
  const token = Symbol('composer')
  const instance = host.instance
  owners.set(instance, token)
  return () => {
    // An old unmount hook must not overwrite a newly mounted composer's callback.
    if (owners.get(instance) !== token) return
    owners.delete(instance)
    instance.setRenderTarget(null)
    instance.autoClear = true
    host.replaceRenderFunction((notifyRendered) => {
      const activeCamera = camera()
      if (!activeCamera) return
      instance.render(scene(), activeCamera)
      notifyRendered()
    })
    invalidate()
  }
}

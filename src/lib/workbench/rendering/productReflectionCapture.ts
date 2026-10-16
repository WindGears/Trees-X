import { Color, Light, REVISION, type Object3D, type Scene } from 'three'
import type { NodeFrame, WebGPURenderer } from 'three/webgpu'
import type ReflectorNode from 'three/src/nodes/utils/ReflectorNode.js'

type CaptureRenderer = Pick<WebGPURenderer, 'getClearColor' | 'getClearAlpha' | 'setClearColor'>

/** Synchronous capture scope. Product and lighting are borrowed, never cloned or disposed. */
export function createProductCaptureScope(product: Object3D) {
  const hidden: Object3D[] = [],
    clear = new Color()
  let running = false
  return {
    run<T>(scene: Scene, renderer: CaptureRenderer, draw: () => T): T {
      if (running) throw new Error('Product reflection capture cannot recurse')
      running = true
      const background = scene.background,
        backgroundNode = scene.backgroundNode,
        alpha = renderer.getClearAlpha()
      renderer.getClearColor(clear)
      // Only hide root branches; descendants retain their existing visibility.
      // Lights may be grouped, so preserve every branch containing a light.
      for (const child of scene.children) {
        let preserve = child === product
        child.traverse((node) => {
          if (node === product || node instanceof Light) preserve = true
        })
        if (!preserve && child.visible) {
          hidden.push(child)
          child.visible = false
        }
      }
      try {
        scene.background = null
        scene.backgroundNode = null
        renderer.setClearColor(0, 0)
        return draw()
      } finally {
        scene.background = background
        scene.backgroundNode = backgroundNode
        renderer.setClearColor(clear, alpha)
        for (const node of hidden) node.visible = true
        hidden.length = 0
        running = false
      }
    },
  }
}

/** Local pinned bridge; no renderer/global prototype patch or additional render loop. */
export function bindProductReflectionCapture(
  reflector: ReflectorNode,
  product: Object3D,
  revision = REVISION,
) {
  if (revision !== '185') throw new Error('Product reflection capture requires reviewed r185')
  const base = reflector.reflector,
    original = base.updateBefore,
    scope = createProductCaptureScope(product)
  if (typeof original !== 'function' || !(base.renderTargets instanceof Map))
    throw new Error('Reflector capture contract changed')
  const update = (frame: NodeFrame) => {
    if (!frame.scene || !frame.renderer) return original.call(base, frame)
    return scope.run(frame.scene, frame.renderer, () => original.call(base, frame))
  }
  base.updateBefore = update
  return () => {
    if (base.updateBefore === update) base.updateBefore = original
  }
}

import type { Group, Scene, WebGLRenderer } from 'three'
import { createStudioLights, studioDesign } from './design'
import { createStudioGeometry } from './geometry'
import { createStudioReflection } from './reflection'
import { createStudioContactShadow } from './contactShadow'

/** Local studio with no renderer, camera ownership, ticker, or model-transform mutation. */
export function createTypewriterStudio(
  renderer: WebGLRenderer,
  scene: Scene,
  model: Group,
  groundY: number = studioDesign.groundY,
) {
  const geometry = createStudioGeometry(groundY)
  const lighting = createStudioLights()
  let reflection: ReturnType<typeof createStudioReflection> | undefined
  let shadow: ReturnType<typeof createStudioContactShadow> | undefined
  let disposed = false
  const dispose = () => {
    if (disposed) return
    disposed = true
    reflection?.dispose()
    shadow?.dispose()
    lighting.dispose()
    geometry.dispose()
  }
  try {
    scene.add(geometry.group, ...lighting.lights)
    reflection = createStudioReflection(groundY)
    reflection.attach(scene)
    shadow = createStudioContactShadow(renderer, scene, model, groundY)
  } catch (error) {
    dispose()
    throw error
  }
  return {
    markDirty() {
      if (!disposed) shadow?.markDirty()
    },
    render() {
      if (!disposed) shadow?.render()
    },
    dispose,
  }
}

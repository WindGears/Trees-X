import { RectAreaLight, type Group, type Scene, type WebGLRenderer } from 'three'
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js'
import { createContactShadow } from '@/lib/reventon/contactShadow'

/** Local lighting and live ground projection; the workbench keeps its renderer and camera. */
export function createReventonStage(renderer: WebGLRenderer, scene: Scene, model: Group) {
  RectAreaLightUniformsLib.init()
  const key = new RectAreaLight('#ffffff', 7, 6, 3)
  const strip = new RectAreaLight('#ffffff', 4, 4, 1.2)
  key.name = 'Reventon / key softbox'
  strip.name = 'Reventon / reflection strip'
  key.position.set(-1, 4, -3)
  strip.position.set(3, 2, 1)
  key.lookAt(0, 0.5, 0)
  strip.lookAt(0, 0.5, 0)
  let shadow: ReturnType<typeof createContactShadow> | undefined
  let disposed = false
  const dispose = () => {
    if (disposed) return
    disposed = true
    key.removeFromParent()
    strip.removeFromParent()
    shadow?.dispose()
    key.dispose()
    strip.dispose()
  }
  try {
    scene.add(key, strip)
    shadow = createContactShadow(renderer, scene, model)
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

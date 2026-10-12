import type { Group, Scene } from 'three'
import { createTypewriterStudio } from '../studio/stage'
import { createStudioLights, studioDesign } from '../studio/design'
import { createGpuStudioGeometry } from './studioGeometry'
import { createGpuStudioReflection } from './studioReflection'
import { createGpuStudioShadow } from './studioShadow'
import { bindGpuAreaLights } from './studioEnvironment'
import { isWebGpuRenderer, type WorkbenchRenderer } from './rendererTypes'

export type WorkbenchStudio = ReturnType<typeof createTypewriterStudio>
export type WorkbenchStudioFactory = (
  renderer: WorkbenchRenderer,
  scene: Scene,
  model: Group,
  groundY?: number,
) => WorkbenchStudio

/** Backend-local auxiliary passes. This function never creates or owns a renderer. */
export const createWorkbenchStudio: WorkbenchStudioFactory = (
  renderer,
  scene,
  model,
  groundY = studioDesign.groundY,
) => {
  if (!isWebGpuRenderer(renderer)) return createTypewriterStudio(renderer, scene, model, groundY)
  const geometry = createGpuStudioGeometry(groundY),
    lighting = createStudioLights()
  let reflection: ReturnType<typeof createGpuStudioReflection> | undefined,
    shadow: ReturnType<typeof createGpuStudioShadow> | undefined,
    disposed = false
  const dispose = () => {
    if (disposed) return
    disposed = true
    reflection?.dispose()
    shadow?.dispose()
    lighting.dispose()
    geometry.dispose()
  }
  try {
    bindGpuAreaLights()
    scene.add(geometry.group, ...lighting.lights)
    reflection = createGpuStudioReflection(groundY)
    scene.add(reflection.mesh)
    shadow = createGpuStudioShadow(renderer, scene, model, groundY)
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

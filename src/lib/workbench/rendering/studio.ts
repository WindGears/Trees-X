import type { Group, Scene } from 'three'
import { createTypewriterStudio } from '../studio/stage'
import { createStudioLights, studioDesign } from '../studio/design'
import { createGpuStudioGeometry } from './studioGeometry'
import { createGpuStudioReflection } from './studioReflection'
import { createGpuStudioShadow } from './studioShadow'
import { bindGpuAreaLights } from './studioEnvironment'
import { isWebGpuRenderer, type WorkbenchRenderer } from './rendererTypes'
import { isRealtimeRenderer } from './realtimeMode'
import { resolveStudioPalette } from '../studio/palette'
import type { StudioMoodUpdate } from '../studio/mood'
import { createLoungeLook } from './loungeLook'
import { resolveLoungeProjection } from './loungeSpatialMode'

export type WorkbenchStudio = ReturnType<typeof createTypewriterStudio> & {
  setMood?: (update: StudioMoodUpdate) => void
}
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
  const realtime = isRealtimeRenderer(renderer),
    spatial = realtime && resolveLoungeProjection() !== 'infinite'
  const geometry = createGpuStudioGeometry(groundY, false, resolveStudioPalette(false), spatial),
    lighting = createStudioLights()
  const lounge = realtime ? createLoungeLook(geometry, lighting.lights) : undefined
  let reflection: ReturnType<typeof createGpuStudioReflection> | undefined,
    shadow: ReturnType<typeof createGpuStudioShadow> | undefined,
    disposed = false
  const dispose = () => {
    if (disposed) return
    disposed = true
    lounge?.dispose()
    reflection?.dispose()
    shadow?.dispose()
    lighting.dispose()
    geometry.dispose()
  }
  try {
    bindGpuAreaLights()
    scene.add(geometry.group, ...lighting.lights)
    // This planar stage layer is retained for image quality: screen-space rays
    // cannot reproduce its offscreen reflection reliably. Its native Basic
    // material writes a zero capture mask, excluding it from SSR replacement.
    // Product SSR still supplies local detail; this is not a second renderer.
    // The realtime pass blends in HDR before ACES. WebGL blends the authored
    // overlays after tone mapping, so equal alpha values look much weaker here.
    // These stage-only weights are a visual calibration, not BRDF equivalence.
    const reflectionMode =
      realtime && typeof location !== 'undefined'
        ? new URLSearchParams(location.search).get('planarReflection')
        : null
    reflection = createGpuStudioReflection(
      groundY,
      spatial ? 0.28 : realtime ? 0.5 : 0.28,
      geometry.table?.dimensions,
      realtime && reflectionMode !== 'scene' ? model : undefined,
    )
    if (realtime && reflectionMode === 'off') reflection.mesh.visible = false
    scene.add(reflection.mesh)
    shadow = createGpuStudioShadow(
      renderer,
      scene,
      model,
      groundY,
      realtime ? 0.68 : 0.46,
      geometry.table?.dimensions,
    )
  } catch (error) {
    dispose()
    throw error
  }
  return {
    setMood: lounge?.setMood,
    markDirty() {
      if (!disposed) shadow?.markDirty()
    },
    render() {
      if (!disposed) {
        lounge?.render()
        shadow?.render()
      }
    },
    dispose,
  }
}

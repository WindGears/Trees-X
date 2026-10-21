import { Vector4, type Camera, type Scene } from 'three'
import { RendererUtils, type WebGPURenderer } from 'three/webgpu'

/** Loading-only snapshot. The caller serializes preparation with real drawing;
 * a preparation lease protects ownership but is not a renderer mutex.
 */
export function preservePreparationState(renderer: WebGPURenderer, scene: Scene, camera: Camera) {
  const state = RendererUtils.saveRendererState(renderer),
    sceneState = RendererUtils.saveSceneState(scene),
    viewport = renderer.getViewport(new Vector4()),
    scissor = renderer.getScissor(new Vector4()),
    opaque = renderer.opaque,
    transparent = renderer.transparent,
    context = renderer.contextNode,
    xr = renderer.xr.enabled,
    shadows = renderer.shadowMap.enabled,
    depth = renderer.depth,
    stencil = renderer.stencil,
    mask = camera.layers.mask,
    name = scene.name
  return () => {
    RendererUtils.restoreRendererState(renderer, state)
    RendererUtils.restoreSceneState(scene, sceneState)
    renderer.setViewport(viewport)
    renderer.setScissor(scissor)
    renderer.opaque = opaque
    renderer.transparent = transparent
    renderer.contextNode = context
    renderer.xr.enabled = xr
    renderer.shadowMap.enabled = shadows
    renderer.depth = depth
    renderer.stencil = stencil
    camera.layers.mask = mask
    scene.name = name
  }
}

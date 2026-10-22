import { RectAreaLight, type Group, type Scene, type WebGLRenderer } from 'three'
import { createContactShadow } from '@/lib/reventon/contactShadow'
import { acquireRectAreaUniforms } from '@/lib/three/rectAreaUniforms'
import { createShadowRefresh } from './rendering/shadowRefresh'
import { carStudioLighting, type CarStudioQuality } from './carStudioQuality'

/** Local lighting and live ground projection; the workbench keeps its renderer and camera. */
export function createReventonStage(renderer: WebGLRenderer, scene: Scene, model: Group) {
  return createReventonStageWithShadow(scene, () => createContactShadow(renderer, scene, model))
}

export type ReventonStage = ReturnType<typeof createReventonStageWithShadow>

interface ReventonShadow {
  render(): void
  markDirty(): void
  dispose(): void
  prepare?(signal?: AbortSignal): Promise<void>
}

export interface ReventonStageOptions {
  quality?: CarStudioQuality
  createKeyLight?: () => RectAreaLight
}

/** Both backends retain the car's authored lights and the same unique owners. */
export function createReventonStageWithShadow(
  scene: Scene,
  createShadow: () => ReventonShadow,
  options: ReventonStageOptions = {},
) {
  const key = options.createKeyLight?.() ?? new RectAreaLight('#ffffff', 7, 6, 3)
  const strip = new RectAreaLight('#ffffff', 4, 4, 1.2)
  key.name = 'Reventon / key softbox'
  strip.name = 'Reventon / reflection strip'
  key.position.set(-1, 4, -3)
  strip.position.set(3, 2, 1)
  key.lookAt(0, 0.5, 0)
  strip.lookAt(0, 0.5, 0)
  if (options.quality === 'studio') {
    for (const [light, profile] of [
      [key, carStudioLighting.key],
      [strip, carStudioLighting.strip],
    ] as const) {
      light.intensity = profile.intensity
      light.width = profile.width
      light.height = profile.height
      light.position.set(profile.position[0], profile.position[1], profile.position[2])
      light.lookAt(profile.target[0], profile.target[1], profile.target[2])
    }
  }
  const releaseUniforms = acquireRectAreaUniforms(),
    shadowRefresh = createShadowRefresh(scene)
  let shadow: ReventonShadow | undefined
  let disposed = false
  const dispose = () => {
    if (disposed) return
    disposed = true
    key.removeFromParent()
    strip.removeFromParent()
    try {
      shadow?.dispose()
    } finally {
      shadowRefresh.dispose()
      key.dispose()
      strip.dispose()
      releaseUniforms()
    }
  }
  try {
    scene.add(key, strip)
    shadowRefresh.beforeRender()
    shadow = createShadow()
  } catch (error) {
    dispose()
    throw error
  }
  return {
    async prepare(signal?: AbortSignal) {
      signal?.throwIfAborted()
      if (disposed) throw new Error('Car stage has been disposed')
      await shadow?.prepare?.(signal)
      signal?.throwIfAborted()
    },
    markDirty() {
      if (disposed) return
      shadowRefresh.markDirty()
      shadow?.markDirty()
    },
    render() {
      if (disposed) return
      shadowRefresh.beforeRender()
      shadow?.render()
    },
    dispose,
  }
}

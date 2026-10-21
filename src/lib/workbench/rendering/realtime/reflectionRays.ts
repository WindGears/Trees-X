import type { Texture } from 'three'
import type { Node, PerspectiveCamera, TextureNode } from 'three/webgpu'
import { ssr } from 'three/addons/tsl/display/SSRNode.js'
import { classifySsrSources } from './ssrSourceClassification'
import { createSsrRaySequence } from './ssrRaySequence'

export interface ReflectionRaySnapshot {
  requested: 1 | 2
  actual: 1 | 2
  error: string | null
  frames: number
  seeds: readonly number[]
}

interface Inputs {
  beauty: TextureNode
  depth: TextureNode
  normal: Node<'vec3'>
  roughness: Node<'float'>
  albedo: TextureNode
  nativeSingle: TextureNode
  camera: PerspectiveCamera
}

/** Own each native effect and its local classification seam. Surface/beauty
 * textures are shared and borrowed; there is still one rendering scheduler.
 */
export function createReflectionRays(inputs: Inputs, requested: 1 | 2, classify: boolean) {
  const effects: ReturnType<typeof ssr>[] = []
  const releases: (() => void)[] = []
  let sequence: ReturnType<typeof createSsrRaySequence> | undefined
  let error: string | null = null
  let disposed = false
  let frames = 0
  const create = () => {
    const effect = ssr(inputs.beauty, inputs.depth, inputs.normal, {
      stochastic: true,
      diffuseNode: inputs.albedo,
      metalnessNode: inputs.albedo.a,
      roughnessNode: inputs.roughness,
      binaryRefine: true,
      camera: inputs.camera,
    })
    effects.push(effect)
    effect.resolutionScale = 1
    effect.quality.value = 1
    effect.maxDistance.value = 8
    effect.thickness.value = 0.035
    effect.maxLuminance.value = Infinity
    effect.intensity.value = 1
    effect.environmentIntensity.value = 0
    effect.screenEdgeFadeBlack = true
    effect.screenEdgeFade.value = 0
    if (classify) releases.push(classifySsrSources(effect, inputs.nativeSingle))
    return effect
  }
  const clear = () => {
    sequence?.dispose()
    sequence = undefined
    for (const release of releases.splice(0)) release()
    for (const effect of effects.splice(0)) effect.dispose()
  }
  try {
    create()
    if (requested === 2) {
      try {
        create()
        sequence = createSsrRaySequence(effects)
      } catch (cause) {
        clear()
        error = cause instanceof Error ? cause.message : String(cause)
        create()
      }
    }
  } catch (cause) {
    clear()
    throw cause
  }
  return {
    textures: effects.map((effect) => effect.getTextureNode()),
    prepare: () => sequence?.prepare(),
    commitFrame() {
      sequence?.commitFrame()
      frames++
    },
    cancelFrame: () => sequence?.cancelFrame(),
    setEnvironment(environment: Texture | null) {
      for (const effect of effects) effect.setEnvMap(environment)
    },
    snapshot: (): ReflectionRaySnapshot => ({
      requested,
      actual: effects.length === 2 ? 2 : 1,
      error,
      frames,
      seeds: sequence?.snapshot().seeds ?? [0],
    }),
    dispose() {
      if (!disposed) {
        disposed = true
        clear()
      }
    },
  }
}

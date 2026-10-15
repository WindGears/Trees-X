import { uniform } from 'three/tsl'

export type ReflectionKernel = 'rotating' | 'static'

export interface ReflectionSamplingSnapshot {
  mode: ReflectionKernel
  frames: number
  phase: number
  prepared: boolean
}

/** A bounded golden-angle sequence owned by successful complete frames.
 * Failed, superseded and cancelled draws reuse the same sample phase.
 * No renderer clock, textures or per-frame allocations belong here.
 */
export function createReflectionSampling(mode: ReflectionKernel = 'rotating') {
  const phase = uniform(0)
  const turn = Math.PI * 2,
    increment = Math.PI * (3 - Math.sqrt(5))
  let frames = 0,
    nextPhase = 0,
    prepared = false,
    disposed = false
  return {
    phase,
    prepare() {
      if (disposed) throw new Error('Reflection sampling has been disposed')
      phase.value = mode === 'rotating' ? nextPhase : 0
      prepared = true
    },
    commitFrame() {
      if (disposed || !prepared) throw new Error('Reflection sampling has no prepared frame')
      prepared = false
      frames++
      nextPhase = (nextPhase + increment) % turn
    },
    cancelFrame() {
      prepared = false
    },
    snapshot: (): ReflectionSamplingSnapshot => ({ mode, frames, phase: phase.value, prepared }),
    dispose() {
      disposed = true
      prepared = false
    },
  }
}

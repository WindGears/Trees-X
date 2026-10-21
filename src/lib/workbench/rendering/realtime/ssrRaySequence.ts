import { REVISION } from 'three'
import { UniformNode } from 'three/webgpu'

const installed = new WeakSet<object>()
const modulus = 0x7fffffff

/** Audited r185 advances _noiseIndex immediately before its fullscreen draw.
 * Stage one earlier so retries reuse a sample and only successful frames advance.
 * These uniforms belong to the SSR effects; no global prototypes are changed.
 */
export function createSsrRaySequence(effects: readonly object[], revision = REVISION) {
  if (revision !== '185' || effects.length !== 2 || new Set(effects).size !== 2)
    throw new Error('Independent SSR rays require two distinct inspected r185 effects')
  const uniforms = effects.map((effect) => {
    const noise: unknown = Reflect.get(effect, '_noiseIndex')
    if (installed.has(effect) || !(noise instanceof UniformNode) || typeof noise.value !== 'number')
      throw new Error('Independent SSR ray noise contract changed or is already owned')
    return noise as { value: number }
  })
  if (uniforms[0] === uniforms[1]) throw new Error('SSR ray uniforms must not be shared')
  const seeds = [0, 104729] as const
  const initial = uniforms.map((noise) => noise.value)
  for (const effect of effects) installed.add(effect)
  let frames = 0,
    prepared = false,
    disposed = false
  return {
    prepare() {
      if (disposed) throw new Error('SSR ray sequence has been disposed')
      uniforms.forEach((noise, index) => {
        const next = (frames + seeds[index]!) % modulus
        noise.value = next === 0 ? modulus - 1 : next - 1
      })
      prepared = true
    },
    commitFrame() {
      if (disposed || !prepared) throw new Error('SSR ray sequence has no prepared frame')
      prepared = false
      frames = (frames + 1) % modulus
    },
    cancelFrame() {
      prepared = false
    },
    snapshot: () => ({ frames, seeds: [...seeds], prepared }),
    dispose() {
      if (disposed) return
      disposed = true
      uniforms.forEach((noise, index) => {
        noise.value = initial[index]!
      })
      for (const effect of effects) installed.delete(effect)
    },
  }
}

export interface ParticleData {
  positions: Float32Array
  seeds: Float32Array
}

function mulberry32(seed: number) {
  let state = seed >>> 0
  return () => {
    state += 0x6d2b79f5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

/** Produces stable particle buffers once; callers own the returned typed arrays. */
export function createParticleData(count: number, seed = 0x54524545): ParticleData {
  const random = mulberry32(seed)
  const positions = new Float32Array(count * 3)
  const seeds = new Float32Array(count)
  for (let index = 0; index < count; index += 1) {
    const offset = index * 3
    const radius = 2.1 + random() * 2.7
    const angle = random() * Math.PI * 2
    const elevation = (random() - 0.5) * 4.6
    positions[offset] = Math.cos(angle) * radius
    positions[offset + 1] = elevation
    positions[offset + 2] = Math.sin(angle) * radius * 0.72 - 0.35
    seeds[index] = random()
  }
  return { positions, seeds }
}

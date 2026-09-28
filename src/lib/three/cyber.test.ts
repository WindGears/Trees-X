import { describe, expect, it } from 'vitest'
import { createParticleData } from './cyber'

describe('cyber stage particles', () => {
  it('uses a fixed seed and allocates each buffer once at the requested size', () => {
    const first = createParticleData(720)
    const second = createParticleData(720)
    const otherSeed = createParticleData(720, 42)
    expect(first.positions).toHaveLength(2160)
    expect(first.seeds).toHaveLength(720)
    expect(first.positions).toEqual(second.positions)
    expect(first.seeds).toEqual(second.seeds)
    expect(first.positions).not.toEqual(otherSeed.positions)
    expect([...first.seeds].every((value) => value >= 0 && value < 1)).toBe(true)
  })
})

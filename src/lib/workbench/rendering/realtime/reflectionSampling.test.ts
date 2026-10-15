import { describe, expect, it } from 'vitest'
import { createReflectionSampling } from './reflectionSampling'

describe('successful-frame reflection sampling', () => {
  it('retries cancelled and superseded frames with exactly the same GPU uniform', () => {
    const sampling = createReflectionSampling(),
      uniform = sampling.phase
    expect(() => sampling.commitFrame()).toThrow('no prepared frame')
    sampling.prepare()
    sampling.prepare()
    sampling.cancelFrame()
    expect(() => sampling.commitFrame()).toThrow('no prepared frame')
    expect(sampling.snapshot().frames).toBe(0)
    sampling.prepare()
    expect(sampling.phase.value).toBe(0)
    sampling.commitFrame()
    sampling.prepare()
    const retryPhase = sampling.phase.value
    expect(retryPhase).toBeGreaterThan(0)
    sampling.cancelFrame()
    sampling.prepare()
    expect(sampling.phase.value).toBe(retryPhase)
    expect(sampling.phase).toBe(uniform)
    expect(sampling.snapshot().frames).toBe(1)
    sampling.commitFrame()
    expect(() => sampling.commitFrame()).toThrow('no prepared frame')
    sampling.dispose()
  })

  it('covers the angular domain without unbounded shader floats or a 32-frame repeat', () => {
    const sampling = createReflectionSampling(),
      first = new Set<number>(),
      sectors = new Set<number>()
    for (let frame = 0; frame < 10000; frame++) {
      sampling.prepare()
      const phase = sampling.phase.value
      expect(Number.isFinite(phase)).toBe(true)
      expect(phase).toBeGreaterThanOrEqual(0)
      expect(phase).toBeLessThan(Math.PI * 2)
      if (frame < 64) {
        first.add(phase)
        sectors.add(Math.floor((phase / (Math.PI * 2)) * 16))
      }
      sampling.commitFrame()
    }
    expect(first.size).toBe(64)
    expect(sectors.size).toBe(16)
    expect(sampling.snapshot().frames).toBe(10000)
    sampling.dispose()
  })

  it('retains an explicit static comparison and rejects use after disposal', () => {
    const sampling = createReflectionSampling('static')
    for (let frame = 0; frame < 20; frame++) {
      sampling.prepare()
      expect(sampling.phase.value).toBe(0)
      sampling.commitFrame()
    }
    sampling.prepare()
    sampling.dispose()
    sampling.dispose()
    expect(sampling.snapshot()).toMatchObject({ mode: 'static', frames: 20, prepared: false })
    expect(() => sampling.prepare()).toThrow('disposed')
    expect(() => sampling.commitFrame()).toThrow('no prepared frame')
  })
})

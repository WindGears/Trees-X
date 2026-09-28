import { describe, expect, it } from 'vitest'
import { summarizeFrameTimes } from './useVisualPerformance'

describe('visual frame report', () => {
  it('calculates stable median and P95 values for the active quality tier', () => {
    const samples = new Float32Array([16, 17, 18, 19, 20, 21, 22, 30, 32, 40])
    expect(summarizeFrameTimes(samples, samples.length, 2)).toEqual({
      median: 21,
      p95: 40,
      samples: 10,
      tier: 2,
    })
  })
})

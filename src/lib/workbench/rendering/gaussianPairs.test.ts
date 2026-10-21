import { describe, expect, it } from 'vitest'
import { gaussianTaps } from './gaussianPairs'

function sample(values: number[], x: number) {
  const a = Math.floor(x),
    fraction = x - a,
    clamped = (index: number) => values[Math.max(0, Math.min(values.length - 1, index))]!
  return clamped(a) * (1 - fraction) + clamped(a + 1) * fraction
}

describe('Gaussian bilinear sampling reuse', () => {
  it('preserves all normalized weights while reducing 65 reads to 33', () => {
    const original = gaussianTaps(32, 13, false),
      paired = gaussianTaps()
    expect(original).toHaveLength(65)
    expect(paired).toHaveLength(33)
    expect(paired.reduce((sum, tap) => sum + tap.weight, 0)).toBeCloseTo(1, 14)
    expect(paired.every((tap) => tap.weight >= 0)).toBe(true)
  })

  it.each([
    [32, 13],
    [7, 2.4],
    [1, 0.5],
    [0, 13],
    [32, 0.01],
  ])(
    'matches discrete convolution including clamped boundaries at radius %s and sigma %s',
    (radius, sigma) => {
      const sources = [
        Array.from({ length: 83 }, (_, i) => Math.sin(i * 1.9) * 0.4 + Math.cos(i * 0.14) ** 2),
        Array.from({ length: 83 }, (_, i) => (i === 0 || i === 82 || i === 30 ? 1 : 0)),
        Array.from({ length: 83 }, (_, i) => ((i * 5317 + 177) % 997) / 997),
      ]
      for (const source of sources)
        for (let x = 0; x < source.length; x++) {
          const convolve = (paired: boolean) =>
            gaussianTaps(radius, sigma, paired).reduce(
              (sum, tap) => sum + tap.weight * sample(source, x + tap.offset),
              0,
            )
          expect(Math.abs(convolve(true) - convolve(false))).toBeLessThan(1e-14)
        }
    },
  )
  it('rejects invalid kernels and remains finite with vanishing outer weights', () => {
    for (const radius of [-1, NaN, 0.5, 129]) expect(() => gaussianTaps(radius)).toThrow()
    for (const sigma of [0, -1, Infinity, NaN]) expect(() => gaussianTaps(32, sigma)).toThrow()
    expect(gaussianTaps(32, Number.MIN_VALUE)).toEqual([{ offset: 0, weight: 1 }])
  })
})

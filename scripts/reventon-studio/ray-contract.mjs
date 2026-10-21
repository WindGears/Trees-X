import assert from 'node:assert/strict'

export const rayContractCases = [
  {
    id: 'hit-miss',
    rays: [
      [0.5, 1, 2, 2],
      [3, 2, 1, 10000],
    ],
  },
  {
    id: 'black-hit-miss',
    rays: [
      [0, 0, 0, 2],
      [4, 3, 2, 10000],
    ],
  },
  {
    id: 'two-hits',
    rays: [
      [0.5, 1, 2, 2],
      [2, 0.25, 0.5, 4],
    ],
  },
  {
    id: 'all-miss',
    rays: [
      [1, 2, 3, 10000],
      [3, 2, 1, 10000],
    ],
  },
]

/** Compare actual raw GPU correction, not a CPU-rendered substitute. */
export function verifyRayContract(native, raw, rays, tolerance = 0.003) {
  assert.ok(native instanceof Float32Array && raw instanceof Float32Array)
  assert.equal(native.length, raw.length)
  assert.equal(native.length % 4, 0)
  assert.equal(rays.length, 2)
  let supportedPixels = 0,
    maximumError = 0,
    maximumScaledError = 0,
    maximumNegativeExpected = 0,
    maximumNegativeActual = 0
  for (let offset = 0; offset < native.length; offset += 4) {
    const support = native[offset + 3]
    assert.ok(Number.isFinite(support), 'Native support must be finite')
    if (!(support > 0)) continue
    supportedPixels++
    for (let channel = 0; channel < 3; channel++) {
      assert.ok(Number.isFinite(native[offset + channel]))
      const expected =
        rays.reduce(
          (sum, ray) =>
            sum +
            (ray[3] > 0 && ray[3] < 9999 ? ray[channel] * support - native[offset + channel] : 0),
          0,
        ) / rays.length
      const actual = raw[offset + channel],
        error = Math.abs(actual - expected),
        scaledError = error / Math.max(1, Math.abs(expected))
      assert.ok(Number.isFinite(actual), 'Raw signed correction must be finite')
      maximumError = Math.max(maximumError, error)
      maximumScaledError = Math.max(maximumScaledError, scaledError)
      maximumNegativeExpected = Math.min(maximumNegativeExpected, expected)
      maximumNegativeActual = Math.min(maximumNegativeActual, actual)
      assert.ok(
        scaledError <= tolerance,
        `Raywise correction mismatch at pixel ${offset / 4}, channel ${channel}: ` +
          `actual=${actual}, expected=${expected}, scaledError=${scaledError}`,
      )
    }
  }
  assert.ok(supportedPixels > 0, 'The actual native MRT crop contains no SSR-supported car pixels')
  return {
    supportedPixels,
    maximumError,
    maximumScaledError,
    maximumNegativeExpected,
    maximumNegativeActual,
    tolerance,
  }
}

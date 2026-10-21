export interface GaussianTap {
  readonly offset: number
  readonly weight: number
}

/** Pair adjacent positive Gaussian weights using the linear sampler's exact
 * weighted offset. Source/destination texel grids must be aligned and use LOD0.
 */
export function gaussianTaps(radius = 32, sigma = 13, paired = true): GaussianTap[] {
  if (!Number.isInteger(radius) || radius < 0 || radius > 128)
    throw new Error('Gaussian radius must be an integer from 0 to 128')
  if (!Number.isFinite(sigma) || sigma <= 0) throw new Error('Gaussian sigma must be positive')
  const weights = Array.from({ length: radius + 1 }, (_, i) => Math.exp(-0.5 * (i / sigma) ** 2)),
    total = weights[0]! + 2 * weights.slice(1).reduce((sum, weight) => sum + weight, 0),
    taps: GaussianTap[] = [{ offset: 0, weight: weights[0]! / total }]
  for (let i = 1; i <= radius; i += paired ? 2 : 1) {
    const first = weights[i]!,
      second = paired ? (weights[i + 1] ?? 0) : 0,
      combined = first + second,
      offset = combined > 0 ? i + second / combined : i
    // Extremely narrow kernels can underflow outer weights to zero.
    if (combined === 0) continue
    taps.push({ offset, weight: combined / total }, { offset: -offset, weight: combined / total })
  }
  return taps
}

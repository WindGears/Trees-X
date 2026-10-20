import type { Node } from 'three/webgpu'
import { float, luminance, mix, smoothstep, vec3, vec4 } from 'three/tsl'

/** Bounded signed luminance keeps HDR second moments finite in HalfFloat.
 * This is a statistics domain only: the actual HDR correction stays signed
 * and is never compressed, positive-clamped or interpreted as hit/miss.
 */
export function reflectionMomentLuminance(color: Node<'vec3'>) {
  const value = luminance(color)
  return value.div(value.abs().add(1))
}

export function reflectionMomentVariance(mean: Node<'float'>, second: Node<'float'>) {
  return second.sub(mean.mul(mean)).max(0)
}

/** Neighborhood distance, rather than a single stochastic ray, rejects a
 * changed reflected surface without treating each hit/miss toggle as motion.
 * A sparse stochastic neighborhood is not a reliable distance-change test.
 * Zero new hits are missing observations, not evidence of changed geometry.
 */
export function reflectionDistanceConfidence(
  current: Node<'float'>,
  previous: Node<'float'>,
  currentCoverage: Node<'float'>,
  previousCoverage: Node<'float'>,
  roughness: Node<'float'>,
) {
  const relative = current.sub(previous).abs().div(current.max(previous).max(0.001)),
    tolerance = roughness.mul(roughness).mul(0.75).add(0.15),
    confidence = smoothstep(tolerance, tolerance.mul(3), relative).oneMinus()
  const reliability = currentCoverage.min(previousCoverage).clamp(0, 1)
  return mix(float(1), confidence, reliability)
}

/** Hard validity gates keep the actual sample count independent of ordinary
 * stochastic confidence fluctuations. Surface rejection remains conservative.
 */
export function reflectionHistoryAccepted(geometry: Node<'float'>, confidence: Node<'float'>) {
  return geometry.greaterThanEqual(0.5).and(confidence.greaterThanEqual(0.1))
}

/** A spatially reused signed correction is also a valid new observation, even
 * when the separate local raw-ray guide contains no hits in this frame.
 */
export function reflectionHasObservation(color: Node<'vec3'>, coverage: Node<'float'>) {
  return coverage.greaterThan(0).or(color.dot(color).greaterThan(0))
}

export function reflectionMissingAge(previous: Node<'float'>, observed: Node<'bool'>) {
  return observed.select(float(0), previous.add(1).min(32))
}

/** Current random misses may not collapse a validated history interval. When
 * hits exist, zero is part of the estimator's possible signed sample range.
 */
export function reflectionAdaptiveClip(
  previous: Node<'vec3'>,
  minimum: Node<'vec3'>,
  maximum: Node<'vec3'>,
  coverage: Node<'float'>,
) {
  return coverage
    .greaterThan(0)
    .select(previous.clamp(minimum.min(vec3(0)), maximum.max(vec3(0))), previous)
}

/** Shared production arithmetic, also exercised with constant TSL inputs.
 * Samples decay toward zero on misses; after 32 consecutive absent observations
 * the correction is exactly zero rather than an unbounded exponential tail.
 */
export function reflectionAdaptiveBlend(
  previous: Node<'vec3'>,
  current: Node<'vec3'>,
  previousCount: Node<'float'>,
  missingAge: Node<'float'>,
) {
  const count = previousCount.add(1).min(32),
    color = mix(previous, current, float(1).div(count))
  return missingAge.lessThan(32).select(vec4(color, count), vec4(0, 0, 0, 1))
}

/** Statistics layout: (consecutive-missing age, bounded second moment,
 * smoothed valid-hit distance, smoothed hit coverage). Mean is reconstructed
 * from filtered signed RGB in the same bounded domain; it is an approximation
 * to E[f(RGB)], not an unbiased estimate. No extra attachment is allocated.
 */
export function reflectionAdaptiveStatistics(
  previous: Node<'vec4'>,
  localSecond: Node<'float'>,
  currentRay: Node<'float'>,
  currentCoverage: Node<'float'>,
  count: Node<'float'>,
  missingAge: Node<'float'>,
) {
  const alpha = float(1).div(count),
    distance = currentCoverage
      .greaterThan(0)
      .select(
        previous.w.greaterThan(0).select(mix(previous.z, currentRay, alpha), currentRay),
        previous.z,
      ),
    result = vec4(
      missingAge,
      mix(previous.y, localSecond, alpha),
      distance,
      mix(previous.w, currentCoverage, alpha),
    )
  return missingAge.lessThan(32).select(result, vec4(32, 0, 0, 0))
}

export function reflectionMomentConfidence(
  currentMean: Node<'float'>,
  currentVariance: Node<'float'>,
  previousMean: Node<'float'>,
  previousSecond: Node<'float'>,
) {
  const sigma = currentVariance
      .add(reflectionMomentVariance(previousMean, previousSecond))
      .add(0.0001)
      .sqrt(),
    difference = currentMean.sub(previousMean).abs()
  return smoothstep(sigma.mul(2).add(0.03), sigma.mul(4).add(0.06), difference).oneMinus()
}

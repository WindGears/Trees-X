import { Box3, Vector3, REVISION } from 'three'
import { loungeMotionBounds, loungeTableDimensions } from '../../loungeSpatialTable'
import {
  reventonMotionEnvelope,
  typewriterRealtimeProfile,
  type RealtimeProductProfile,
} from '../productProfile'

export const ddgiSource = {
  package: 'speedball-gi',
  version: '0.8.0',
  commit: 'a997aee5b0791be61b49719377e811c41720df59',
  license: 'MIT',
  url: 'https://github.com/cl0nazepamm/speedball/tree/a997aee5b0791be61b49719377e811c41720df59',
} as const

export const ddgiBudget = {
  longestAxis: 16,
  raysPerProbe: 64,
  cascades: 1,
  reflectionQuality: 'off',
  maxRaysPerTick: 98_304,
  automaticReduction: false,
} as const

/** Covers the audited complete layout path and the thick experimental table.
 * It does not include the image room: those surfaces contain baked lighting.
 */
export function createDdgiVolume(
  groundY: number | undefined = undefined,
  profile: RealtimeProductProfile = typewriterRealtimeProfile,
) {
  groundY ??= profile.groundY
  if (!Number.isFinite(groundY)) throw new Error('DDGI ground height must be finite')
  const margin = 0.4,
    halfWidth =
      Math.max(
        loungeTableDimensions.width / 2,
        Math.abs(loungeMotionBounds.min[0]),
        loungeMotionBounds.max[0],
      ) + margin,
    halfDepth =
      Math.max(
        loungeTableDimensions.depth / 2,
        Math.abs(loungeMotionBounds.min[2]),
        loungeMotionBounds.max[2],
      ) + margin,
    box =
      profile.ddgiVolume === 'reventon-stage'
        ? new Box3(
            new Vector3(
              reventonMotionEnvelope.min[0] - profile.ddgiMargin,
              Math.min(groundY, reventonMotionEnvelope.min[1]) - profile.ddgiMargin,
              reventonMotionEnvelope.min[2] - profile.ddgiMargin,
            ),
            new Vector3(
              reventonMotionEnvelope.max[0] + profile.ddgiMargin,
              reventonMotionEnvelope.max[1] + profile.ddgiMargin,
              reventonMotionEnvelope.max[2] + profile.ddgiMargin,
            ),
          )
        : new Box3(
            new Vector3(
              -halfWidth,
              groundY -
                loungeTableDimensions.slabHeight -
                loungeTableDimensions.bodyHeight -
                margin,
              -halfDepth,
            ),
            new Vector3(halfWidth, loungeMotionBounds.max[1] + margin, halfDepth),
          ),
    size = box.getSize(new Vector3()),
    longest = Math.max(size.x, size.y, size.z),
    axis = (length: number) =>
      Math.max(2, Math.round((length / longest) * (ddgiBudget.longestAxis - 1)) + 1),
    res = new Vector3(axis(size.x), axis(size.y), axis(size.z))
  // The infinite studio floor extends beyond the finite car volume. Blend back
  // to native environment lighting inside its padding, rather than drawing a
  // hard rectangular illumination patch. The audited motion envelope stays full weight.
  const blendWidth = profile.ddgiVolume === 'reventon-stage' ? profile.ddgiMargin : 0
  return { box, res, probes: res.x * res.y * res.z, blendWidth }
}

export function assertDdgiRevision(revision = REVISION) {
  if (revision !== '185') throw new Error('Speedball 0.8.0 adapter requires reviewed Three r185')
}

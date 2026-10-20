import { DepthTexture, HalfFloatType, Matrix4, REVISION, Source, Vector2 } from 'three'
import {
  RenderTarget,
  type PerspectiveCamera,
  type Node,
  type TextureNode,
  type WebGPURenderer,
} from 'three/webgpu'
import {
  Fn,
  If,
  abs,
  float,
  getViewPosition,
  int,
  ivec2,
  mix,
  outputStruct,
  smoothstep,
  struct,
  texture,
  textureLoad,
  uniform,
  unpackRGBToNormal,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import { createOwnedRtt } from './ownedRtt'
import {
  reflectionNeighborhoodCompatible,
  reflectionRayGuide,
  reflectionRayGuideContribution,
} from './signedSpatial'
import { createSignedHistoryOutput } from './signedHistoryOutput'
import {
  reflectionDistanceConfidence,
  reflectionAdaptiveBlend,
  reflectionAdaptiveClip,
  reflectionAdaptiveStatistics,
  reflectionHasObservation,
  reflectionHistoryAccepted,
  reflectionMissingAge,
  reflectionMomentConfidence,
  reflectionMomentLuminance,
  reflectionMomentVariance,
} from './signedMoments'

export interface SignedHistoryOptions {
  varianceHistory?: boolean
  raw?: TextureNode
}

/** Signed delta history for the pinned r185 pipeline. Geometric four-tap
 * reprojection and the NDC velocity conversion follow Three's MIT-licensed
 * TemporalReprojectNode. RGB is not positive-clamped or interpreted as hit/miss.
 * Unlike that node, all previous-frame resources advance only on final commit.
 */
export function createSignedReflectionHistory(
  renderer: WebGPURenderer,
  camera: PerspectiveCamera,
  signal: TextureNode,
  depth: TextureNode,
  normal: TextureNode,
  velocity: TextureNode,
  options: SignedHistoryOptions = {},
) {
  if (REVISION !== '185') throw new Error('Signed reflection history requires reviewed Three r185')
  if (!(depth.value instanceof DepthTexture))
    throw new Error('Signed history requires native depth')
  const adaptive = options.varianceHistory === true
  if (adaptive && !options.raw) throw new Error('Variance history requires raw reflection guides')
  const raw = adaptive ? options.raw : undefined
  const previousDepth = depth.value.clone()
  previousDepth.name = 'TreesSignedHistory.depth'
  const history = new RenderTarget(1, 1, {
    type: HalfFloatType,
    depthBuffer: false,
    depthTexture: previousDepth,
    count: adaptive ? 2 : 1,
  })
  history.texture.name = 'TreesSignedHistory.previous'
  const previousStatistics = adaptive ? history.textures[1] : undefined
  if (previousStatistics) previousStatistics.name = 'TreesSignedHistory.statistics'
  const previousNormal = normal.value.clone()
  // Texture.copy shares Source and native MRT backreferences. Only this clone
  // owns its allocation/image dimensions, never the upstream normal attachment.
  const normalSize = { width: 1, height: 1, depth: 1 }
  previousNormal.source = new Source(normalSize)
  previousNormal.renderTarget = null
  previousNormal.name = 'TreesSignedHistory.normal'
  previousNormal.generateMipmaps = false
  const historyNode = texture(history.texture),
    previousDepthNode = texture(previousDepth),
    previousNormalNode = texture(previousNormal),
    previousStatisticsNode = previousStatistics ? texture(previousStatistics) : undefined
  const resolution = uniform(new Vector2(1, 1)),
    enabled = uniform(0)
  const inverseProjection = uniform(new Matrix4()),
    world = uniform(new Matrix4()),
    previousInverseProjection = uniform(new Matrix4()),
    previousWorld = uniform(new Matrix4())
  const capturedInverseProjection = new Matrix4(),
    capturedWorld = new Matrix4()
  let prepared = false,
    valid = false,
    disposed = false,
    width = 0,
    height = 0
  const historyResult = struct({ signal: 'vec4', statistics: 'vec4' })

  const resolve = Fn(() => {
    const pixel = ivec2(uv().mul(resolution).floor()),
      coord = vec2(pixel).add(0.5).div(resolution)
    const current = textureLoad(signal, pixel).toConst(),
      currentDepth = textureLoad(depth, pixel).r
    const currentNormalRoughness = textureLoad(normal, pixel).toConst()
    const result = vec4(0).toVar()
    const resultStatistics = adaptive ? vec4(0).toVar() : undefined
    If(current.a.greaterThan(0).and(currentDepth.lessThan(1)), () => {
      const viewPosition = getViewPosition(coord, currentDepth, inverseProjection).toConst(),
        viewNormal = unpackRGBToNormal(currentNormalRoughness.rgb).normalize().toConst(),
        viewZ = viewPosition.z.abs().max(1e-6),
        minimum = current.rgb.toVar(),
        maximum = current.rgb.toVar()
      const firstMoment = adaptive ? reflectionMomentLuminance(current.rgb).toVar() : undefined,
        secondMoment = firstMoment ? firstMoment.mul(firstMoment).toVar() : undefined,
        sampleCount = adaptive ? float(1).toVar() : undefined,
        raySum = raw
          ? reflectionRayGuideContribution(textureLoad(raw, pixel).a).toVar()
          : undefined,
        hitCount = raw
          ? textureLoad(raw, pixel)
              .a.greaterThan(0)
              .and(textureLoad(raw, pixel).a.lessThan(9999))
              .select(float(1), float(0))
              .toVar()
          : undefined
      // Only same-surface neighbors may widen history clipping bounds. An
      // adjacent valid surface is still a different history signal. Legacy
      // history retains its strict current-frame zero clamp. Adaptive history
      // treats stochastic no-hit neighborhoods as absent, bounded observations.
      for (const [x, y] of [
        [-1, -1],
        [0, -1],
        [1, -1],
        [-1, 0],
        [1, 0],
        [-1, 1],
        [0, 1],
        [1, 1],
      ] as const) {
        const tap = pixel.add(ivec2(x, y))
        const inside = tap.x
          .greaterThanEqual(0)
          .and(tap.y.greaterThanEqual(0))
          .and(tap.x.lessThan(int(resolution.x)))
          .and(tap.y.lessThan(int(resolution.y)))
        If(inside, () => {
          const neighbor = textureLoad(signal, tap),
            neighborDepth = textureLoad(depth, tap).r
          If(neighbor.a.greaterThan(0).and(neighborDepth.lessThan(1)), () => {
            const neighborNormalRoughness = textureLoad(normal, tap),
              neighborPosition = getViewPosition(
                vec2(tap).add(0.5).div(resolution),
                neighborDepth,
                inverseProjection,
              ),
              neighborNormal = unpackRGBToNormal(neighborNormalRoughness.rgb).normalize(),
              plane = abs(viewPosition.sub(neighborPosition).dot(viewNormal)).div(viewZ)
            If(
              reflectionNeighborhoodCompatible(
                plane,
                neighborNormal.dot(viewNormal),
                currentNormalRoughness.a.sub(neighborNormalRoughness.a),
              ),
              () => {
                minimum.assign(minimum.min(neighbor.rgb))
                maximum.assign(maximum.max(neighbor.rgb))
                if (firstMoment && secondMoment && sampleCount && raw && raySum && hitCount) {
                  const value = reflectionMomentLuminance(neighbor.rgb),
                    ray = textureLoad(raw, tap).a,
                    hit = ray.greaterThan(0).and(ray.lessThan(9999))
                  firstMoment.addAssign(value)
                  secondMoment.addAssign(value.mul(value))
                  sampleCount.addAssign(1)
                  raySum.addAssign(reflectionRayGuideContribution(ray))
                  hitCount.addAssign(hit.select(1, 0))
                }
              },
            )
          })
        })
      }
      const historySum = vec3(0).toVar(),
        historyCount = float(0).toVar(),
        weights = float(0).toVar(),
        missingAge = adaptive ? float(0).toVar() : undefined
      const localMean =
          firstMoment && sampleCount ? firstMoment.div(sampleCount).toConst() : undefined,
        localSecond =
          secondMoment && sampleCount ? secondMoment.div(sampleCount).toConst() : undefined,
        currentRay = raySum ? reflectionRayGuide(raySum).toConst() : undefined,
        currentCoverage = hitCount && sampleCount ? hitCount.div(sampleCount).toConst() : undefined,
        statisticsSum = adaptive ? vec4(0).toVar() : undefined
      If(enabled.greaterThan(0), () => {
        const worldPosition = world.mul(vec4(viewPosition, 1)).xyz.toConst()
        const worldNormal = world.mul(vec4(viewNormal, 0)).xyz.normalize().toConst()
        const reproj = coord
          .sub(textureLoad(velocity, pixel).rg.mul(vec2(0.5, -0.5)))
          .mul(resolution)
          .sub(0.5)
          .toConst()
        const base = ivec2(reproj.floor()),
          fraction = reproj.fract()
        for (const [x, y] of [
          [0, 0],
          [1, 0],
          [0, 1],
          [1, 1],
        ] as const) {
          const tap = base.add(ivec2(x, y))
          const inside = tap.x
            .greaterThanEqual(0)
            .and(tap.y.greaterThanEqual(0))
            .and(tap.x.lessThan(int(resolution.x)))
            .and(tap.y.lessThan(int(resolution.y)))
          If(inside, () => {
            const old = textureLoad(historyNode, tap),
              oldDepth = textureLoad(previousDepthNode, tap).r
            If(old.a.greaterThan(0).and(oldDepth.lessThan(1)), () => {
              const oldNormalRoughness = textureLoad(previousNormalNode, tap)
              const oldPosition = getViewPosition(
                vec2(tap).add(0.5).div(resolution),
                oldDepth,
                previousInverseProjection,
              )
              const oldWorldPosition = previousWorld.mul(vec4(oldPosition, 1)).xyz
              const oldWorldNormal = previousWorld
                .mul(vec4(unpackRGBToNormal(oldNormalRoughness.rgb), 0))
                .xyz.normalize()
              const plane = abs(oldWorldPosition.sub(worldPosition).dot(worldNormal)).div(
                oldPosition.z.abs().max(1e-6),
              )
              const geometry = smoothstep(0.001, 0.01, plane)
                .oneMinus()
                .mul(smoothstep(0.95, 0.999, oldWorldNormal.dot(worldNormal)))
                .mul(
                  smoothstep(
                    0.05,
                    0.2,
                    abs(oldNormalRoughness.a.sub(currentNormalRoughness.a)),
                  ).oneMinus(),
                )
              const bilinear = (x === 0 ? fraction.x.oneMinus() : fraction.x).mul(
                y === 0 ? fraction.y.oneMinus() : fraction.y,
              )
              const confidence = float(1).toVar()
              const oldStatistics = previousStatisticsNode
                ? textureLoad(previousStatisticsNode, tap).toConst()
                : undefined
              if (oldStatistics && localMean && localSecond && currentRay && currentCoverage) {
                const reliability = currentCoverage.min(oldStatistics.w).clamp(0, 1)
                confidence.assign(
                  mix(
                    float(1),
                    reflectionMomentConfidence(
                      localMean,
                      reflectionMomentVariance(localMean, localSecond),
                      reflectionMomentLuminance(old.rgb),
                      oldStatistics.y,
                    ),
                    reliability,
                  ).mul(
                    reflectionDistanceConfidence(
                      currentRay,
                      oldStatistics.z,
                      currentCoverage,
                      oldStatistics.w,
                      currentNormalRoughness.a,
                    ),
                  ),
                )
              }
              const accepted = reflectionHistoryAccepted(geometry, confidence),
                weight =
                  adaptive && oldStatistics
                    ? accepted.and(oldStatistics.x.lessThan(32)).select(bilinear, float(0))
                    : geometry.mul(bilinear).mul(confidence)
              historySum.addAssign(old.rgb.mul(weight))
              historyCount.addAssign(old.a.min(adaptive ? 32 : 16).mul(weight))
              weights.addAssign(weight)
              if (statisticsSum && oldStatistics) statisticsSum.addAssign(oldStatistics.mul(weight))
              if (missingAge && oldStatistics)
                If(weight.greaterThan(1e-5), () => {
                  missingAge.assign(missingAge.max(oldStatistics.x))
                })
            })
          })
        }
      })
      result.assign(vec4(current.rgb, 1))
      if (resultStatistics && localMean && localSecond && currentRay && currentCoverage) {
        const age = reflectionMissingAge(
          float(0),
          reflectionHasObservation(current.rgb, currentCoverage),
        )
        resultStatistics.assign(
          vec4(
            age,
            localSecond,
            currentCoverage.greaterThan(0).select(currentRay, float(0)),
            currentCoverage,
          ),
        )
      }
      If(weights.greaterThan(1e-5), () => {
        const oldDelta = historySum.div(weights),
          oldCount = historyCount.div(weights)
        let count: Node<'float'>
        if (adaptive && currentCoverage && missingAge) {
          const age = reflectionMissingAge(
              missingAge,
              reflectionHasObservation(current.rgb, currentCoverage),
            ).toConst(),
            blended = reflectionAdaptiveBlend(
              reflectionAdaptiveClip(oldDelta, minimum, maximum, currentCoverage),
              current.rgb,
              oldCount,
              age,
            ).toConst()
          result.assign(blended)
          missingAge.assign(age)
          count = blended.a
        } else {
          count = oldCount.mul(weights.min(1)).add(1).min(16)
          result.assign(
            vec4(mix(oldDelta.clamp(minimum, maximum), current.rgb, float(1).div(count)), count),
          )
        }
        if (
          resultStatistics &&
          statisticsSum &&
          localMean &&
          localSecond &&
          currentRay &&
          currentCoverage
        ) {
          const oldStatistics = statisticsSum.div(weights)
          resultStatistics.assign(
            reflectionAdaptiveStatistics(
              oldStatistics,
              localSecond,
              currentRay,
              currentCoverage,
              count,
              missingAge ?? float(0),
            ),
          )
        }
      })
    })
    return resultStatistics ? historyResult(result, resultStatistics) : result
  })()
  let adaptiveOutput: ReturnType<typeof createSignedHistoryOutput> | undefined,
    output: ReturnType<typeof createOwnedRtt>
  try {
    adaptiveOutput = adaptive
      ? createSignedHistoryOutput(outputStruct(resolve.get('signal'), resolve.get('statistics')))
      : undefined
    output = adaptiveOutput ?? createOwnedRtt(resolve)
  } catch (error) {
    history.dispose()
    previousNormal.dispose()
    throw error
  }
  output.node.value.name = 'TreesX.Reflection.filteredDelta'

  return {
    node: output.node,
    prepare(nextWidth: number, nextHeight: number) {
      if (disposed) throw new Error('Signed reflection history has been disposed')
      if (
        !Number.isInteger(nextWidth) ||
        !Number.isInteger(nextHeight) ||
        nextWidth < 1 ||
        nextHeight < 1
      )
        throw new Error('Signed reflection history requires positive pixel dimensions')
      // prepare supersedes an uncommitted (failed/cancelled) frame. It never
      // copies signal data or advances the last successful camera transforms.
      prepared = false
      if (width !== nextWidth || height !== nextHeight) {
        valid = false
        width = nextWidth
        height = nextHeight
        history.setSize(width, height)
        previousDepth.image.width = width
        previousDepth.image.height = height
        normalSize.width = width
        normalSize.height = height
        previousNormal.needsUpdate = true
        try {
          renderer.initRenderTarget(history)
          renderer.initTexture(previousNormal)
        } catch (error) {
          width = height = 0
          enabled.value = 0
          throw error
        }
        resolution.value.set(width, height)
      }
      capturedInverseProjection.copy(camera.projectionMatrixInverse)
      capturedWorld.copy(camera.matrixWorld)
      inverseProjection.value.copy(capturedInverseProjection)
      world.value.copy(capturedWorld)
      enabled.value = valid ? 1 : 0
      prepared = true
    },
    commitFrame() {
      if (disposed || !prepared) throw new Error('Signed reflection history has no prepared frame')
      // These submit GPU copies on the existing device/clock; no pixel readback.
      // A failed copy invalidates history so partially copied guides cannot leak.
      prepared = false
      valid = false
      try {
        renderer.copyTextureToTexture(output.node.value, history.texture)
        if (adaptiveOutput && previousStatistics)
          renderer.copyTextureToTexture(adaptiveOutput.statistics.value, previousStatistics)
        renderer.copyTextureToTexture(depth.value, previousDepth)
        renderer.copyTextureToTexture(normal.value, previousNormal)
        previousInverseProjection.value.copy(capturedInverseProjection)
        previousWorld.value.copy(capturedWorld)
        valid = true
      } catch (error) {
        enabled.value = 0
        throw error
      }
    },
    cancelFrame() {
      prepared = false
    },
    resetHistory() {
      if (disposed) return
      // Reject the old pose without reallocating targets or recompiling the graph.
      prepared = false
      valid = false
      enabled.value = 0
    },
    snapshot: () => ({
      prepared,
      valid,
      enabled: enabled.value,
      width,
      height,
      varianceHistory: adaptive,
      maxHistory: adaptive ? 32 : 16,
      statisticsBytes: adaptive ? width * height * 16 : 0,
    }),
    dispose() {
      if (disposed) return
      disposed = true
      prepared = false
      valid = false
      output.dispose()
      history.dispose()
      previousNormal.dispose()
    },
  }
}

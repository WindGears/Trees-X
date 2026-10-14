import { DepthTexture, HalfFloatType, Matrix4, REVISION, Source, Vector2 } from 'three'
import {
  RenderTarget,
  type PerspectiveCamera,
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
  smoothstep,
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
) {
  if (REVISION !== '185') throw new Error('Signed reflection history requires reviewed Three r185')
  if (!(depth.value instanceof DepthTexture))
    throw new Error('Signed history requires native depth')
  const previousDepth = depth.value.clone()
  previousDepth.name = 'TreesSignedHistory.depth'
  const history = new RenderTarget(1, 1, {
    type: HalfFloatType,
    depthBuffer: false,
    depthTexture: previousDepth,
  })
  history.texture.name = 'TreesSignedHistory.previous'
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
    previousNormalNode = texture(previousNormal)
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

  const resolve = Fn(() => {
    const pixel = ivec2(uv().mul(resolution).floor()),
      coord = vec2(pixel).add(0.5).div(resolution)
    const current = textureLoad(signal, pixel).toConst(),
      currentDepth = textureLoad(depth, pixel).r
    const currentNormalRoughness = textureLoad(normal, pixel).toConst()
    const result = vec4(0).toVar()
    If(current.a.greaterThan(0).and(currentDepth.lessThan(1)), () => {
      const minimum = current.rgb.toVar(),
        maximum = current.rgb.toVar()
      // Unsupported neighboring surfaces supply neither clipping bounds nor
      // history. A zero current neighborhood clips stale delta exactly to zero.
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
          const neighbor = textureLoad(signal, tap)
          If(neighbor.a.greaterThan(0).and(textureLoad(depth, tap).r.lessThan(1)), () => {
            minimum.assign(minimum.min(neighbor.rgb))
            maximum.assign(maximum.max(neighbor.rgb))
          })
        })
      }
      const historySum = vec3(0).toVar(),
        historyCount = float(0).toVar(),
        weights = float(0).toVar()
      If(enabled.greaterThan(0), () => {
        const viewPosition = getViewPosition(coord, currentDepth, inverseProjection)
        const worldPosition = world.mul(vec4(viewPosition, 1)).xyz.toConst()
        const worldNormal = world
          .mul(vec4(unpackRGBToNormal(currentNormalRoughness.rgb), 0))
          .xyz.normalize()
          .toConst()
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
              const weight = geometry.mul(bilinear)
              historySum.addAssign(old.rgb.mul(weight))
              historyCount.addAssign(old.a.min(16).mul(weight))
              weights.addAssign(weight)
            })
          })
        }
      })
      result.assign(vec4(current.rgb, 1))
      If(weights.greaterThan(1e-5), () => {
        const oldDelta = historySum.div(weights).clamp(minimum, maximum)
        const count = historyCount.div(weights).mul(weights.min(1)).add(1).min(16)
        result.assign(vec4(mix(oldDelta, current.rgb, float(1).div(count)), count))
      })
    })
    return result
  })()
  const output = createOwnedRtt(resolve)
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

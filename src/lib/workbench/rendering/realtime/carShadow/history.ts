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
  vec4,
} from 'three/tsl'
import { createOwnedRtt } from '../ownedRtt'

/** Dedicated visibility history. No source texture, renderer or clock is owned.
 * Motion conversion and four-tap reprojection follow Three r185's MIT node;
 * history only advances after the host has completed its final beauty frame.
 */
export function createCarShadowHistory(
  renderer: WebGPURenderer,
  camera: PerspectiveCamera,
  signal: TextureNode,
  depth: TextureNode,
  normal: TextureNode,
  velocity: TextureNode,
) {
  if (REVISION !== '185') throw new Error('Car shadow history requires reviewed Three r185')
  if (!(depth.value instanceof DepthTexture))
    throw new Error('Car shadow history requires native depth')
  const depthSize = { width: 1, height: 1, depth: 1 },
    normalSize = { width: 1, height: 1, depth: 1 },
    previousDepth = depth.value.clone(),
    previousNormal = normal.value.clone()
  previousDepth.source = new Source(depthSize)
  previousDepth.renderTarget = null
  previousDepth.name = 'TreesX.CarShadow.previousDepth'
  previousNormal.source = new Source(normalSize)
  previousNormal.renderTarget = null
  previousNormal.name = 'TreesX.CarShadow.previousNormal'
  previousNormal.generateMipmaps = false
  const history = new RenderTarget(1, 1, {
    type: HalfFloatType,
    depthBuffer: false,
    depthTexture: previousDepth,
  })
  history.texture.name = 'TreesX.CarShadow.previousVisibility'
  const previous = texture(history.texture),
    oldDepth = texture(previousDepth),
    oldNormal = texture(previousNormal),
    resolution = uniform(new Vector2(1, 1)),
    enabled = uniform(0),
    inverseProjection = uniform(new Matrix4()),
    world = uniform(new Matrix4()),
    oldInverseProjection = uniform(new Matrix4()),
    oldWorld = uniform(new Matrix4()),
    capturedInverse = new Matrix4(),
    capturedWorld = new Matrix4()
  let width = 0,
    height = 0,
    valid = false,
    prepared = false,
    disposed = false,
    committedFrames = 0
  const expression = Fn(() => {
    const pixel = ivec2(uv().mul(resolution).floor()),
      coord = vec2(pixel).add(0.5).div(resolution),
      z = textureLoad(depth, pixel).r,
      current = textureLoad(signal, pixel).r.clamp(0, 1).toConst(),
      result = vec4(1, 1, 1, 0).toVar()
    If(z.lessThan(1), () => {
      const packed = textureLoad(normal, pixel),
        n = unpackRGBToNormal(packed.rgb).normalize().toConst(),
        position = getViewPosition(coord, z, inverseProjection).toConst(),
        worldPosition = world.mul(vec4(position, 1)).xyz.toConst(),
        worldNormal = world.mul(vec4(n, 0)).xyz.normalize().toConst(),
        minimum = current.toVar(),
        maximum = current.toVar()
      // Visibility is bounded by only compatible current-frame surfaces. A
      // background pixel or adjacent body panel cannot widen the history clamp.
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
        const tap = pixel.add(ivec2(x, y)),
          inside = tap.x
            .greaterThanEqual(0)
            .and(tap.y.greaterThanEqual(0))
            .and(tap.x.lessThan(int(resolution.x)))
            .and(tap.y.lessThan(int(resolution.y)))
        If(inside, () => {
          const nz = textureLoad(depth, tap).r
          If(nz.lessThan(1), () => {
            const np = getViewPosition(vec2(tap).add(0.5).div(resolution), nz, inverseProjection),
              nn = unpackRGBToNormal(textureLoad(normal, tap).rgb).normalize(),
              plane = abs(np.sub(position).dot(n)).div(position.z.abs().max(1e-6))
            If(plane.lessThanEqual(0.001).and(nn.dot(n).greaterThanEqual(0.95)), () => {
              const value = textureLoad(signal, tap).r.clamp(0, 1)
              minimum.assign(minimum.min(value))
              maximum.assign(maximum.max(value))
            })
          })
        })
      }
      const sum = float(0).toVar(),
        countSum = float(0).toVar(),
        weights = float(0).toVar()
      If(enabled.greaterThan(0), () => {
        const reprojection = coord
            .sub(textureLoad(velocity, pixel).rg.mul(vec2(0.5, -0.5)))
            .mul(resolution)
            .sub(0.5)
            .toConst(),
          base = ivec2(reprojection.floor()),
          fraction = reprojection.fract()
        for (const [x, y] of [
          [0, 0],
          [1, 0],
          [0, 1],
          [1, 1],
        ] as const) {
          const tap = base.add(ivec2(x, y)),
            inside = tap.x
              .greaterThanEqual(0)
              .and(tap.y.greaterThanEqual(0))
              .and(tap.x.lessThan(int(resolution.x)))
              .and(tap.y.lessThan(int(resolution.y)))
          If(inside, () => {
            const previousValue = textureLoad(previous, tap),
              previousZ = textureLoad(oldDepth, tap).r
            If(previousValue.a.greaterThan(0).and(previousZ.lessThan(1)), () => {
              const previousPosition = getViewPosition(
                  vec2(tap).add(0.5).div(resolution),
                  previousZ,
                  oldInverseProjection,
                ),
                previousWorldPosition = oldWorld.mul(vec4(previousPosition, 1)).xyz,
                previousWorldNormal = oldWorld
                  .mul(vec4(unpackRGBToNormal(textureLoad(oldNormal, tap).rgb), 0))
                  .xyz.normalize(),
                delta = previousWorldPosition.sub(worldPosition),
                scale = position.z.abs().max(1e-6),
                plane = abs(delta.dot(worldNormal)).div(scale),
                distance = delta.length().div(scale),
                confidence = smoothstep(0.0002, 0.003, plane)
                  .oneMinus()
                  .mul(smoothstep(0.005, 0.03, distance).oneMinus())
                  .mul(smoothstep(0.95, 0.999, previousWorldNormal.dot(worldNormal))),
                bilinear = (x === 0 ? fraction.x.oneMinus() : fraction.x).mul(
                  y === 0 ? fraction.y.oneMinus() : fraction.y,
                ),
                weight = confidence.mul(bilinear)
              sum.addAssign(previousValue.r.mul(weight))
              countSum.addAssign(previousValue.a.min(8).mul(weight))
              weights.addAssign(weight)
            })
          })
        }
      })
      const visibility = current.toVar(),
        count = float(1).toVar()
      If(weights.greaterThan(1e-5), () => {
        count.assign(countSum.div(weights).mul(weights.min(1)).add(1).min(8))
        visibility.assign(
          mix(sum.div(weights).clamp(minimum, maximum), current, float(1).div(count)),
        )
      })
      result.assign(vec4(visibility, visibility, visibility, count))
    })
    return result
  })()
  let output: ReturnType<typeof createOwnedRtt>
  try {
    output = createOwnedRtt(expression)
  } catch (error) {
    history.dispose()
    previousNormal.dispose()
    throw error
  }
  output.node.value.name = 'TreesX.CarShadow.filteredVisibility'
  return {
    node: output.node,
    prepare(nextWidth: number, nextHeight: number) {
      if (disposed) throw new Error('Car shadow history has been disposed')
      if (
        !Number.isInteger(nextWidth) ||
        !Number.isInteger(nextHeight) ||
        nextWidth < 1 ||
        nextHeight < 1
      )
        throw new Error('Car shadow history requires positive pixel dimensions')
      prepared = false
      if (width !== nextWidth || height !== nextHeight) {
        valid = false
        enabled.value = 0
        width = nextWidth
        height = nextHeight
        history.setSize(width, height)
        depthSize.width = normalSize.width = width
        depthSize.height = normalSize.height = height
        previousNormal.needsUpdate = true
        try {
          renderer.initRenderTarget(history)
          renderer.initTexture(previousNormal)
        } catch (error) {
          width = height = 0
          throw error
        }
        resolution.value.set(width, height)
      }
      capturedInverse.copy(camera.projectionMatrixInverse)
      capturedWorld.copy(camera.matrixWorld)
      inverseProjection.value.copy(capturedInverse)
      world.value.copy(capturedWorld)
      enabled.value = valid ? 1 : 0
      prepared = true
    },
    commitFrame() {
      if (disposed || !prepared) throw new Error('Car shadow history has no prepared frame')
      prepared = false
      valid = false
      enabled.value = 0
      renderer.copyTextureToTexture(output.node.value, history.texture)
      renderer.copyTextureToTexture(depth.value, previousDepth)
      renderer.copyTextureToTexture(normal.value, previousNormal)
      oldInverseProjection.value.copy(capturedInverse)
      oldWorld.value.copy(capturedWorld)
      valid = true
      committedFrames++
    },
    cancelFrame() {
      prepared = false
    },
    resetHistory() {
      if (!disposed) {
        prepared = false
        valid = false
        enabled.value = 0
      }
    },
    snapshot: () => ({
      width,
      height,
      prepared,
      valid,
      enabled: enabled.value,
      maxHistory: 8,
      committedFrames,
    }),
    dispose() {
      if (disposed) return
      disposed = true
      prepared = valid = false
      output.dispose()
      history.dispose()
      previousNormal.dispose()
    },
  }
}

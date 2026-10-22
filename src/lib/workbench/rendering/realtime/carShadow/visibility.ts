import { Matrix4, REVISION, Vector2, Vector3 } from 'three'
import type {
  Node,
  PerspectiveCamera,
  RectAreaLight,
  TextureNode,
  WebGPURenderer,
} from 'three/webgpu'
import {
  Fn,
  If,
  cross,
  dFdx,
  dFdy,
  float,
  getViewPosition,
  interleavedGradientNoise,
  ivec2,
  textureLoad,
  uniform,
  unpackRGBToNormal,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import { compileOwnedRtt, createOwnedRtt, isolateOwnedRttMrt, resizeOwnedRtt } from '../ownedRtt'
import { createCarShadowHistory } from './history'

export interface CarShadowSurfaceInputs {
  depth: TextureNode
  normal: TextureNode
  velocity: TextureNode
  /** Shadow-only surface output alpha: one for opaque car receivers, zero otherwise. */
  receiverMask?: TextureNode
}
export interface CarShadowRayQuery {
  occluded(origin: Node<'vec3'>, direction: Node<'vec3'>, maxDistance: Node<'float'>): Node<'bool'>
}

/** Full-resolution, two-sample rectangular-light visibility, composed solely
 * through the host graph. This is a direct-light occlusion approximation, not
 * a sampled Physical BRDF or a global multiplier for indirect illumination.
 */
export function createCarShadowVisibility(
  renderer: WebGPURenderer,
  camera: PerspectiveCamera,
  inputs: CarShadowSurfaceInputs,
  light: RectAreaLight,
  bvh: CarShadowRayQuery,
) {
  if (REVISION !== '185') throw new Error('Car shadow visibility requires reviewed Three r185')
  const resolution = uniform(new Vector2(1, 1)),
    inverseProjection = uniform(new Matrix4()),
    world = uniform(new Matrix4()),
    lightPosition = uniform(new Vector3()),
    lightWidth = uniform(new Vector3()),
    lightHeight = uniform(new Vector3()),
    sequence = uniform(0)
  let frames = 0,
    prepared = false,
    disposed = false
  const raw = createOwnedRtt(
    Fn(() => {
      const pixel = ivec2(uv().mul(resolution).floor()),
        coord = vec2(pixel).add(0.5).div(resolution),
        depth = textureLoad(inputs.depth, pixel).r,
        viewPosition = getViewPosition(coord, depth, inverseProjection).toConst(),
        position = world.mul(vec4(viewPosition, 1)).xyz.toConst(),
        // Derivatives are evaluated before divergent ray conditions. Micro-normal
        // texture detail is used only to orient/fallback this geometric bias.
        derivative = cross(dFdx(position), dFdy(position)).toConst(),
        shadingNormal = world
          .mul(vec4(unpackRGBToNormal(textureLoad(inputs.normal, pixel).rgb), 0))
          .xyz.normalize()
          .toConst(),
        geometric = derivative
          .dot(derivative)
          .greaterThan(1e-14)
          .select(derivative.normalize(), shadingNormal)
          .toVar(),
        visibility = float(1).toVar()
      If(geometric.dot(shadingNormal).lessThan(0), () => {
        geometric.assign(geometric.negate())
      })
      const receiver = inputs.receiverMask
        ? textureLoad(inputs.receiverMask, pixel).a.greaterThan(0)
        : depth.lessThan(1)
      If(depth.lessThan(1).and(receiver), () => {
        const sum = float(0).toVar()
        for (const sample of [0, 1] as const) {
          // Two stratified, independent dimensions. Only successful complete
          // frames advance the temporal Cranley-Patterson offsets.
          const u = interleavedGradientNoise(vec2(pixel).add(vec2(17.31 * sample, 41.73)))
              .add(sequence.mul(0.754877666))
              .fract()
              .add(sample)
              .mul(0.5),
            v = interleavedGradientNoise(vec2(pixel).add(vec2(83.91, 29.47 * sample + 13.27)))
              .add(sequence.mul(0.569840291))
              .fract(),
            target = lightPosition
              .add(lightWidth.mul(u.mul(2).sub(1)))
              .add(lightHeight.mul(v.mul(2).sub(1))),
            toLight = target.sub(position),
            distance = toLight.length().max(1e-6),
            direction = toLight.div(distance),
            slope = geometric.dot(direction).abs().clamp(0, 1).oneMinus(),
            epsilon = float(0.0008).mul(slope.mul(3).add(1)),
            origin = position.add(geometric.mul(epsilon)),
            sampleVisibility = float(1).toVar()
          If(geometric.dot(direction).greaterThan(0), () => {
            const blocked = bvh.occluded(origin, direction, distance.sub(epsilon.mul(2)).max(1e-6))
            sampleVisibility.assign(blocked.select(0, 1))
          })
          sum.addAssign(sampleVisibility)
        }
        visibility.assign(sum.mul(0.5))
      })
      return vec4(vec3(visibility), 1)
    })(),
  )
  raw.node.value.name = 'TreesX.CarShadow.rawVisibility'
  let history: ReturnType<typeof createCarShadowHistory>
  try {
    history = createCarShadowHistory(
      renderer,
      camera,
      raw.node,
      inputs.depth,
      inputs.normal,
      inputs.velocity,
    )
  } catch (error) {
    raw.dispose()
    throw error
  }
  const restoreRawMrt = isolateOwnedRttMrt(raw.node),
    restoreHistoryMrt = isolateOwnedRttMrt(history.node)
  return {
    node: history.node,
    async prepareShaders(signal?: AbortSignal) {
      const check = () => {
        signal?.throwIfAborted()
        if (disposed) throw new Error('Car shadow visibility has been disposed')
      }
      check()
      // Parent beauty may not visit its conditional shadow branch at setup.
      // Bootstrap and compile both real RTTs inside guarded preparation.
      await compileOwnedRtt(renderer, raw.node)
      check()
      await compileOwnedRtt(renderer, history.node)
      check()
    },
    prepare(width: number, height: number) {
      if (disposed) throw new Error('Car shadow visibility has been disposed')
      prepared = false
      history.prepare(width, height)
      resizeOwnedRtt(renderer, raw.node, width, height)
      resizeOwnedRtt(renderer, history.node, width, height)
      resolution.value.set(width, height)
      inverseProjection.value.copy(camera.projectionMatrixInverse)
      world.value.copy(camera.matrixWorld)
      lightPosition.value.setFromMatrixPosition(light.matrixWorld)
      lightWidth.value
        .setFromMatrixColumn(light.matrixWorld, 0)
        .normalize()
        .multiplyScalar(light.width * 0.5)
      lightHeight.value
        .setFromMatrixColumn(light.matrixWorld, 1)
        .normalize()
        .multiplyScalar(light.height * 0.5)
      sequence.value = frames % 1048576
      prepared = true
    },
    commitFrame() {
      if (disposed || !prepared) throw new Error('Car shadow visibility has no prepared frame')
      prepared = false
      history.commitFrame()
      frames++
    },
    cancelFrame() {
      prepared = false
      history.cancelFrame()
    },
    resetHistory() {
      prepared = false
      history.resetHistory()
    },
    snapshot: () => ({ ...history.snapshot(), frames, sequence: sequence.value, samples: 2 }),
    dispose() {
      if (disposed) return
      disposed = true
      prepared = false
      restoreHistoryMrt()
      restoreRawMrt()
      history.dispose()
      raw.dispose()
    },
  }
}

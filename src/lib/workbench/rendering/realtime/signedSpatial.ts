import { Vector2 } from 'three'
import type { Node, PerspectiveCamera, TextureNode } from 'three/webgpu'
import {
  Fn,
  If,
  Loop,
  abs,
  atan,
  cos,
  cross,
  float,
  getScreenPosition,
  getViewPosition,
  interleavedGradientNoise,
  ivec2,
  luminance,
  mix,
  normalize,
  reflect,
  sin,
  textureLoad,
  uniform,
  unpackRGBToNormal,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import { createOwnedRtt } from './ownedRtt'
import { createReflectionSampling, type ReflectionKernel } from './reflectionSampling'

/** Signed correction only: the native Physical environment is never filtered.
 * Geometric lobe/depth/roughness guides follow Three r185 RecurrentDenoiseNode
 * (MIT). This bounded eight-tap filter deliberately has no adaptive kernel,
 * positive radiance clamp or inverse-luminance payload weighting.
 */
export function createSignedReflectionSpatial(
  reflection: TextureNode,
  nativeSingle: TextureNode,
  depth: TextureNode,
  normal: TextureNode,
  camera: PerspectiveCamera,
  kernel: ReflectionKernel = 'rotating',
) {
  const sampling = createReflectionSampling(kernel)
  const resolution = uniform(new Vector2(1, 1)).onRenderUpdate(({ renderer }, self) => {
    if (!renderer) throw new Error('Signed reflection needs the existing render frame')
    return renderer.getDrawingBufferSize(self.value)
  })
  const projection = uniform(camera.projectionMatrix.clone()).onRenderUpdate((_frame, self) =>
    self.value.copy(camera.projectionMatrix),
  )
  const inverseProjection = uniform(camera.projectionMatrixInverse.clone()).onRenderUpdate(
    (_frame, self) => self.value.copy(camera.projectionMatrixInverse),
  )
  const read = (coord: Node<'vec2'>) => {
    const pixel = ivec2(coord.mul(resolution).floor()),
      pixelUv = vec2(pixel).add(0.5).div(resolution),
      native = textureLoad(nativeSingle, pixel).toConst(),
      ray = textureLoad(reflection, pixel).toConst(),
      z = textureLoad(depth, pixel).r.toConst(),
      packed = textureLoad(normal, pixel).toConst()
    const inside = coord.x
      .greaterThanEqual(0)
      .and(coord.x.lessThan(1))
      .and(coord.y.greaterThanEqual(0))
      .and(coord.y.lessThan(1))
    const supported = inside.and(z.lessThan(1)).and(native.a.greaterThan(0))
    const hit = ray.a.greaterThan(0).and(ray.a.lessThan(9999))
    return {
      pixel,
      uv: pixelUv,
      z,
      packed,
      ray,
      supported,
      nativeLuma: luminance(native.rgb),
      delta: supported.and(hit).select(ray.rgb.mul(native.a).sub(native.rgb), vec3(0)),
    }
  }
  const raw = createOwnedRtt(
    Fn(() => {
      const value = read(uv())
      return vec4(value.delta, value.ray.a)
    })(),
  )
  raw.node.value.name = 'TreesX.Reflection.rawDelta'

  const expression = Fn(() => {
    const center = read(uv()),
      result = vec3(0).toVar()
    If(center.supported, () => {
      const n = unpackRGBToNormal(center.packed.rgb).normalize(),
        position = getViewPosition(center.uv, center.z, inverseProjection).toConst(),
        viewZ = position.z.abs().max(1e-6),
        roughness = center.packed.a.toConst(),
        rayLength = center.ray.a.greaterThan(1000).select(0.25, center.ray.a).max(0.001),
        view = normalize(position).negate(),
        dominant = normalize(mix(n, reflect(view.negate(), n), roughness.oneMinus())),
        reflected = reflect(dominant.negate(), n),
        tangent = cross(n, reflected).toVar()
      If(tangent.dot(tangent).lessThan(1e-8), () => {
        const up = n.z
          .abs()
          .lessThan(0.999)
          .select(vec3(0, 0, 1), vec3(0, 1, 0))
        tangent.assign(cross(up, n))
      })
      tangent.assign(tangent.normalize())
      const bitangent = cross(reflected, tangent),
        angle = n.z
          .abs()
          .clamp(0, 1)
          .acos()
          .div(Math.PI * 0.5),
        radius = rayLength.mul(viewZ).mul(roughness.sqrt().max(0.01)).mul(0.5),
        T = tangent.mul(mix(float(1), roughness, angle)).mul(radius),
        B = bitangent.mul(radius),
        lobe = atan(roughness.pow(2).mul(Math.sqrt(99))).max(1.5 / 255),
        falloff = float(8).div(lobe.pow(2)),
        rotation =
          kernel === 'rotating'
            ? interleavedGradientNoise(vec2(center.pixel))
                .mul(Math.PI * 2)
                .add(sampling.phase)
                .toConst()
            : float(0),
        sum = textureLoad(raw.node, center.pixel).rgb.toVar(),
        total = float(1).toVar()
      Loop(8, ({ i }) => {
        const index = float(i).add(0.5),
          theta = index.mul(2.399827721492203).add(rotation),
          disk = vec2(cos(theta), sin(theta)).mul(index.div(8).sqrt()),
          projected = getScreenPosition(position.add(B.mul(disk.x).add(T.mul(disk.y))), projection),
          neighbor = read(projected)
        If(neighbor.supported, () => {
          const nextPosition = getViewPosition(neighbor.uv, neighbor.z, inverseProjection),
            nextNormal = unpackRGBToNormal(neighbor.packed.rgb).normalize(),
            plane = abs(position.sub(nextPosition).dot(n)),
            depthStop = plane.mul(n.z.abs()).mul(2500).div(viewZ),
            roughnessStop = roughness.sub(neighbor.packed.a).abs().mul(100),
            lumaStop = center.nativeLuma.sub(neighbor.nativeLuma).abs().mul(50),
            normalWeight = nextNormal.dot(n).sub(1).mul(falloff).exp(),
            weight = depthStop.add(roughnessStop).add(lumaStop).negate().exp().mul(normalWeight)
          // Unsupported/out-of-screen taps affect neither numerator nor denominator.
          // Misses carry exact zero; true black hits retain their negative correction.
          sum.addAssign(textureLoad(raw.node, neighbor.pixel).rgb.mul(weight))
          total.addAssign(weight)
        })
      })
      result.assign(sum.div(total))
    })
    return vec4(result, center.supported.select(1, 0))
  })()
  const spatial = createOwnedRtt(expression)
  spatial.node.value.name = 'TreesX.Reflection.spatialDelta'
  let disposed = false
  return {
    raw: raw.node,
    node: spatial.node,
    prepare: sampling.prepare,
    commitFrame: sampling.commitFrame,
    cancelFrame: sampling.cancelFrame,
    snapshot: sampling.snapshot,
    dispose() {
      if (disposed) return
      disposed = true
      sampling.dispose()
      spatial.dispose()
      raw.dispose()
    },
  }
}

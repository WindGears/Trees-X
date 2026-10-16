import {
  BackSide,
  Box3,
  BoxGeometry,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  Vector3,
  type Texture,
} from 'three'
import { MeshBasicNodeMaterial, type Node } from 'three/webgpu'
import { equirectUV, mix, positionWorld, smoothstep, texture, vec2, vec3 } from 'three/tsl'

export type LoungePoint = readonly [number, number, number]
export interface FiniteLoungeProjectionOptions {
  min: LoungePoint
  max: LoungePoint
  captureOrigin: LoungePoint
  longitudeOffset?: number
}
export interface LoungeDepthCalibration {
  origin: LoungePoint
  scale: number
  minRadius: number
  maxRadius: number
  maxDepthRatio?: number
  longitudeOffset?: number
}
export interface DepthLoungeProjectionOptions {
  depth: Float32Array
  width: number
  height: number
  calibration: LoungeDepthCalibration
  fallbackBounds?: Pick<FiniteLoungeProjectionOptions, 'min' | 'max'>
  fallbackImage?: Texture
  segments?: { longitude: number; latitude: number }
}

function imageMaterial(image: Texture, origin: LoungePoint, longitudeOffset = 0) {
  const material = new MeshBasicNodeMaterial({
    side: BackSide,
    depthWrite: true,
    depthTest: true,
    toneMapped: false,
    fog: false,
  })
  const direction = positionWorld.sub(vec3(...origin)).normalize(),
    coordinate = equirectUV(direction)
  // Original radiance only. No scene lights, fixed mip-level blur, or inferred relighting.
  const longitude = coordinate.x.add(longitudeOffset).fract(),
    distance = longitude.min(longitude.oneMinus()),
    sample = (u: Node<'float'>) => texture(image, vec2(u, coordinate.y)).rgb,
    seam = texture(image, vec2(0.012, coordinate.y))
      .rgb.add(texture(image, vec2(0.988, coordinate.y)).rgb)
      .mul(0.5)
  material.colorNode = mix(sample(longitude), seam, smoothstep(0, 0.012, distance).oneMinus())
  material.name = 'TreesXFiniteLoungeImage'
  return material
}

/** Finite surfaces create translational parallax; the image is borrowed, never disposed. */
export function createFiniteLoungeProjection(
  image: Texture,
  options: FiniteLoungeProjectionOptions,
) {
  const min = new Vector3(...options.min),
    max = new Vector3(...options.max),
    size = new Vector3().subVectors(max, min)
  if (
    ![
      ...min.toArray(),
      ...max.toArray(),
      ...options.captureOrigin,
      options.longitudeOffset ?? 0,
    ].every(Number.isFinite) ||
    Math.min(...size.toArray()) <= 0
  )
    throw new Error('有限房间边界无效')
  const geometry = new BoxGeometry(size.x, size.y, size.z, 16, 8, 16),
    material = imageMaterial(image, options.captureOrigin, options.longitudeOffset),
    mesh = new Mesh(geometry, material),
    group = new Group()
  mesh.position.addVectors(min, max).multiplyScalar(0.5)
  mesh.name = 'Trees X / finite image room'
  mesh.userData.traceExclude = true
  group.name = 'Trees X / finite lounge projection'
  group.add(mesh)
  let disposed = false
  return {
    group,
    mesh,
    bounds: new Box3(min, max),
    dispose() {
      if (disposed) return
      disposed = true
      group.removeFromParent()
      group.clear()
      geometry.dispose()
      material.dispose()
    },
  }
}

/** Pixel rows are top-to-bottom, values are radial distances before uniform scale. */
export function createRadialLoungeGeometry(options: DepthLoungeProjectionOptions) {
  const { depth, width, height, calibration } = options
  const longitude = options.segments?.longitude ?? Math.min(width, 256),
    latitude = options.segments?.latitude ?? Math.min(height - 1, 128),
    ratio = calibration.maxDepthRatio ?? 1.35
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 4 ||
    height < 3 ||
    depth.length !== width * height ||
    !Number.isInteger(longitude) ||
    !Number.isInteger(latitude) ||
    longitude < 4 ||
    latitude < 2 ||
    ![
      ...calibration.origin,
      calibration.scale,
      calibration.minRadius,
      calibration.maxRadius,
      calibration.longitudeOffset ?? 0,
      ratio,
    ].every(Number.isFinite) ||
    calibration.scale <= 0 ||
    calibration.minRadius <= 0 ||
    calibration.maxRadius <= calibration.minRadius ||
    ratio <= 1
  )
    throw new Error('全景径向深度或标定无效')
  const positions: number[] = [],
    coordinates: number[] = [],
    radii: number[] = [],
    indices: number[] = [],
    stride = longitude + 1,
    offset = calibration.longitudeOffset ?? 0
  let invalidSamples = 0,
    rejectedTriangles = 0,
    smallestRadius = Infinity,
    largestRadius = 0
  for (let y = 0; y <= latitude; y++) {
    const v = 1 - y / latitude,
      row = Math.min(height - 1, Math.round((y / latitude) * (height - 1))),
      elevation = (v - 0.5) * Math.PI,
      horizontal = Math.cos(elevation)
    for (let x = 0; x <= longitude; x++) {
      const u = x / longitude,
        column = Math.round((x / longitude) * width) % width,
        raw = depth[row * width + column]!,
        valid = Number.isFinite(raw) && raw > 0,
        radius = valid
          ? Math.max(
              calibration.minRadius,
              Math.min(calibration.maxRadius, raw * calibration.scale),
            )
          : calibration.maxRadius,
        angle = (u - offset - 0.5) * 2 * Math.PI
      if (!valid) invalidSamples++
      else {
        smallestRadius = Math.min(smallestRadius, radius)
        largestRadius = Math.max(largestRadius, radius)
      }
      positions.push(
        calibration.origin[0] + horizontal * Math.cos(angle) * radius,
        calibration.origin[1] + Math.sin(elevation) * radius,
        calibration.origin[2] + horizontal * Math.sin(angle) * radius,
      )
      coordinates.push(u, v)
      radii.push(valid ? radius : 0)
    }
  }
  if (!Number.isFinite(smallestRadius)) throw new Error('全景深度没有有效距离')
  const add = (a: number, b: number, c: number) => {
    const values = [radii[a]!, radii[b]!, radii[c]!]
    // Do not stretch an image triangle across foreground/background discontinuities.
    if (Math.min(...values) <= 0 || Math.max(...values) / Math.min(...values) > ratio) {
      rejectedTriangles++
      return
    }
    indices.push(a, c, b) // Outward orientation, rendered from inside with BackSide.
  }
  for (let y = 0; y < latitude; y++)
    for (let x = 0; x < longitude; x++) {
      const a = y * stride + x,
        b = a + stride
      add(a, b, a + 1)
      add(a + 1, b, b + 1)
    }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new Float32BufferAttribute(coordinates, 2))
  geometry.setIndex(indices)
  // The shared MRT reads normalView even for unlit image surfaces.
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return {
    geometry,
    stats: {
      vertices: positions.length / 3,
      triangles: indices.length / 3,
      rejectedTriangles,
      invalidSamples,
      longitude,
      latitude,
      minRadius: smallestRadius,
      maxRadius: largestRadius,
    },
  }
}

/** Optional far box is image fallback for holes, not recovered hidden geometry. */
export function createDepthLoungeProjection(image: Texture, options: DepthLoungeProjectionOptions) {
  const radial = createRadialLoungeGeometry(options),
    { calibration } = options,
    material = imageMaterial(image, calibration.origin, calibration.longitudeOffset),
    mesh = new Mesh(radial.geometry, material),
    group = new Group()
  let fallback: ReturnType<typeof createFiniteLoungeProjection> | undefined
  try {
    if (options.fallbackBounds)
      fallback = createFiniteLoungeProjection(options.fallbackImage ?? image, {
        ...options.fallbackBounds,
        captureOrigin: calibration.origin,
        longitudeOffset: calibration.longitudeOffset,
      })
  } catch (cause) {
    radial.geometry.dispose()
    material.dispose()
    throw cause
  }
  material.name = 'TreesXRadialDepthLoungeImage'
  mesh.name = 'Trees X / radial depth image room'
  mesh.userData.traceExclude = true
  group.name = 'Trees X / depth lounge projection'
  group.userData.depthProjection = radial.stats
  if (fallback) group.add(fallback.group)
  group.add(mesh)
  let disposed = false
  return {
    group,
    mesh,
    fallback,
    stats: radial.stats,
    dispose() {
      if (disposed) return
      disposed = true
      group.removeFromParent()
      group.clear()
      fallback?.dispose()
      radial.geometry.dispose()
      material.dispose()
    },
  }
}

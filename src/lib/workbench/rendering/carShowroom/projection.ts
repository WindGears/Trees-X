import { REVISION, Vector3, type Texture } from 'three'
import {
  EnvironmentNode,
  MeshStandardNodeMaterial,
  type Node,
  type NodeBuilder,
} from 'three/webgpu'
import {
  bentNormalView,
  cameraWorldMatrix,
  clearcoatNormalView,
  clearcoatRoughness,
  float,
  materialEnvIntensity,
  normalView,
  normalWorld,
  pmremTexture,
  positionViewDirection,
  positionWorld,
  pow4,
  roughness,
  texture as textureNode,
  vec3,
} from 'three/tsl'
import type { CarShowroomConfig, ShowroomVector3 } from './config'

type LightingContext = {
  radiance: Node<'vec3'>
  iblIrradiance: Node<'vec3'>
  lightingModel: { clearcoatRadiance?: Node<'vec3'> }
}

/** Numeric reference for the shader slab intersection. Outside misses preserve direction. */
export function projectBoxDirection(
  point: ShowroomVector3,
  direction: ShowroomVector3,
  config: CarShowroomConfig,
): [number, number, number] {
  // Raster interpolation can put a box-face fragment a few ULPs outside.
  // Keep boundary rays inside by 0.1mm instead of alternating between a local
  // hit and the uncorrected environment at neighbouring pixels.
  const epsilon = 1e-4
  const boundary = point.every(
    (p, axis) =>
      p >= config.roomBox.min[axis]! - epsilon && p <= config.roomBox.max[axis]! + epsilon,
  )
  const start = point.map((p, axis) =>
    boundary
      ? Math.max(
          config.roomBox.min[axis]! + epsilon,
          Math.min(config.roomBox.max[axis]! - epsilon, p),
        )
      : p,
  ) as [number, number, number]
  let entry = -Infinity,
    exit = Infinity
  for (let axis = 0; axis < 3; axis++) {
    const p = start[axis]!,
      d = direction[axis]!,
      lower = config.roomBox.min[axis]!,
      upper = config.roomBox.max[axis]!
    if (Math.abs(d) < 1e-8) {
      if (p < lower || p > upper) return [...direction]
      continue
    }
    const a = (lower - p) / d,
      b = (upper - p) / d
    entry = Math.max(entry, Math.min(a, b))
    exit = Math.min(exit, Math.max(a, b))
  }
  if (!Number.isFinite(exit) || exit < Math.max(entry, 0)) return [...direction]
  const result = new Vector3(...direction).multiplyScalar(exit).add(new Vector3(...start))
  result.sub(new Vector3(...config.capture.position)).normalize()
  return result.toArray() as [number, number, number]
}

function boxDirection(direction: Node<'vec3'>, config: CarShowroomConfig) {
  const lower = vec3(...config.roomBox.min),
    upper = vec3(...config.roomBox.max),
    origin = vec3(...config.capture.position),
    boundary = positionWorld
      .greaterThanEqual(lower.sub(1e-4))
      .all()
      .and(positionWorld.lessThanEqual(upper.add(1e-4)).all()),
    start = boundary.select(positionWorld.clamp(lower.add(1e-4), upper.sub(1e-4)), positionWorld),
    safe = direction.lessThan(0).select(vec3(-1), vec3(1)).mul(direction.abs().max(1e-6)),
    a = lower.sub(start).div(safe),
    b = upper.sub(start).div(safe),
    near = a.min(b),
    far = a.max(b),
    entry = near.x.max(near.y).max(near.z),
    exit = far.x.min(far.y).min(far.z),
    corrected = start.add(direction.mul(exit)).sub(origin).normalize()
  return exit.greaterThanEqual(entry.max(0)).select(corrected, direction)
}

/** Local r185 EnvironmentNode implementation. Only specular sampling gets box projection. */
class ColdStudioEnvironmentNode extends EnvironmentNode {
  constructor(
    private readonly source: Texture,
    private readonly config: CarShowroomConfig,
    readonly irradianceSource: Texture = source,
    readonly projectSpecular = true,
  ) {
    super(textureNode(source))
  }

  override setup(builder: NodeBuilder) {
    const method: unknown = Reflect.get(EnvironmentNode.prototype, '_getPMREMNodeCache')
    if (REVISION !== '185' || typeof method !== 'function')
      throw new Error('冷白摄影棚环境投影仅支持受检 Three r185')
    const cache: unknown = Reflect.apply(method, this, [builder.renderer])
    if (!(cache instanceof WeakMap)) throw new Error('冷白摄影棚环境缓存接口不兼容')
    const environment =
      (cache.get(this.source) as Node<'vec3'> | undefined) ?? pmremTexture(this.source)
    if (!cache.has(this.source)) cache.set(this.source, environment)
    const irradiance =
      (cache.get(this.irradianceSource) as Node<'vec3'> | undefined) ??
      pmremTexture(this.irradianceSource)
    if (!cache.has(this.irradianceSource)) cache.set(this.irradianceSource, irradiance)
    const context = builder.context as LightingContext,
      material = builder.material,
      normal =
        material instanceof MeshStandardNodeMaterial &&
        (Reflect.get(material, 'useAnisotropy') === true ||
          Number(Reflect.get(material, 'anisotropy')) > 0)
          ? (bentNormalView as Node<'vec3'>)
          : normalView
    const radiance = (level: Node<'float'>, normalNode: Node<'vec3'>) => {
      let direction: Node<'vec3'> | undefined
      // r185 declarations erase IsolateNode's input type; runtime remains vec3.
      return environment
        .context({
          getUV: () => {
            if (!direction) {
              const reflected = positionViewDirection.negate().reflect(normalNode),
                native = pow4(level)
                  .mix(reflected, normalNode)
                  .normalize()
                  .transformDirection(cameraWorldMatrix)
              direction = this.projectSpecular ? boxDirection(native, this.config) : native
            }
            return direction
          },
          getTextureLevel: () => level,
        })
        .mul(materialEnvIntensity)
        .isolate() as unknown as Node<'vec3'>
    }
    context.radiance.addAssign(radiance(roughness, normal))
    context.iblIrradiance.addAssign(
      irradiance
        .context({
          getUV: () => normalWorld,
          getTextureLevel: () => float(1),
        })
        .mul(Math.PI)
        .mul(materialEnvIntensity)
        .isolate() as unknown as Node<'vec3'>,
    )
    context.lightingModel.clearcoatRadiance?.addAssign(
      radiance(clearcoatRoughness, clearcoatNormalView),
    )
    return null
  }
}

/** Shares native PMREM ownership with the capture; this node never disposes the texture. */
export function createColdStudioEnvironmentNode(
  texture: Texture,
  config: CarShowroomConfig,
  irradianceTexture: Texture = texture,
  projectSpecular = true,
) {
  if (REVISION !== '185') throw new Error('冷白摄影棚环境投影仅支持受检 Three r185')
  return new ColdStudioEnvironmentNode(texture, config, irradianceTexture, projectSpecular)
}

/** Each installer can bind the same immutable projection to compatible materials. */
export function createColdStudioProjection(
  texture: Texture,
  config: CarShowroomConfig,
  irradianceTexture: Texture = texture,
  projectSpecular = true,
) {
  const environment = createColdStudioEnvironmentNode(
    texture,
    config,
    irradianceTexture,
    projectSpecular,
  )
  const reference = textureNode(texture)
  return (material: MeshStandardNodeMaterial, programKey?: () => string) => {
    const environmentDescriptor = Object.getOwnPropertyDescriptor(material, 'setupEnvironment')
    const previousEnvironmentNode = material.envNode
    const programDescriptor =
      programKey && Object.getOwnPropertyDescriptor(material, 'customProgramCacheKey')
    const previousProgramKey = material.customProgramCacheKey
    const cacheKey = programKey && (() => `${previousProgramKey.call(material)}/${programKey()}`)

    // The public node keeps Three's material observer watching the live probe.
    // Retain a separate program key when materials share this node identity.
    material.envNode = reference
    Object.defineProperty(material, 'setupEnvironment', {
      configurable: true,
      writable: true,
      value: () => environment,
    })
    if (cacheKey)
      Object.defineProperty(material, 'customProgramCacheKey', {
        configurable: true,
        writable: true,
        value: cacheKey,
      })
    material.needsUpdate = true

    let disposed = false
    return () => {
      if (disposed) return
      disposed = true
      if (environmentDescriptor)
        Object.defineProperty(material, 'setupEnvironment', environmentDescriptor)
      else Reflect.deleteProperty(material, 'setupEnvironment')
      if (cacheKey && material.customProgramCacheKey === cacheKey) {
        if (programDescriptor)
          Object.defineProperty(material, 'customProgramCacheKey', programDescriptor)
        else Reflect.deleteProperty(material, 'customProgramCacheKey')
      }
      material.envNode = previousEnvironmentNode
      material.needsUpdate = true
    }
  }
}

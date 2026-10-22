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
  let entry = -Infinity,
    exit = Infinity
  for (let axis = 0; axis < 3; axis++) {
    const p = point[axis]!,
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
  const result = new Vector3(...direction).multiplyScalar(exit).add(new Vector3(...point))
  result.sub(new Vector3(...config.capture.position)).normalize()
  return result.toArray() as [number, number, number]
}

function boxDirection(direction: Node<'vec3'>, config: CarShowroomConfig) {
  const lower = vec3(...config.roomBox.min),
    upper = vec3(...config.roomBox.max),
    origin = vec3(...config.capture.position),
    safe = direction.lessThan(0).select(vec3(-1), vec3(1)).mul(direction.abs().max(1e-6)),
    a = lower.sub(positionWorld).div(safe),
    b = upper.sub(positionWorld).div(safe),
    near = a.min(b),
    far = a.max(b),
    entry = near.x.max(near.y).max(near.z),
    exit = far.x.min(far.y).min(far.z),
    corrected = positionWorld.add(direction.mul(exit)).sub(origin).normalize()
  return exit.greaterThanEqual(entry.max(0)).select(corrected, direction)
}

/** Local r185 EnvironmentNode implementation. Only specular sampling gets box projection. */
class ColdStudioEnvironmentNode extends EnvironmentNode {
  constructor(
    private readonly source: Texture,
    private readonly config: CarShowroomConfig,
    readonly irradianceSource: Texture = source,
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
              direction = boxDirection(native, this.config)
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
) {
  if (REVISION !== '185') throw new Error('冷白摄影棚环境投影仅支持受检 Three r185')
  return new ColdStudioEnvironmentNode(texture, config, irradianceTexture)
}

/** Instance-only hook. Does not set envMap, so supported materials remain in the SSR branch. */
export function installColdStudioProjection(
  material: MeshStandardNodeMaterial,
  texture: Texture,
  config: CarShowroomConfig,
  irradianceTexture: Texture = texture,
) {
  const descriptor = Object.getOwnPropertyDescriptor(material, 'setupEnvironment'),
    previousEnvironmentNode = material.envNode,
    node = createColdStudioEnvironmentNode(texture, config, irradianceTexture)
  // r185's NodeMaterialObserver scans public node fields, not the return value
  // of setupEnvironment(). Register this real environment input so every
  // reused static mesh refreshes dynamic light/texture bindings after resize.
  material.envNode = textureNode(texture)
  Object.defineProperty(material, 'setupEnvironment', {
    configurable: true,
    writable: true,
    value: () => node,
  })
  material.needsUpdate = true
  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    if (descriptor) Object.defineProperty(material, 'setupEnvironment', descriptor)
    else Reflect.deleteProperty(material, 'setupEnvironment')
    material.envNode = previousEnvironmentNode
    material.needsUpdate = true
  }
}

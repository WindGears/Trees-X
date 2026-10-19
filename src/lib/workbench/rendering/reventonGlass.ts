import {
  BackSide,
  Color,
  Mesh,
  MeshPhysicalMaterial,
  REVISION,
  Texture,
  Vector2,
  type Group,
  type Material,
} from 'three'
import {
  MeshPhysicalNodeMaterial,
  PhysicalLightingModel,
  ViewportTextureNode,
  type Node,
  type NodeBuilder,
} from 'three/webgpu'
import {
  cameraPosition,
  cameraProjectionMatrix,
  cameraViewMatrix,
  DFGLUT,
  diffuseColor,
  Fn,
  ior,
  materialMetalness,
  materialRoughness,
  mix,
  normalWorld,
  positionWorld,
  screenSize,
  specularColor,
  specularF90,
  textureBicubicLevel,
  transmission,
  vec2,
  vec4,
} from 'three/tsl'

/** Own r185 viewport clones for every render context, including late references. */
export interface ReventonViewport {
  node: ViewportTextureNode
  dispose(): void
}

export function ownReventonViewport(): ReventonViewport {
  const textures = new Set<Texture>()
  let disposed = false
  class OwnedViewport extends ViewportTextureNode {
    override generateMipmaps = true
    override getTextureForReference(
      reference: Parameters<ViewportTextureNode['getTextureForReference']>[0] = null,
    ) {
      const value = super.getTextureForReference(reference)
      if (disposed) value.dispose()
      else textures.add(value)
      return value
    }
  }
  const node = new OwnedViewport()
  textures.add(node.value)
  return {
    node,
    dispose() {
      if (disposed) return
      disposed = true
      for (const value of textures) value.dispose()
      textures.clear()
    },
  }
}

type Viewport = ReturnType<typeof ownReventonViewport>

/** r185's zero-thickness transmission, using raw scalar/map roughness only here.
 * Native reflection still uses geometry-adjusted roughness in PhysicalLightingModel.
 * The original shader's roughnessFactor also enters transmission's Fresnel/DFG term.
 */
function thinTransmission(front: Viewport, back: Viewport): Node<'vec4'> {
  return Fn((builder: NodeBuilder) => {
    const ndc = cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(positionWorld, 1))),
      projected = ndc.xy.div(ndc.w).add(1).mul(0.5),
      coordinates = vec2(projected.x, projected.y.oneMinus()),
      source = builder.material.side === BackSide ? back.node : front.node,
      lod = screenSize.x.log2().mul(materialRoughness.mul(ior.mul(2).sub(2).clamp(0, 1))),
      sampled = textureBicubicLevel(source.sample(coordinates), lod),
      tint = diffuseColor.rgb.mul(materialMetalness.oneMinus()),
      view = cameraPosition.sub(positionWorld).normalize(),
      fab = DFGLUT({
        dotNV: normalWorld.dot(view).clamp(),
        roughness: materialRoughness,
      }) as unknown as Node<'vec2'>,
      f = mix(specularColor, diffuseColor.rgb, materialMetalness)
        .mul(fab.x)
        .add(specularF90.mul(fab.y)),
      tintMean = tint.r.add(tint.g, tint.b).div(3)
    return vec4(
      f.oneMinus().mul(tint).mul(sampled.rgb),
      sampled.a.oneMinus().mul(tintMean).oneMinus(),
    )
  })()
}

class ThinGlassLighting extends PhysicalLightingModel {
  constructor(
    material: MeshPhysicalNodeMaterial,
    private readonly backdrop: Node<'vec4'>,
  ) {
    // Only transmission is local; all reflection/direct/indirect branches stay native.
    super(
      material.useClearcoat,
      material.useSheen,
      material.useIridescence,
      material.useAnisotropy,
      false,
      false,
    )
  }

  override start(builder: NodeBuilder) {
    const context = builder.context as { backdrop: Node<'vec4'>; backdropAlpha: Node<'float'> }
    context.backdrop = this.backdrop
    context.backdropAlpha = transmission
    diffuseColor.a.mulAssign(mix(1, this.backdrop.a, transmission))
    super.start(builder)
  }
}

class ReventonThinGlassMaterial extends MeshPhysicalNodeMaterial {
  constructor(private readonly backdrop: Node<'vec4'>) {
    super()
  }

  override setupLightingModel() {
    // A changed/custom volume retains native handling instead of using a thin approximation.
    return this.useTransmission && this.thickness === 0 && !this.useDispersion
      ? new ThinGlassLighting(this, this.backdrop)
      : super.setupLightingModel()
  }
}

const scalarFields = [
  'roughness',
  'metalness',
  'opacity',
  'emissiveIntensity',
  'envMapIntensity',
  'lightMapIntensity',
  'aoMapIntensity',
  'bumpScale',
  'displacementScale',
  'displacementBias',
  'clearcoat',
  'clearcoatRoughness',
  'ior',
  'specularIntensity',
  'anisotropy',
  'anisotropyRotation',
  'transmission',
  'thickness',
  'attenuationDistance',
  'dispersion',
  'iridescence',
  'iridescenceIOR',
  'sheen',
  'sheenRoughness',
  'side',
  'transparent',
  'alphaTest',
  'depthWrite',
  'depthTest',
  'forceSinglePass',
  'polygonOffset',
  'polygonOffsetFactor',
  'polygonOffsetUnits',
] as const
const textureFields = [
  'map',
  'normalMap',
  'roughnessMap',
  'metalnessMap',
  'aoMap',
  'emissiveMap',
  'lightMap',
  'bumpMap',
  'displacementMap',
  'alphaMap',
  'envMap',
  'clearcoatMap',
  'clearcoatRoughnessMap',
  'clearcoatNormalMap',
  'specularIntensityMap',
  'specularColorMap',
  'transmissionMap',
  'thicknessMap',
  'anisotropyMap',
  'iridescenceMap',
  'iridescenceThicknessMap',
  'sheenColorMap',
  'sheenRoughnessMap',
] as const
const vectorFields = [
  'color',
  'emissive',
  'normalScale',
  'clearcoatNormalScale',
  'specularColor',
  'attenuationColor',
  'sheenColor',
] as const
const structuralFields = new Set<string>([
  'side',
  'transparent',
  'depthWrite',
  'depthTest',
  'forceSinglePass',
  'polygonOffset',
])

/** Derived materials borrow source maps. The loader remains their sole release owner. */
export function prepareGpuReventonMaterials(model: Group, revision = REVISION) {
  if (revision !== '185') throw new Error('汽车薄玻璃需要重新核验 Three r185 透射接口')
  const front = ownReventonViewport(),
    back = ownReventonViewport(),
    backdrop = thinTransmission(front, back),
    bindings = new Map<MeshPhysicalMaterial, ReventonThinGlassMaterial>(),
    versions = new Map<MeshPhysicalMaterial, number>(),
    meshes: { mesh: Mesh; source: Material | Material[]; runtime: Material | Material[] }[] = []
  let disposed = false
  const convert = (source: Material) => {
    if (!(source instanceof MeshPhysicalMaterial) || !/\/ (15103|21865)$/.test(source.name))
      return source
    if (source.thickness !== 0 || source.dispersion !== 0) return source
    let runtime = bindings.get(source)
    if (!runtime) {
      runtime = new ReventonThinGlassMaterial(backdrop)
      runtime.copy(source)
      bindings.set(source, runtime)
      versions.set(source, source.version)
    }
    return runtime
  }
  const dispose = () => {
    if (disposed) return
    disposed = true
    for (const { mesh, source, runtime } of meshes)
      if (mesh.material === runtime) mesh.material = source
    for (const runtime of bindings.values()) runtime.dispose()
    bindings.clear()
    versions.clear()
    meshes.length = 0
    front.dispose()
    back.dispose()
  }
  try {
    model.traverse((object) => {
      if (!(object instanceof Mesh)) return
      const source = object.material,
        runtime = Array.isArray(source) ? source.map(convert) : convert(source)
      if (
        runtime === source ||
        (Array.isArray(runtime) && runtime.every((value, i) => value === (source as Material[])[i]))
      )
        return
      object.material = runtime
      meshes.push({ mesh: object, source, runtime })
    })
  } catch (error) {
    dispose()
    throw error
  }
  return {
    sync() {
      if (disposed) return
      for (const [source, runtime] of bindings) {
        const input = source as unknown as Record<string, unknown>,
          output = runtime as unknown as Record<string, unknown>
        let recompile = versions.get(source) !== source.version
        const hadThin = runtime.thickness === 0,
          hadTransmission = runtime.useTransmission,
          hadClearcoat = runtime.useClearcoat,
          hadSheen = runtime.useSheen,
          hadIridescence = runtime.useIridescence,
          hadAnisotropy = runtime.useAnisotropy,
          hadDispersion = runtime.useDispersion,
          hadAlphaTest = runtime.alphaTest > 0
        for (const key of scalarFields) {
          if (input[key] === undefined || input[key] === output[key]) continue
          output[key] = input[key]
          recompile = recompile || structuralFields.has(key)
        }
        for (const key of textureFields) {
          if (input[key] === undefined || input[key] === output[key]) continue
          output[key] = input[key]
          recompile = true
        }
        for (const key of vectorFields) {
          const value = input[key],
            target = output[key]
          if (value instanceof Color && target instanceof Color) target.copy(value)
          else if (value instanceof Vector2 && target instanceof Vector2) target.copy(value)
        }
        if (
          recompile ||
          hadThin !== (runtime.thickness === 0) ||
          hadTransmission !== runtime.useTransmission ||
          hadClearcoat !== runtime.useClearcoat ||
          hadSheen !== runtime.useSheen ||
          hadIridescence !== runtime.useIridescence ||
          hadAnisotropy !== runtime.useAnisotropy ||
          hadDispersion !== runtime.useDispersion ||
          hadAlphaTest !== runtime.alphaTest > 0
        )
          runtime.needsUpdate = true
        versions.set(source, source.version)
      }
    },
    dispose,
  }
}

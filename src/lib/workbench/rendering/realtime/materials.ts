import { Color, Mesh, MeshStandardMaterial, Vector2, type Material, type Object3D } from 'three'
import {
  MeshPhysicalNodeMaterial,
  MeshStandardNodeMaterial,
  PhysicalLightingModel,
  type Node,
  type NodeBuilder,
} from 'three/webgpu'
import {
  Fn,
  DFGLUT,
  F_Schlick,
  clearcoat,
  clearcoatNormalView,
  float,
  diffuseColor,
  metalness,
  mix,
  normalView,
  positionViewDirection,
  property,
  roughness,
  specularColor,
  specularF90,
  vec3,
  vec4,
} from 'three/tsl'

type PbrSource = MeshStandardMaterial
type SignalContext = {
  radiance: Node<'vec3'>
  ambientOcclusion: Node<'float'>
  reflectedLight: { indirectDiffuse: Node<'vec3'>; indirectSpecular: Node<'vec3'> }
}
type Captures = ReturnType<typeof createCaptures>

function createCaptures() {
  return {
    specular: property('vec3', 'treesBaseSpecular'),
    diffuse: property('vec3', 'treesBaseDiffuse'),
    weight: property('float', 'treesIndirectWeight'),
    coat: property('float', 'treesCoatThroughput'),
  }
}

const captures = createCaptures()

/** r185 base-lobe capture. Clearcoat remains in native Physical finish(). */
class CapturedPhysicalLighting extends PhysicalLightingModel {
  constructor(
    material: RealtimePhysicalMaterial,
    private readonly captures: Captures,
  ) {
    super(material.useClearcoat, false, false, false, false, false)
  }

  override finish(builder: NodeBuilder) {
    // LightingContext's declared type is unknown upstream. This module is pinned
    // to r185; finish() executes after indirect() and its ambient occlusion.
    const context = builder.context as SignalContext
    let throughput: Node<'float'> = float(1)
    if (this.clearcoat) {
      const fresnel = F_Schlick({
        dotVH: clearcoatNormalView.dot(positionViewDirection).clamp(),
        f0: vec3(0.04),
        f90: vec3(1),
      }) as unknown as Node<'vec3'>
      // Upstream F_Schlick declarations do not retain its vec3 result type.
      throughput = float(clearcoat.mul(vec3(fresnel).r).oneMinus())
    }
    const dotNV = normalView.dot(positionViewDirection).clamp()
    // Upstream DFGLUT declarations omit its RG result type in r185.
    const fab = DFGLUT({ roughness, dotNV }) as unknown as Node<'vec2'>
    // r185 computeMultiscattering: only FssEss belongs to the radiance term.
    // Preserve the native irradiance-driven multiple-scattering contribution.
    const singleScattering = mix(specularColor.rgb, diffuseColor.rgb, metalness)
      .mul(fab.x)
      .add(specularF90.mul(fab.y))
    const aoExponent = roughness.mul(-16).oneMinus().negate().exp2()
    const specularAO = context.ambientOcclusion
      .sub(dotNV.add(context.ambientOcclusion).pow(aoExponent).oneMinus())
      .clamp()
    this.captures.coat.assign(throughput)
    this.captures.weight.assign(throughput.mul(specularAO))
    this.captures.specular.assign(context.radiance.mul(singleScattering).mul(this.captures.weight))
    this.captures.diffuse.assign(context.reflectedLight.indirectDiffuse.mul(throughput))
    super.finish(builder)
  }
}

class RealtimePhysicalMaterial extends MeshPhysicalNodeMaterial {
  constructor(
    readonly source: PbrSource,
    readonly captures: Captures,
  ) {
    super()
  }

  override setupLightingModel() {
    if (!realtimeMaterialSupported(this.source)) return super.setupLightingModel()
    return new CapturedPhysicalLighting(this, this.captures)
  }
}

// Shader properties are shared by programs, never CPU-side render resources.
// Unrelated materials explicitly write zero, including studio NodeMaterials.
export const specularCaptureNode = Fn((builder: NodeBuilder) =>
  builder.material instanceof RealtimePhysicalMaterial &&
  realtimeMaterialSupported(builder.material.source)
    ? vec4(captures.specular, captures.weight)
    : vec4(0),
)()
export const diffuseCaptureNode = Fn((builder: NodeBuilder) =>
  builder.material instanceof RealtimePhysicalMaterial &&
  realtimeMaterialSupported(builder.material.source)
    ? vec4(captures.diffuse, captures.coat)
    : vec4(0),
)()

/** Physical's derivative-adjusted roughness, rather than the raw material scalar. */
export const physicalRoughnessNode = Fn((builder: NodeBuilder) =>
  builder.material instanceof MeshStandardNodeMaterial ? roughness : float(1),
)()

/** Unsupported BRDF branches stay entirely native, rather than losing their IBL. */
export function realtimeMaterialSupported(material: Material): material is PbrSource {
  if (!(material instanceof MeshStandardMaterial)) return false
  if (material.transparent || material.opacity < 1) return false
  if (material.envMap !== null) return false
  const values = material as unknown as Record<string, unknown>
  if (typeof values.ior === 'number' && values.ior !== 1.5) return false
  if (typeof values.specularIntensity === 'number' && values.specularIntensity !== 1) return false
  const specular = values.specularColor
  if (specular instanceof Color && (specular.r !== 1 || specular.g !== 1 || specular.b !== 1))
    return false
  if (values.specularColorMap || values.specularIntensityMap) return false
  return ['anisotropy', 'transmission', 'dispersion', 'iridescence', 'sheen'].every(
    (key) => typeof values[key] !== 'number' || values[key] === 0,
  )
}

// This is the known typewriter's character/nameplate decal branch, not a generic
// glass substitute. Native MRT auxiliary attachments use NoBlending: an alpha=0
// decal otherwise writes its G-buffer across the whole rectangle.
const decalAlphaFloor = 1 / 255

function isTypewriterDecal(material: Material): material is PbrSource {
  return (
    material instanceof MeshStandardMaterial &&
    material.transparent &&
    material.map !== null &&
    /^decal-(?:[6-9]|[1-4]\d|5[0-5]|62)$/.test(material.name)
  )
}

const scalarFields = [
  'name',
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

interface Binding {
  source: PbrSource
  runtime: RealtimePhysicalMaterial
  version: number
  supported: boolean
  protectedDecal: boolean
}

function syncBinding(binding: Binding) {
  const { source, runtime } = binding
  const input = source as unknown as Record<string, unknown>
  const output = runtime as unknown as Record<string, unknown>
  let changed = false
  let recompile = binding.version !== source.version
  const hadClearcoat = runtime.useClearcoat
  for (const key of scalarFields) {
    if (input[key] === undefined || input[key] === output[key]) continue
    output[key] = input[key]
    changed = true
  }
  const alphaTest = binding.protectedDecal
    ? Math.max(source.alphaTest, decalAlphaFloor)
    : source.alphaTest
  if (runtime.alphaTest !== alphaTest) {
    recompile = recompile || runtime.alphaTest > 0 !== alphaTest > 0
    runtime.alphaTest = alphaTest
    changed = true
  }
  for (const key of textureFields) {
    if (input[key] === undefined || input[key] === output[key]) continue
    output[key] = input[key]
    changed = recompile = true
  }
  for (const key of vectorFields) {
    const value = input[key]
    const target = output[key]
    if (value instanceof Color && target instanceof Color && !target.equals(value)) {
      target.copy(value)
      changed = true
    } else if (value instanceof Vector2 && target instanceof Vector2 && !target.equals(value)) {
      target.copy(value)
      changed = true
    }
  }
  if (hadClearcoat !== runtime.useClearcoat) recompile = true
  const supported = realtimeMaterialSupported(source)
  if (supported !== binding.supported) recompile = true
  binding.supported = supported
  if (recompile) runtime.needsUpdate = true
  binding.version = source.version
  return changed || recompile
}

/** Owns only runtime node materials. Source maps, source materials and meshes are borrowed. */
export function createRealtimeMaterials(root?: Object3D) {
  const bindings = new Map<Material, Binding>()
  const native = new Set<Material>()
  const meshes: { mesh: Mesh; original: Material | Material[]; runtime: Material | Material[] }[] =
    []
  let disposed = false

  function convert(source: Material): Material {
    const supported = realtimeMaterialSupported(source)
    const protectedDecal = isTypewriterDecal(source)
    if (!supported) {
      native.add(source)
      if (!protectedDecal) return source
    }
    let binding = bindings.get(source)
    if (!binding) {
      const runtime = new RealtimePhysicalMaterial(source, captures)
      runtime.copy(source)
      if (protectedDecal) runtime.alphaTest = Math.max(source.alphaTest, decalAlphaFloor)
      binding = { source, runtime, version: source.version, supported, protectedDecal }
      bindings.set(source, binding)
    }
    return binding.runtime
  }

  function restore() {
    for (const { mesh, original, runtime } of meshes)
      if (mesh.material === runtime) mesh.material = original
    for (const { runtime } of bindings.values()) runtime.dispose()
    bindings.clear()
    native.clear()
    meshes.length = 0
  }

  function install(value: Object3D) {
    if (disposed) return
    restore()
    value.traverse((object) => {
      if (!(object instanceof Mesh)) return
      const original = object.material
      const runtime = Array.isArray(original) ? original.map(convert) : convert(original)
      if (runtime === original) return
      object.material = runtime
      meshes.push({ mesh: object, original, runtime })
    })
  }

  if (root) install(root)

  return {
    specularCaptureNode,
    diffuseCaptureNode,
    install,
    restore,
    get count() {
      return bindings.size
    },
    sync() {
      if (disposed) return false
      let changed = false
      for (const binding of bindings.values()) changed = syncBinding(binding) || changed
      return changed
    },
    stats(): Record<string, number> {
      let supported = 0
      for (const binding of bindings.values()) if (binding.supported) supported++
      const counts = {
        supported,
        runtime: bindings.size,
        meshes: meshes.length,
        native: native.size,
        nativeTransparent: 0,
        nativeAnisotropic: 0,
        nativeTransmission: 0,
        nativeOther: 0,
        protectedDecals: 0,
      }
      for (const binding of bindings.values()) if (binding.protectedDecal) counts.protectedDecals++
      for (const material of native) {
        const values = material as unknown as Record<string, unknown>
        if (material.transparent || material.opacity < 1) counts.nativeTransparent++
        else if (typeof values.transmission === 'number' && values.transmission > 0)
          counts.nativeTransmission++
        else if (typeof values.anisotropy === 'number' && values.anisotropy > 0)
          counts.nativeAnisotropic++
        else counts.nativeOther++
      }
      return counts
    },
    dispose() {
      if (disposed) return
      disposed = true
      restore()
    },
  }
}

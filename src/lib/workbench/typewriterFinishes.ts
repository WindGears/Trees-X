import { MeshPhysicalMaterial, type MeshStandardMaterial, type Texture } from 'three'
import { createTypewriterMicroMaps, type MicroFinish } from './typewriterMicroMaps'

const paint = new Map([
  ['enamel', { roughness: 0.26, clearcoat: 0.76, coatRoughness: 0.15 }],
  ['shellGloss', { roughness: 0.23, clearcoat: 0.8, coatRoughness: 0.14 }],
  ['shellRim', { roughness: 0.33, clearcoat: 0.36, coatRoughness: 0.22 }],
])
const metal = new Map([
  ['steel', { roughness: 0.29, anisotropy: 0 }],
  ['chrome', { roughness: 0.19, anisotropy: 0.12 }],
  ['iron', { roughness: 0.44, anisotropy: 0 }],
  ['edge', { roughness: 0.25, anisotropy: 0.22 }],
  ['goldEdge', { roughness: 0.29, anisotropy: 0.2 }],
  ['goldChrome', { roughness: 0.2, anisotropy: 0.1 }],
])
const installed = new WeakSet<MeshStandardMaterial>()

function validateAuthoredFinish(material: MeshStandardMaterial) {
  if (!('treesFinishVersion' in material.userData)) return
  const version: unknown = material.userData.treesFinishVersion
  const fail = (reason: string): never => {
    throw new Error(`打字机材质 ${material.name || '(未命名)'} 的 v2 资源无效：${reason}`)
  }
  if (version !== 2) fail('treesFinishVersion 必须为数字 2')
  if (!paint.has(material.name) && !metal.has(material.name)) fail('未注册的材质名称')
  if (!(material instanceof MeshPhysicalMaterial)) fail('需要 Physical 材质')
  if (!material.normalMap || !material.roughnessMap) fail('缺少法线或粗糙度贴图')
  if (
    material instanceof MeshPhysicalMaterial &&
    material.anisotropy > 0 &&
    !material.anisotropyMap
  )
    fail('各向异性材质缺少方向贴图')
}

/** Authored v2 assets remain loader-owned; v1 generated maps have one ref-counted owner per model. */
export function applyTypewriterFinishes(materials: Set<MeshStandardMaterial>, scale = 1) {
  // Tangent-space normal maps encode orientation, independent of the model's uniform scale.
  void scale
  // Validate the whole set before touching it: a bad v2 package must not fall back
  // to v1 parameters or leave earlier materials partially prepared.
  for (const material of materials) validateAuthoredFinish(material)
  let shared: Map<MicroFinish, ReturnType<typeof createTypewriterMicroMaps>> | undefined
  for (const material of materials) {
    const intensity: unknown = material.userData.sourceEnvMapIntensity
    if (typeof intensity === 'number' && Number.isFinite(intensity))
      material.envMapIntensity = intensity
    // Geometry, UVs and Physical inputs were prepared together in the v2 package.
    // Borrow its maps as-is; no runtime replacement, ownership hook or allocation.
    if (material.userData.treesFinishVersion === 2) continue
    const paintProfile = paint.get(material.name),
      metalProfile = metal.get(material.name)
    if ((!paintProfile && !metalProfile) || installed.has(material)) continue
    material.roughness = paintProfile?.roughness ?? metalProfile!.roughness
    if (material instanceof MeshPhysicalMaterial) {
      if (paintProfile) {
        material.metalness = 0.035
        material.clearcoat = paintProfile.clearcoat
        material.clearcoatRoughness = paintProfile.coatRoughness
      } else {
        material.anisotropy = metalProfile!.anisotropy
        material.anisotropyRotation = Math.PI / 2
      }
    }
    // These two shared source materials include primitives without UVs. Keep
    // their standard PBR parameters clean instead of pretending a map can work.
    const kind: MicroFinish | undefined = ['enamel', 'steel'].includes(material.name)
      ? undefined
      : paintProfile
        ? 'paint'
        : material.name === 'iron'
          ? 'iron'
          : 'brush'
    const slots: { field: 'normalMap' | 'roughnessMap'; texture: Texture }[] = []
    if (kind && (!material.normalMap || !material.roughnessMap)) {
      const maps = shared?.get(kind) ?? createTypewriterMicroMaps(kind)
      shared ??= new Map()
      shared.set(kind, maps)
      if (!material.normalMap) {
        material.normalMap = maps.normal
        material.normalScale.setScalar(kind === 'paint' ? 0.055 : kind === 'iron' ? 0.035 : 0.09)
        slots.push({ field: 'normalMap', texture: maps.normal })
      }
      if (!material.roughnessMap) {
        material.roughnessMap = maps.roughness
        slots.push({ field: 'roughnessMap', texture: maps.roughness })
      }
      maps.retain()
      const release = () => {
        material.removeEventListener('dispose', release)
        for (const { field, texture } of slots)
          if (material[field] === texture) material[field] = null
        maps.release()
      }
      material.addEventListener('dispose', release)
    }
    installed.add(material)
    // No shader patch: identical standard maps can be used by WebGL, WebGPU
    // and the path-tracing comparison. Decals and unrelated callbacks are intact.
    material.needsUpdate = true
  }
}

import { Color, MeshPhysicalMaterial, type Material, type Mesh } from 'three'
import type { LoungeAssets } from './loungeAssets'
import { studioPalettes } from '../studio/palette'

type PhysicalSurface = Pick<
  MeshPhysicalMaterial,
  'metalness' | 'clearcoat' | 'clearcoatRoughness' | 'side'
>

/** Speedball reads scalar PBR fields, not the visible TSL graph. Keep this view
 * separate: editing the tracing approximation must never alter raster shaders.
 * Albedo/roughness endpoints follow the lounge graph within the stated map
 * limitations. During its 420ms transition the tracer uses
 * a palette-only albedo/roughness approximation, avoiding a new texture atlas on
 * every tween update. Its limited map UV transform and absent clearcoat BRDF are
 * upstream Speedball limitations, not an arbitrary NodeMaterial equivalent.
 */
export function createLoungeTraceMaterials(
  mesh: Mesh,
  surfaces: readonly PhysicalSurface[],
  baselineRoughness: number,
) {
  const previous = Object.getOwnPropertyDescriptor(mesh.userData, 'traceMaterial'),
    light = new Color(studioPalettes.light.pedestal),
    dark = new Color(studioPalettes.dark.pedestal),
    materials = surfaces.map(
      (surface, index) =>
        new MeshPhysicalMaterial({
          name: `TreesXAmberStoneTrace-${index}`,
          color: light,
          roughness: baselineRoughness,
          metalness: surface.metalness,
          clearcoat: surface.clearcoat,
          clearcoatRoughness: surface.clearcoatRoughness,
          side: surface.side,
        }),
    ),
    binding: Material | Material[] = materials.length === 1 ? materials[0]! : materials,
    metadata = {
      blend: 0,
      ready: false,
      transition: 'palette-only proxy until the warm-night endpoint',
      limitations: [
        'Speedball uses one shared UV transform for all material maps.',
        'Stone roughness is sampled using the base-color UV transform during tracing.',
        'Tracing keeps geometry normals because the stone normal map uses an independent repeat.',
        'Speedball does not trace the Physical clearcoat BRDF.',
      ],
    }
  Object.defineProperty(mesh.userData, 'traceMaterial', {
    value: binding,
    configurable: true,
    enumerable: true,
    writable: true,
  })
  for (const material of materials) material.userData.loungeTrace = metadata
  let disposed = false
  return {
    materials,
    metadata,
    sync(amount: number, assets?: LoungeAssets) {
      if (disposed) return
      const blend = Math.min(1, Math.max(0, amount)),
        textured = blend === 1 && assets !== undefined,
        map = textured ? assets.baseColor : null,
        roughnessMap = textured ? assets.roughness : null
      metadata.blend = blend
      metadata.ready = assets !== undefined
      for (const material of materials) {
        if (material.map !== map || material.roughnessMap !== roughnessMap) {
          material.map = map
          material.roughnessMap = roughnessMap
          // Binding changes need a Speedball atlas rebuild; scalar changes below
          // are observed by proxy.sync without a needless material version bump.
          material.needsUpdate = true
        }
        if (textured) material.color.setRGB(1, 1, 1)
        else if (blend === 1) material.color.copy(dark)
        else if (blend === 0) material.color.copy(light)
        else material.color.copy(light).lerp(dark, blend)
        material.roughness = textured ? 1 : baselineRoughness
        material.normalScale.setScalar(0)
      }
    },
    dispose() {
      if (disposed) return
      disposed = true
      if (mesh.userData.traceMaterial === binding) {
        if (previous) Object.defineProperty(mesh.userData, 'traceMaterial', previous)
        else delete mesh.userData.traceMaterial
      }
      // Textures and original surfaces are borrowed; their owner remains intact.
      for (const material of materials) material.dispose()
    },
  }
}

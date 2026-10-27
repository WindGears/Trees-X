import { Mesh, type Material, type Object3D } from 'three'
import { MeshStandardNodeMaterial } from 'three/webgpu'
import { getShowroomEnvironment } from './binding'
import { installColdStudioProjection } from './projection'
import { usesLocalAreaSpecular } from './receiver'

/** Realtime coordinator owns these material hooks, before adapter resource cleanup. */
export function bindShowroomMaterials(scene: Object3D) {
  const binding = getShowroomEnvironment(scene),
    restores: (() => void)[] = [],
    seen = new Set<Material>()
  if (binding)
    scene.traverse((object) => {
      if (!(object instanceof Mesh)) return
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (!(material instanceof MeshStandardNodeMaterial) || seen.has(material)) continue
        seen.add(material)
        restores.push(
          installColdStudioProjection(
            material,
            // Architecture and opted-in cabin leather use spatial LTC highlights
            // instead of the central probe's emitter image. Retain bounced radiance.
            usesLocalAreaSpecular(object, material) ? binding.irradiance : binding.texture,
            binding.config,
            binding.irradiance,
            // The capture boundary is not an interior receiver. Reprojecting
            // the walls back onto their own proxy causes self-reflection seams.
            !usesLocalAreaSpecular(object),
          ),
        )
      }
    })
  return () => {
    for (const restore of restores.reverse()) restore()
  }
}

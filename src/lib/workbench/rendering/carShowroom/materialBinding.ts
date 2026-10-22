import { Mesh, type Material, type Object3D } from 'three'
import { MeshStandardNodeMaterial } from 'three/webgpu'
import { getShowroomEnvironment } from './binding'
import { installColdStudioProjection } from './projection'

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
            binding.texture,
            binding.config,
            binding.irradiance,
          ),
        )
      }
    })
  return () => {
    for (const restore of restores.reverse()) restore()
  }
}

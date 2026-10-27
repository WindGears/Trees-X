import type { Material, Object3D } from 'three'

/** A local, audited car experiment. Keep glass and body paint on their own path. */
export function usesCabinAreaSpecular(object: Object3D | null | undefined, material?: Material) {
  if (!material || material.transparent || material.opacity < 1) return false
  const id = material.userData.source_vpb_material_id
  if (id !== 18661 && id !== 19771) return false
  if (!new RegExp(`^Reventon / (fixed|door_-?1) / ${id}$`).test(material.name)) return false
  for (let node = object; node; node = node.parent)
    if (node.userData.carStudioCabinLighting === 'local') return true
  return false
}

/** The central probe cannot place emitter highlights correctly on its own walls. */
export function usesLocalAreaSpecular(object: Object3D | null | undefined, material?: Material) {
  return (
    usesCabinAreaSpecular(object, material) ||
    (object?.userData.carShowroom === true &&
      (object.userData.showroomId !== 'floor' ||
        (object.userData.bakedFloorReflection === true &&
          object.userData.bakedFloorLocalLight === true)))
  )
}

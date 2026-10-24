import type { Object3D } from 'three'

/** Exclude only the baked candidate's floor ray origins, never hit geometry,
 * native IBL, direct lighting, contact shadows or diffuse GI.
 */
export function usesBakedFloorReflection(object: Object3D | undefined): boolean {
  return (
    object?.userData.carShowroom === true &&
    object.userData.showroomId === 'floor' &&
    object.userData.bakedFloorReflection === true
  )
}

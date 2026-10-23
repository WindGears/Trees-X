import type { Object3D } from 'three'

/** The central probe cannot place emitter highlights correctly on its own walls. */
export function usesLocalAreaSpecular(object: Object3D | null | undefined) {
  return object?.userData.carShowroom === true && object.userData.showroomId !== 'floor'
}

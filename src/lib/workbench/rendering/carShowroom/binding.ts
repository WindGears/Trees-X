import type { Object3D, Texture } from 'three'
import type { CarShowroomConfig } from './config'

export interface ShowroomEnvironmentBinding {
  texture: Texture
  irradiance: Texture
  config: CarShowroomConfig
}
const bindings = new WeakMap<Object3D, ShowroomEnvironmentBinding>()
export interface ShowroomStatus {
  phase: string
  error: string | null
}
const statuses = new WeakMap<Object3D, ShowroomStatus>()
export function setShowroomStatus(scene: Object3D, value?: ShowroomStatus) {
  if (value) statuses.set(scene, value)
  else statuses.delete(scene)
}
export function getShowroomStatus(scene: Object3D) {
  return statuses.get(scene)
}

/** Scene-local data, not a singleton environment or a material.envMap override. */
export function setShowroomEnvironment(scene: Object3D, value?: ShowroomEnvironmentBinding) {
  if (value) bindings.set(scene, value)
  else bindings.delete(scene)
}
export function getShowroomEnvironment(scene: Object3D) {
  return bindings.get(scene)
}

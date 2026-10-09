import { inject, provide, shallowRef, type InjectionKey } from 'vue'
import type { Vec3 } from './types'
export interface CameraSnapshot {
  slug: string
  revision: number
  position: Vec3
  target: Vec3
}
interface Selection {
  slug: string
  revision: number
  ready: boolean
  active: boolean
}
export function createCameraCaptureSession(selection: () => Selection) {
  const registered = shallowRef(false)
  let reader: (() => CameraSnapshot | undefined) | undefined, owner: symbol | undefined
  return {
    registered,
    register(callback: () => CameraSnapshot | undefined) {
      const token = Symbol('camera-reader')
      owner = token
      reader = callback
      registered.value = true
      return () => {
        if (owner === token) {
          reader = undefined
          owner = undefined
          registered.value = false
        }
      }
    },
    capture(): CameraSnapshot | undefined {
      const current = { ...selection() }
      if (!current.ready || !current.active) return
      const snapshot = reader?.(),
        after = selection()
      if (
        !snapshot ||
        !after.ready ||
        !after.active ||
        snapshot.slug !== after.slug ||
        snapshot.revision !== after.revision ||
        current.slug !== after.slug ||
        current.revision !== after.revision
      )
        return
      if (![...snapshot.position, ...snapshot.target].every(Number.isFinite)) return
      return { ...snapshot, position: [...snapshot.position], target: [...snapshot.target] }
    },
    clear() {
      owner = undefined
      reader = undefined
      registered.value = false
    },
  }
}
const key: InjectionKey<ReturnType<typeof createCameraCaptureSession>> = Symbol('camera-capture')
export function provideCameraCaptureSession(
  session: ReturnType<typeof createCameraCaptureSession>,
) {
  provide(key, session)
}
export function useCameraCaptureSession() {
  return inject(key, undefined)
}

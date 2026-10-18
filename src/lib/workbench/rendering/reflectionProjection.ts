import { Matrix4, PerspectiveCamera, REVISION, type Camera } from 'three'
import type ReflectorNode from 'three/src/nodes/utils/ReflectorNode.js'

const owners = new WeakSet<object>()

/**
 * r185 mirrors the camera's right axis but copies its off-axis projection unchanged.
 * Mirror the horizontal principal point before its oblique clip-plane calculation,
 * retaining the reflector's native flipX sampling and full render-target coverage.
 */
export function bindReflectionProjection(reflector: ReflectorNode, revision = REVISION) {
  if (revision !== '185') throw new Error('Reflection projection requires reviewed Three r185')
  const base = reflector?.reflector
  if (
    !base ||
    typeof base.getVirtualCamera !== 'function' ||
    typeof base.updateBefore !== 'function' ||
    !(base.virtualCameras instanceof WeakMap) ||
    !(base.renderTargets instanceof Map)
  ) {
    throw new Error('Reflection projection cannot use changed Three r185 internals')
  }
  if (owners.has(base)) throw new Error('Reflection projection already owns this reflector')

  const original = base.getVirtualCamera,
    descriptor = Object.getOwnPropertyDescriptor(base, 'getVirtualCamera'),
    matrices = new Map<Matrix4, () => void>()
  let disposed = false
  const getVirtualCamera = (camera: Camera) => {
    if (!(camera instanceof PerspectiveCamera))
      throw new Error('Reflection projection requires a PerspectiveCamera')
    const virtual = original.call(base, camera),
      projection = virtual.projectionMatrix
    if (
      virtual === camera ||
      projection === camera.projectionMatrix ||
      !(projection instanceof Matrix4) ||
      typeof projection.copy !== 'function'
    ) {
      throw new Error('Reflection projection requires an independent virtual projection')
    }
    if (!matrices.has(projection)) {
      const originalCopy = projection.copy,
        copyDescriptor = Object.getOwnPropertyDescriptor(projection, 'copy')
      function copy(this: Matrix4, source: Matrix4) {
        const result = originalCopy.call(this, source)
        // Other matrix copies, including external snapshots, retain normal Matrix4 semantics.
        if (this === projection && source === camera.projectionMatrix)
          this.elements[8] = -this.elements[8]!
        return result
      }
      projection.copy = copy
      matrices.set(projection, () => {
        if (projection.copy !== copy) return
        if (copyDescriptor) Object.defineProperty(projection, 'copy', copyDescriptor)
        else Reflect.deleteProperty(projection, 'copy')
      })
    }
    return virtual
  }
  base.getVirtualCamera = getVirtualCamera
  owners.add(base)

  return () => {
    if (disposed) return
    disposed = true
    if (base.getVirtualCamera === getVirtualCamera) {
      if (descriptor) Object.defineProperty(base, 'getVirtualCamera', descriptor)
      else Reflect.deleteProperty(base, 'getVirtualCamera')
    }
    for (const restore of matrices.values()) restore()
    matrices.clear()
    owners.delete(base)
  }
}

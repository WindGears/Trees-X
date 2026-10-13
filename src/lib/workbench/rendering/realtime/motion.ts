import { InstancedMesh, Matrix4, Mesh, Vector2, Vector4, type Camera, type Object3D } from 'three'
import type { Node } from 'three/webgpu'
import {
  Fn,
  buffer,
  cameraProjectionMatrix,
  instanceIndex,
  modelViewMatrix,
  positionGeometry,
  positionLocal,
  renderGroup,
  uniform,
  vec2,
  vec4,
} from 'three/tsl'

interface MotionEntry {
  object: Object3D
  previousWorld: Matrix4
  currentWorld: Matrix4
  previousInstances?: Float32Array
  currentInstances?: Float32Array
  instanceNode?: ReturnType<typeof createInstanceHistoryNode>
  seen: number
}

function createInstanceHistoryNode(array: Float32Array, count: number) {
  // Three TSL adds .element to BufferNode at runtime; @types/three r185 only
  // declares it for ArrayNode/StorageBufferNode. Keep this missing declaration
  // local and precise rather than widening the rest of the render API.
  return buffer(array, 'mat4' as const, count) as ReturnType<
    typeof buffer<'mat4', Float32Array>
  > & { element(index: Node | number): Node<'mat4'> }
}

/**
 * Rigid motion history owned by the complete displayed frame, rather than by a
 * draw call. In r185 native velocity/previousInstanceMatrix advance after each
 * object draw, so a reflection or shadow pass can otherwise consume the history.
 *
 * Attach `node` under MRT name `motion`, never `velocity`. This avoids Three's
 * automatic positionPrevious path. Only rigid geometry is supported here;
 * skinned/morphed vertex history needs its own adapter before it can use this.
 */
export function createMotionHistory(camera: Camera) {
  const entries = new Map<Object3D, MotionEntry>()
  const previousProjection = uniform(new Matrix4()).setGroup(renderGroup)
  const previousView = uniform(new Matrix4()).setGroup(renderGroup)
  const currentProjection = new Matrix4(),
    currentView = new Matrix4()
  let root: Object3D | undefined,
    epoch = 0,
    frameOpen = false,
    initialized = false,
    disposed = false

  function assertLive() {
    if (disposed) throw new Error('Motion history has been disposed')
  }

  function register(object: Object3D): MotionEntry {
    let entry = entries.get(object)
    if (!entry) {
      entry = {
        object,
        previousWorld: object.matrixWorld.clone(),
        currentWorld: object.matrixWorld.clone(),
        seen: epoch,
      }
      if (object instanceof InstancedMesh) {
        const count = Math.max(object.instanceMatrix.count, 1)
        // A mat4 UBO uses 64 bytes; WebGPU guarantees 64 KiB per uniform binding.
        // Reject an unsupported batch instead of silently truncating its history.
        if (count > 1024)
          throw new Error('Rigid motion history supports at most 1024 instances per batch')
        entry.previousInstances = new Float32Array(count * 16)
        entry.previousInstances.set(object.instanceMatrix.array)
        entry.currentInstances = entry.previousInstances.slice()
        entry.instanceNode = createInstanceHistoryNode(entry.previousInstances, count)
      }
      entries.set(object, entry)
    }
    entry.seen = epoch
    return entry
  }

  const visit = (object: Object3D) => {
    if (object instanceof Mesh) register(object)
  }

  function registerRoot(value: Object3D) {
    root = value
    epoch++
    value.traverse(visit)
    for (const [object, entry] of entries) if (entry.seen !== epoch) entries.delete(object)
  }

  const previousWorld = uniform(new Matrix4()).onObjectUpdate(({ object }, self) => {
    if (!object) throw new Error('Motion uniform requires a rendered object')
    return self.value.copy(register(object).previousWorld)
  })

  const node = Fn((builder) => {
    assertLive()
    const object = builder.object
    // Sky/backdrop shaders directly override clip space. Their raw positions
    // cannot be interpreted as rigid geometry; depth rejection excludes them
    // from lighting history and an explicit zero avoids a false moving sky.
    if ('vertexNode' in builder.material && builder.material.vertexNode) return vec2(0)
    if (object instanceof Mesh && (object.morphTargetInfluences || 'isSkinnedMesh' in object)) {
      throw new Error('Rigid motion history cannot represent morph or skin deformation')
    }
    const entry = register(object)
    const previousPosition = entry.instanceNode
      ? entry.instanceNode.element(instanceIndex).mul(vec4(positionGeometry, 1))
      : vec4(positionGeometry, 1)
    // Explicit vertex varyings retain perspective-correct interpolation and do
    // not read positionPrevious or allow an offscreen draw to advance history.
    const currentClip = cameraProjectionMatrix
      .mul(modelViewMatrix)
      .mul(vec4(positionLocal, 1))
      .toVarying('trees_x_motion_current_clip')
    const previousClip = previousProjection
      .mul(previousView)
      .mul(previousWorld)
      .mul(previousPosition)
      .toVarying('trees_x_motion_previous_clip')
    return vec2(currentClip.xy.div(currentClip.w).sub(previousClip.xy.div(previousClip.w)))
  })()

  function captureCurrent() {
    currentProjection.copy(camera.projectionMatrix)
    currentView.copy(camera.matrixWorldInverse)
    for (const entry of entries.values()) {
      entry.currentWorld.copy(entry.object.matrixWorld)
      if (entry.object instanceof InstancedMesh && entry.currentInstances) {
        if (entry.object.instanceMatrix.array.length !== entry.currentInstances.length) {
          throw new Error('Instance capacity changed; rebuild the rigid motion host')
        }
        entry.currentInstances.set(entry.object.instanceMatrix.array)
      }
    }
  }

  function commitCurrent() {
    previousProjection.value.copy(currentProjection)
    previousView.value.copy(currentView)
    for (const entry of entries.values()) {
      entry.previousWorld.copy(entry.currentWorld)
      if (entry.previousInstances && entry.currentInstances) {
        entry.previousInstances.set(entry.currentInstances)
      }
    }
  }

  // Scratch vectors/matrix are allocated once. This is a diagnostic oracle for
  // browser/unit verification, not a per-pixel CPU motion calculation.
  const currentPoint = new Vector4(),
    previousPoint = new Vector4(),
    instanceMatrix = new Matrix4()

  return {
    node,
    beginFrame(value: Object3D) {
      assertLive()
      if (frameOpen) throw new Error('A complete motion frame is already open')
      value.updateMatrixWorld(true)
      camera.updateMatrixWorld(true)
      if (root !== value) registerRoot(value)
      captureCurrent()
      if (!initialized) {
        commitCurrent()
        initialized = true
      }
      frameOpen = true
    },
    /** Call exactly once, after the final presentation draw has completed. */
    commitFrame() {
      assertLive()
      if (!frameOpen) throw new Error('No complete motion frame to commit')
      commitCurrent()
      frameOpen = false
    },
    /** Failed/aborted draws do not become the previous displayed frame. */
    cancelFrame() {
      frameOpen = false
    },
    /** Call for a camera cut, topology replacement, resize or device restore. */
    reset(value: Object3D) {
      assertLive()
      value.updateMatrixWorld(true)
      camera.updateMatrixWorld(true)
      registerRoot(value)
      captureCurrent()
      commitCurrent()
      initialized = true
      frameOpen = false
    },
    sample(object: Object3D, vertex: Vector4, target: Vector2, instance = 0) {
      assertLive()
      const entry = entries.get(object)
      if (!entry) throw new Error('Object has not joined the rigid motion history')
      currentPoint.copy(vertex)
      previousPoint.copy(vertex)
      if (entry.currentInstances && entry.previousInstances) {
        const offset = instance * 16
        if (offset < 0 || offset + 16 > entry.currentInstances.length) {
          throw new Error('Invalid instance in rigid motion sample')
        }
        currentPoint.applyMatrix4(instanceMatrix.fromArray(entry.currentInstances, offset))
        previousPoint.applyMatrix4(instanceMatrix.fromArray(entry.previousInstances, offset))
      }
      currentPoint
        .applyMatrix4(entry.currentWorld)
        .applyMatrix4(currentView)
        .applyMatrix4(currentProjection)
      previousPoint
        .applyMatrix4(entry.previousWorld)
        .applyMatrix4(previousView.value)
        .applyMatrix4(previousProjection.value)
      return target.set(
        currentPoint.x / currentPoint.w - previousPoint.x / previousPoint.w,
        currentPoint.y / currentPoint.w - previousPoint.y / previousPoint.w,
      )
    },
    stats() {
      let instances = 0
      for (const entry of entries.values()) instances += (entry.previousInstances?.length ?? 0) / 16
      return { objects: entries.size, instances, historyBytes: instances * 16 * 4, frameOpen }
    },
    dispose() {
      if (disposed) return
      disposed = true
      frameOpen = false
      entries.clear()
      root = undefined
      // Arrays are uniforms, not attributes attached to loader geometry. The
      // renderer owns their GPU UBOs; material/render-object teardown releases
      // those bindings. No source geometry/material/texture is disposed here.
    },
  }
}

import {
  Box3,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Ray,
  Vector3,
  type Camera,
  type Material,
  type Mesh,
} from 'three'
import {
  MeshBasicNodeMaterial,
  MeshPhysicalNodeMaterial,
  MeshStandardNodeMaterial,
} from 'three/webgpu'
import { uniform } from 'three/tsl'
import gsap from 'gsap'

function fadeMaterial(source: Material) {
  if (source instanceof MeshPhysicalMaterial) return new MeshPhysicalNodeMaterial().copy(source)
  if (source instanceof MeshStandardMaterial) return new MeshStandardNodeMaterial().copy(source)
  if (source instanceof MeshBasicMaterial) return new MeshBasicNodeMaterial().copy(source)
  throw new Error(`Unsupported showroom cutaway material: ${source.type}`)
}

/** Main-camera-only derived materials. The opaque source remains the DDGI view. */
export function createShowroomCutaway(
  meshes: readonly Mesh[],
  mainCamera: Camera,
  targetBox: Box3,
) {
  const ray = new Ray(),
    cameraPosition = new Vector3(),
    hit = new Vector3(),
    target = new Box3().copy(targetBox),
    points = Array.from({ length: 9 }, () => new Vector3()),
    entries = meshes.map((mesh) => {
      if (Array.isArray(mesh.material))
        throw new Error('Showroom cutaway requires single materials')
      mesh.updateWorldMatrix(true, false)
      mesh.geometry.computeBoundingBox()
      const source = mesh.material,
        material = fadeMaterial(source),
        opacity = uniform(1),
        bounds = new Box3().copy(mesh.geometry.boundingBox!).applyMatrix4(mesh.matrixWorld),
        before = mesh.onBeforeRender,
        after = mesh.onAfterRender,
        traceDescriptor = Object.getOwnPropertyDescriptor(mesh.userData, 'traceMaterial')
      // Fully faded fragments discard before writing depth; visible architecture
      // retains depth so overlapping wall/cove silhouettes stay correctly ordered.
      material.transparent = true
      material.depthWrite = true
      material.alphaTest = 0.01
      material.forceSinglePass = true
      material.opacityNode = opacity
      material.name = `${source.name || mesh.name} / camera cutaway`
      mesh.material = material
      mesh.userData.traceMaterial = source
      const state = { value: 1, target: 1, elapsed: 0 }
      let tween: gsap.core.Tween | undefined
      mesh.onBeforeRender = function (renderer, scene, camera, geometry, renderedMaterial, group) {
        before.call(this, renderer, scene, camera, geometry, renderedMaterial, group)
        opacity.value = camera === mainCamera ? state.value : 1
      }
      mesh.onAfterRender = function (renderer, scene, camera, geometry, renderedMaterial, group) {
        opacity.value = 1
        after.call(this, renderer, scene, camera, geometry, renderedMaterial, group)
      }
      return {
        mesh,
        material,
        source,
        bounds,
        state,
        opacity,
        before,
        after,
        traceDescriptor,
        change(blocked: boolean, reduced: boolean) {
          const destination = blocked ? 0 : 1
          if (destination !== state.target) {
            tween?.kill()
            state.target = destination
            state.elapsed = 0
            tween = reduced
              ? undefined
              : gsap.to(state, {
                  value: destination,
                  duration: 0.24,
                  ease: 'power2.out',
                  paused: true,
                })
          }
          if (reduced) {
            tween?.kill()
            tween = undefined
            state.value = destination
          }
        },
        advance(delta: number) {
          if (tween) {
            state.elapsed += Math.max(0, Math.min(delta, 0.1))
            tween.totalTime(state.elapsed, true)
            if (state.elapsed >= 0.24) {
              tween.kill()
              tween = undefined
              state.value = state.target
            }
          }
        },
        restore() {
          tween?.kill()
          if (mesh.material === material) mesh.material = source
          mesh.onBeforeRender = before
          mesh.onAfterRender = after
          if (traceDescriptor)
            Object.defineProperty(mesh.userData, 'traceMaterial', traceDescriptor)
          else delete mesh.userData.traceMaterial
          material.dispose()
        },
      }
    })
  function setPoints() {
    target.getCenter(points[0]!)
    for (let index = 0; index < 8; index++)
      points[index + 1]!.set(
        index & 1 ? target.max.x : target.min.x,
        index & 2 ? target.max.y : target.min.y,
        index & 4 ? target.max.z : target.min.z,
      )
  }
  setPoints()
  let disposed = false
  return {
    setTargetBox(next: Box3) {
      target.copy(next)
      setPoints()
    },
    /** Advances paused GSAP transitions using the existing renderer clock only. */
    tick(delta: number, reducedMotion = false) {
      if (disposed) return
      mainCamera.getWorldPosition(cameraPosition)
      ray.origin.copy(cameraPosition)
      for (const entry of entries) {
        let blocked = false
        for (const point of points) {
          ray.direction.subVectors(point, cameraPosition).normalize()
          if (
            ray.intersectBox(entry.bounds, hit) &&
            hit.distanceToSquared(cameraPosition) < point.distanceToSquared(cameraPosition) - 0.001
          ) {
            blocked = true
            break
          }
        }
        entry.change(blocked, reducedMotion)
        entry.advance(delta)
      }
    },
    /** Called on demand for diagnostics, never from a per-frame reactive binding. */
    snapshot() {
      return entries.map(({ mesh, state }) => ({
        id: String(mesh.userData.showroomId ?? mesh.name),
        opacity: state.value,
        targetOpacity: state.target,
      }))
    },
    dispose() {
      if (disposed) return
      disposed = true
      for (const entry of entries) entry.restore()
    },
  }
}

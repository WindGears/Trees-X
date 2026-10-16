import { Box3, InstancedMesh, Matrix4, Mesh, REVISION, Vector3, type Object3D } from 'three'
import {
  NodeMaterial,
  type Node,
  type PerspectiveCamera,
  type Scene,
  type TextureNode,
} from 'three/webgpu'
import { uniform } from 'three/tsl'
import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js'
import GaussianBlurNode from 'three/addons/tsl/display/GaussianBlurNode.js'
import { resolveLoungeProjection } from './loungeSpatialMode'

export function resolveLoungeDof(
  search = typeof window === 'undefined' ? '' : window.location.search,
) {
  return (
    resolveLoungeProjection(search) !== 'infinite' &&
    new URLSearchParams(search).get('loungeDof') === '1'
  )
}

interface BoundsEntry {
  mesh: Mesh
  world: Matrix4
  instanceVersion: number
  instanceCount: number
}

/** Local numeric uniforms only. The loader remains the owner of product resources. */
export function createLoungeDofFocus(scene: Scene, camera: PerspectiveCamera, enabled: boolean) {
  const focus = uniform(0),
    clearFar = uniform(camera.far),
    falloff = uniform(3),
    bounds = new Box3(),
    corners = Array.from({ length: 8 }, () => new Vector3()),
    entries: BoundsEntry[] = [],
    metadata = { enabled, active: false, focus: 0, near: 0, far: camera.far, boundsUpdates: 0 }
  scene.userData.loungeDof = metadata
  let root: Object3D | undefined,
    disposed = false

  const register = (object: Object3D) => {
    if (!(object instanceof Mesh)) return
    // Warm up cached boxes once; subsequent pose updates reuse their storage.
    if (object.geometry.boundingBox === null) object.geometry.computeBoundingBox()
    if (object instanceof InstancedMesh) object.computeBoundingBox()
    entries.push({
      mesh: object,
      world: object.matrixWorld.clone(),
      instanceVersion: object instanceof InstancedMesh ? object.instanceMatrix.version : -1,
      instanceCount: object instanceof InstancedMesh ? object.count : 0,
    })
  }

  function clear() {
    metadata.active = false
    metadata.focus = focus.value = 0
    metadata.near = 0
    metadata.far = clearFar.value = camera.far
  }

  return {
    enabled,
    metadata,
    focus,
    clearFar,
    falloff,
    /** Official r185 focalLength means world-unit falloff, not lens millimeters.
     * Collapse the whole product band (and foreground) to the focal plane;
     * only distances beyond the farthest current product corner gain CoC.
     */
    viewZ(viewZ: Node<'float'>) {
      return viewZ.negate().sub(clearFar).max(0).add(focus).negate()
    },
    prepare() {
      if (disposed || !enabled) return
      // controller adds the actual adapter root directly to this scene. Never
      // include the table, panorama or the reflected product in its focus box.
      let next: Object3D | undefined
      for (const child of scene.children)
        if (child.userData.workbenchProduct === 'typewriter-study') {
          next = child
          break
        }
      let dirty = next !== root
      if (dirty) {
        root = next
        entries.length = 0
        root?.updateWorldMatrix(true, true)
        root?.traverse(register)
      }
      if (!root) {
        clear()
        return
      }
      root.updateWorldMatrix(true, true)
      for (const entry of entries) {
        const mesh = entry.mesh,
          instanced = mesh instanceof InstancedMesh,
          version = instanced ? mesh.instanceMatrix.version : -1,
          count = instanced ? mesh.count : 0,
          instancesChanged = version !== entry.instanceVersion || count !== entry.instanceCount
        if (!mesh.matrixWorld.equals(entry.world) || instancesChanged) dirty = true
        // Three does not invalidate InstancedMesh.boundingBox on setMatrixAt.
        // Layout/strike update the matrix version; refresh before setFromObject.
        if (instanced && instancesChanged) mesh.computeBoundingBox()
        entry.world.copy(mesh.matrixWorld)
        entry.instanceVersion = version
        entry.instanceCount = count
      }
      if (dirty) {
        bounds.setFromObject(root)
        metadata.boundsUpdates++
      }
      if (bounds.isEmpty()) {
        clear()
        return
      }
      camera.updateWorldMatrix(true, false)
      let near = Infinity,
        far = -Infinity
      for (let index = 0; index < 8; index++) {
        const corner = corners[index]!
        corner
          .set(
            index & 1 ? bounds.max.x : bounds.min.x,
            index & 2 ? bounds.max.y : bounds.min.y,
            index & 4 ? bounds.max.z : bounds.min.z,
          )
          .applyMatrix4(camera.matrixWorldInverse)
        near = Math.min(near, -corner.z)
        far = Math.max(far, -corner.z)
      }
      if (!Number.isFinite(near) || !Number.isFinite(far) || far <= camera.near) {
        clear()
        return
      }
      const padding = Math.max(0.12, (far - near) * 0.08)
      metadata.near = Math.max(camera.near, near - padding)
      metadata.far = clearFar.value = far + padding
      metadata.focus = focus.value = (metadata.near + metadata.far) * 0.5
      falloff.value = Math.max(3, (metadata.far - metadata.near) * 2)
      metadata.active = true
    },
    dispose() {
      if (disposed) return
      disposed = true
      entries.length = 0
      root = undefined
      if (scene.userData.loungeDof === metadata) delete scene.userData.loungeDof
    },
  }
}

/** r185 DOF owns its six targets/five materials, but omits the GaussianBlurNode
 * created during setup. A local checked wrapper also releases that child when
 * rebuilding; no global prototype or shared QuadMesh geometry is touched.
 */
export function createOwnedLoungeDof(
  input: TextureNode,
  viewZ: Node<'float'>,
  focus: ReturnType<typeof createLoungeDofFocus>,
  revision = REVISION,
) {
  if (revision !== '185') throw new Error('DOF ownership must be reviewed for this Three revision')
  const effect = dof(input, focus.viewZ(viewZ), focus.focus, focus.falloff, 2),
    material: unknown = Reflect.get(effect, '_CoCBlurredMaterial')
  if (!(material instanceof NodeMaterial) || material.colorNode !== null) {
    effect.dispose()
    throw new Error('The inspected r185 DOF ownership contract changed')
  }
  const setup = effect.setup
  let child: GaussianBlurNode | undefined,
    disposed = false
  effect.setup = function (builder) {
    child?.dispose()
    child = undefined
    const output = setup.call(this, builder),
      next = material.colorNode
    if (!(next instanceof GaussianBlurNode))
      throw new Error('The inspected r185 DOF Gaussian child contract changed')
    child = next
    return output
  }
  return {
    // Half-resolution official blur can interpolate CoC across silhouettes.
    // Retain exact HDR beauty for all pixels in front of the clear-band edge.
    node: viewZ.negate().greaterThan(focus.clearFar).select(effect, input),
    effect,
    dispose() {
      if (disposed) return
      disposed = true
      try {
        child?.dispose()
      } finally {
        child = undefined
        effect.dispose()
      }
    },
  }
}

import { Mesh, MeshPhysicalMaterial, MeshStandardMaterial, type Group, type Material } from 'three'
import { MeshPhysicalNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu'
import { realtimeMaterialSupported } from '../realtime/materials'

/** Unsupported Physical branches keep native shading, but need the room's local
 * environment hook too. Source textures and source materials remain borrowed.
 */
export function ownShowroomNativeMaterials(root: Group) {
  const clones = new Map<Material, Material>(),
    meshes: { mesh: Mesh; source: Material | Material[]; runtime: Material | Material[] }[] = []
  function convert(source: Material) {
    if (!(source instanceof MeshStandardMaterial)) return source
    const supported = Boolean(realtimeMaterialSupported(source))
    if (supported) return source
    let runtime = clones.get(source)
    if (!runtime) {
      runtime =
        source instanceof MeshPhysicalMaterial
          ? new MeshPhysicalNodeMaterial().copy(source)
          : new MeshStandardNodeMaterial().copy(source)
      Object.defineProperty(runtime, 'source', { value: source })
      clones.set(source, runtime)
    }
    return runtime
  }
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return
    const source = object.material,
      runtime = Array.isArray(source) ? source.map(convert) : convert(source)
    if (
      source === runtime ||
      (Array.isArray(source) && Array.isArray(runtime) && source.every((m, i) => m === runtime[i]))
    )
      return
    object.material = runtime
    meshes.push({ mesh: object, source, runtime })
  })
  let disposed = false
  return {
    sync() {
      if (disposed) return
      for (const [source, runtime] of clones) {
        if (
          !(source instanceof MeshStandardMaterial) ||
          !(runtime instanceof MeshStandardNodeMaterial)
        )
          continue
        runtime.color.copy(source.color)
        runtime.emissive.copy(source.emissive)
        runtime.emissiveIntensity = source.emissiveIntensity
        runtime.roughness = source.roughness
        runtime.metalness = source.metalness
        runtime.envMapIntensity = source.envMapIntensity
      }
    },
    dispose() {
      if (disposed) return
      disposed = true
      for (const entry of meshes)
        if (entry.mesh.material === entry.runtime) entry.mesh.material = entry.source
      for (const material of clones.values()) material.dispose()
      clones.clear()
      meshes.length = 0
    },
  }
}

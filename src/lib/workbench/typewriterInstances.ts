import {
  Color,
  DynamicDrawUsage,
  InstancedMesh,
  Matrix4,
  Mesh,
  type Material,
  type Object3D,
} from 'three'
import type { TypewriterPart } from './typewriterRig'

export function instanceTypewriter(
  model: Object3D,
  parts: TypewriterPart[],
  nodes: Map<string, Object3D>,
) {
  interface Surface {
    node: Object3D
    local: Matrix4
  }
  interface Batch {
    original: Mesh
    material: Material
    items: Surface[]
    mesh?: InstancedMesh
  }
  const batches = new Map<string, Batch>(),
    originals: Mesh[] = []
  const inverse = new Matrix4()
  model.updateMatrixWorld(true)
  for (const part of parts) {
    const node = nodes.get(part.node)!
    inverse.copy(node.matrixWorld).invert()
    node.traverse((child) => {
      if (!(child instanceof Mesh)) return
      if (Array.isArray(child.material)) throw new Error('打字机多材质网格尚未分开')
      const key = child.geometry.uuid + ':' + child.material.uuid
      let batch = batches.get(key)
      if (!batch) {
        batch = { original: child, material: child.material, items: [] }
        batches.set(key, batch)
      }
      batch.items.push({ node, local: new Matrix4().multiplyMatrices(inverse, child.matrixWorld) })
      originals.push(child)
    })
  }
  const normal = new Color(1, 1, 1),
    context = new Color(0.56, 0.57, 0.54),
    selected = new Color(1.12, 1.08, 1)
  const lookup = new Map<Object3D, Surface[]>()
  for (const batch of batches.values()) {
    const mesh = new InstancedMesh(batch.original.geometry, batch.material, batch.items.length)
    mesh.name = 'typewriter-batch-' + lookup.size
    mesh.castShadow = !batch.material.transparent
    mesh.receiveShadow = true
    mesh.frustumCulled = false
    mesh.instanceMatrix.setUsage(DynamicDrawUsage)
    for (let i = 0; i < batch.items.length; i++) mesh.setColorAt(i, normal)
    mesh.renderOrder = batch.original.renderOrder
    model.add(mesh)
    batch.mesh = mesh
    lookup.set(mesh, batch.items)
  }
  originals.forEach((mesh) => mesh.removeFromParent())
  const matrix = new Matrix4()
  return {
    update() {
      for (const batch of batches.values()) {
        const mesh = batch.mesh!
        for (let i = 0; i < batch.items.length; i++) {
          const surface = batch.items[i]!
          surface.node.updateMatrix()
          mesh.setMatrixAt(i, matrix.multiplyMatrices(surface.node.matrix, surface.local))
        }
        mesh.instanceMatrix.needsUpdate = true
        mesh.boundingSphere = null
      }
      model.updateMatrixWorld(true)
    },
    select(name?: string) {
      for (const batch of batches.values()) {
        const mesh = batch.mesh!
        batch.items.forEach((surface, index) =>
          mesh.setColorAt(index, !name ? normal : surface.node.name === name ? selected : context),
        )
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      }
    },
    nodeForHit(object: Object3D, instanceId?: number) {
      return instanceId == null ? object : lookup.get(object)?.[instanceId]?.node
    },
    dispose() {
      for (const batch of batches.values()) {
        batch.mesh?.removeFromParent()
        batch.mesh?.dispose()
      }
      lookup.clear()
      batches.clear()
      // Loader retains ownership of all shared geometry, materials and textures.
    },
  }
}

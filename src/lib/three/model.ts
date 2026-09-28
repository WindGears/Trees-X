import { Box3, Mesh, Texture, Vector3 } from 'three'
import type { BufferGeometry, Material, Object3D } from 'three'

export const MODEL_BUDGET = { triangles: 100_000, bytes: 5 * 1024 * 1024 } as const

export function inspectModel(root: Object3D) {
  let triangles = 0
  let meshes = 0
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return
    meshes += 1
    triangles +=
      (object.geometry.index?.count ?? object.geometry.attributes.position?.count ?? 0) / 3
  })
  if (!meshes || !triangles) throw new Error('模型中没有可显示的网格。')
  if (triangles > MODEL_BUDGET.triangles) throw new Error('模型超过 10 万三角形，请优化后重试。')
  return { triangles, meshes }
}

export function normalizeModel(root: Object3D, longestSide = 2.8) {
  root.updateMatrixWorld(true)
  const bounds = new Box3().setFromObject(root)
  const size = bounds.getSize(new Vector3())
  const largest = Math.max(size.x, size.y, size.z)
  if (!Number.isFinite(largest) || largest <= 0) throw new Error('模型尺寸无效。')
  const center = bounds.getCenter(new Vector3())
  const scale = longestSide / largest
  root.scale.multiplyScalar(scale)
  root.position.sub(center).multiplyScalar(scale)
  root.updateMatrixWorld(true)
}

export function disposeModel(root: Object3D) {
  const geometries = new Set<BufferGeometry>()
  const materials = new Set<Material>()
  const textures = new Set<Texture>()
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return
    geometries.add(object.geometry)
    const list: Material[] = Array.isArray(object.material) ? object.material : [object.material]
    for (const material of list) materials.add(material)
  })
  for (const material of materials) {
    for (const value of Object.values(material)) {
      if (value instanceof Texture) textures.add(value)
    }
    material.dispose()
  }
  const bitmaps = new Set<ImageBitmap>()
  for (const texture of textures) {
    if (typeof ImageBitmap !== 'undefined' && texture.source.data instanceof ImageBitmap) {
      bitmaps.add(texture.source.data)
    }
    texture.dispose()
  }
  for (const bitmap of bitmaps) bitmap.close()
  for (const geometry of geometries) geometry.dispose()
  root.removeFromParent()
}

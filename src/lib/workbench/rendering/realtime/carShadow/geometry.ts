import {
  BufferAttribute,
  BufferGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
} from 'three'
import type { Material, Object3D } from 'three'

export interface CarShadowBinding {
  source: Mesh
  proxy: InstancedMesh
  matrix: Matrix4
  visible: boolean
}

export interface CarShadowGeometrySet {
  bindings: CarShadowBinding[]
  geometries: BufferGeometry[]
  material: MeshBasicMaterial
  triangles: number
  excludedMeshes: number
  dispose(): void
}

/** Deliberately conservative: no transmission, cutouts, blending, or invisible materials. */
export function carShadowOpaqueMaterial(material: Material | undefined): boolean {
  if (!material || !material.visible || material.transparent || material.opacity < 1) return false
  const physical = material as Material & { transmission?: number; alphaMap?: unknown }
  return !material.alphaTest && !physical.alphaMap && !(physical.transmission ?? 0)
}

export function carShadowSourceVisible(object: Object3D): boolean {
  for (let current: Object3D | null = object; current; current = current.parent) {
    if (!current.visible) return false
  }
  return true
}

/** Clone only rendered opaque triangles; never copy or transfer loader-owned attributes. */
export function collectCarShadowGeometry(root: Object3D): CarShadowGeometrySet {
  const bindings: CarShadowBinding[] = []
  const geometries: BufferGeometry[] = []
  const cache = new Map<BufferGeometry, Map<string, BufferGeometry>>()
  const material = new MeshBasicMaterial()
  const identity = new Matrix4()
  let triangles = 0
  let excludedMeshes = 0
  let disposed = false
  const dispose = () => {
    if (disposed) return
    disposed = true
    bindings.forEach(({ proxy }) => proxy.dispose())
    geometries.forEach((geometry) => geometry.dispose())
    material.dispose()
    cache.clear()
    bindings.length = 0
  }
  try {
    root.updateWorldMatrix(true, true)
    root.traverse((object) => {
      if (!(object instanceof Mesh)) return
      const ranges = opaqueRanges(object)
      if (!ranges.length) {
        excludedMeshes += 1
        return
      }
      const shape = object as Mesh & {
        isInstancedMesh?: boolean
        isBatchedMesh?: boolean
        isSkinnedMesh?: boolean
      }
      if (
        shape.isInstancedMesh ||
        shape.isBatchedMesh ||
        shape.isSkinnedMesh ||
        Object.values(object.geometry.morphAttributes).some(
          (attributes) => Array.isArray(attributes) && attributes.length > 0,
        )
      ) {
        throw new Error(`Car key shadow supports rigid Mesh only: ${object.name || object.uuid}`)
      }
      const key = ranges.map(({ start, count }) => `${start}:${count}`).join(',')
      let variants = cache.get(object.geometry)
      if (!variants) {
        variants = new Map()
        cache.set(object.geometry, variants)
      }
      let geometry = variants.get(key)
      if (!geometry) {
        geometry = cloneOpaqueGeometry(object.geometry, ranges)
        variants.set(key, geometry)
        geometries.push(geometry)
      }
      // A single identity instance selects BVHComputeData's rigid-object path. Ordinary
      // Mesh proxies are otherwise split into 64-triangle TLAS clusters by 0.9.16.
      // This is only a hidden traversal proxy; the loader's source remains a normal Mesh.
      const proxy = new InstancedMesh(geometry, material, 1)
      proxy.setMatrixAt(0, identity)
      proxy.name = `Car key shadow / ${object.name}`
      proxy.matrixAutoUpdate = false
      proxy.matrixWorldAutoUpdate = false
      proxy.matrix.copy(object.matrixWorld)
      proxy.matrixWorld.copy(object.matrixWorld)
      proxy.visible = carShadowSourceVisible(object)
      bindings.push({
        source: object,
        proxy,
        matrix: object.matrixWorld.clone(),
        visible: proxy.visible,
      })
      triangles += (geometry.index?.count ?? 0) / 3
    })
    if (!bindings.length) throw new Error('Car key shadow found no opaque triangle casters')
    return { bindings, geometries, material, triangles, excludedMeshes, dispose }
  } catch (error) {
    dispose()
    throw error
  }
}

interface Range {
  start: number
  count: number
}

function opaqueRanges(mesh: Mesh): Range[] {
  const geometry = mesh.geometry
  const total = geometry.index?.count ?? geometry.getAttribute('position')?.count ?? 0
  const drawStart = Math.max(0, geometry.drawRange.start)
  const drawEnd = Math.min(total, drawStart + geometry.drawRange.count)
  const materials = mesh.material
  const groups = Array.isArray(materials)
    ? geometry.groups.filter((group) =>
        carShadowOpaqueMaterial(materials[group.materialIndex ?? 0]),
      )
    : carShadowOpaqueMaterial(materials)
      ? [{ start: 0, count: total }]
      : []
  const ranges = groups
    .map((group) => {
      const start = Math.max(group.start, drawStart)
      const end = Math.min(group.start + group.count, drawEnd)
      return { start, count: Math.max(0, Math.floor((end - start) / 3) * 3) }
    })
    .filter((range) => range.count > 0)
  return ranges.sort((a, b) => a.start - b.start || a.count - b.count)
}

function cloneOpaqueGeometry(source: BufferGeometry, ranges: Range[]): BufferGeometry {
  const position = source.getAttribute('position')
  if (!position || position.itemSize < 3) throw new Error('Car key shadow requires POSITION vec3')
  const coordinates = new Float32Array(position.count * 3)
  for (let vertex = 0; vertex < position.count; vertex += 1) {
    const offset = vertex * 3
    coordinates[offset] = position.getX(vertex)
    coordinates[offset + 1] = position.getY(vertex)
    coordinates[offset + 2] = position.getZ(vertex)
    if (
      !Number.isFinite(coordinates[offset]! + coordinates[offset + 1]! + coordinates[offset + 2]!)
    ) {
      throw new Error('Car key shadow POSITION contains non-finite coordinates')
    }
  }
  const count = ranges.reduce((sum, range) => sum + range.count, 0)
  const indices = new Uint32Array(count)
  let write = 0
  for (const range of ranges) {
    for (let index = range.start; index < range.start + range.count; index += 1) {
      const vertex = source.index ? source.index.getX(index) : index
      if (!Number.isInteger(vertex) || vertex < 0 || vertex >= position.count) {
        throw new Error('Car key shadow index is outside POSITION')
      }
      indices[write++] = vertex
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(coordinates, 3))
  geometry.setIndex(new BufferAttribute(indices, 1))
  return geometry
}

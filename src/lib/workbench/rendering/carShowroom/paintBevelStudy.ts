import {
  BufferAttribute,
  BufferGeometry,
  Float32BufferAttribute,
  Mesh,
  Vector3,
  type Object3D,
} from 'three'
import { MeshStandardNodeMaterial } from 'three/webgpu'
import { attribute, materialColor, materialMetalness, materialRoughness, mix } from 'three/tsl'

/** Geometric selection, not a claim that these triangles are defective.
 * Widths are in the audited Reventon asset's local units. */
export function bevelStudyGeometry(source: BufferGeometry) {
  const geometry = source.index ? source.toNonIndexed() : source.clone()
  geometry.userData = { ...source.userData }
  const position = geometry.getAttribute('position')
  const mask = new Float32Array(position.count)
  const a = new Vector3(),
    b = new Vector3(),
    c = new Vector3()
  const ab = new Vector3(),
    ac = new Vector3(),
    cross = new Vector3()
  let selected = 0,
    totalArea = 0,
    selectedArea = 0
  for (let i = 0; i + 2 < position.count; i += 3) {
    a.fromBufferAttribute(position, i)
    b.fromBufferAttribute(position, i + 1)
    c.fromBufferAttribute(position, i + 2)
    ab.subVectors(b, a)
    ac.subVectors(c, a)
    const longest = Math.max(ab.length(), ac.length(), b.distanceTo(c))
    const doubleArea = cross.crossVectors(ab, ac).length()
    const width = longest > 0 ? doubleArea / longest : 0
    totalArea += doubleArea * 0.5
    if (doubleArea > 1e-12 && longest > 0.02 && width <= 0.006 && width / longest <= 0.25) {
      mask.fill(1, i, i + 3)
      selected++
      selectedArea += doubleArea * 0.5
    }
  }
  if (source.index) {
    // Reuse each original vertex within one surface selection. Only a vertex
    // shared by selected and unselected triangles needs two copies. No welding,
    // quantization, face reordering or normal recomputation is involved.
    const vertices = new Map<number, number>(),
      origins: number[] = [],
      indices: number[] = []
    const values: number[] = []
    for (let i = 0; i < source.index.count; i++) {
      const key = source.index.getX(i) * 2 + mask[i]!
      let vertex = vertices.get(key)
      if (vertex === undefined) {
        vertex = origins.length
        vertices.set(key, vertex)
        origins.push(i)
        values.push(mask[i]!)
      }
      indices.push(vertex)
    }
    const compact = (attribute: BufferAttribute) => {
      const array = attribute.array.slice(0, origins.length * attribute.itemSize)
      for (let i = 0; i < origins.length; i++)
        for (let j = 0; j < attribute.itemSize; j++)
          array[i * attribute.itemSize + j] = attribute.array[origins[i]! * attribute.itemSize + j]!
      const result = new BufferAttribute(array, attribute.itemSize, attribute.normalized)
      result.name = attribute.name
      result.gpuType = attribute.gpuType
      result.setUsage(attribute.usage)
      return result
    }
    // toNonIndexed() above creates independent BufferAttributes, including
    // formerly interleaved inputs. Guard that ownership assumption explicitly.
    for (const [name, attribute] of Object.entries(geometry.attributes)) {
      if (!(attribute instanceof BufferAttribute)) throw new Error('Expected owned paint attribute')
      geometry.setAttribute(name, compact(attribute))
    }
    for (const name of ['position', 'normal', 'color'] as const) {
      const attributes = geometry.morphAttributes[name]
      if (!attributes) continue
      geometry.morphAttributes[name] = attributes.map((attribute) => {
        if (!(attribute instanceof BufferAttribute))
          throw new Error('Expected owned paint morph attribute')
        return compact(attribute)
      })
    }
    geometry.setIndex(
      new BufferAttribute(
        origins.length > 65535 ? new Uint32Array(indices) : new Uint16Array(indices),
        1,
      ),
    )
    geometry.setAttribute('treesPaintBevel', new Float32BufferAttribute(values, 1))
  } else geometry.setAttribute('treesPaintBevel', new Float32BufferAttribute(mask, 1))
  return {
    geometry,
    stats: { selected, triangles: position.count / 3, selectedArea, totalArea },
  }
}

/** Scene-local silver finish calibration. Source geometry, normals and material stay intact. */
export function installPaintBevelStudy(scene: Object3D, mode: string | null) {
  const restores: (() => void)[] = []
  if (mode !== 'finish') return () => {}
  let disposed = false
  const release = () => {
    if (disposed) return
    disposed = true
    for (const restore of restores.reverse()) restore()
  }
  const materials = new Set<MeshStandardNodeMaterial>()
  try {
    scene.traverse((object) => {
      if (!(object instanceof Mesh) || Array.isArray(object.material)) return
      const material = object.material
      if (
        !(material instanceof MeshStandardNodeMaterial) ||
        (!materials.has(material) && (material.roughnessNode || material.colorNode)) ||
        material.userData.source_vpb_material_id !== 20159 ||
        !/^Reventon \/ (fixed|door_-?1|rear_cover_assembly) \/ 20159$/.test(material.name)
      )
        return
      let audited = false
      for (let node: Object3D | null = object; node; node = node.parent)
        if (node.userData.adapter === 'reventon-v1' && node.userData.carStudioQuality === 'studio')
          audited = true
      if (
        !audited ||
        object.geometry.drawRange.start !== 0 ||
        Number.isFinite(object.geometry.drawRange.count)
      )
        return
      const original = object.geometry
      const { geometry, stats } = bevelStudyGeometry(original)
      object.geometry = geometry
      geometry.userData.paintBevelStudy = stats
      restores.push(() => {
        if (object.geometry === geometry) object.geometry = original
        geometry.dispose()
      })
      if (materials.has(material)) return
      materials.add(material)
      const oldRoughness = material.roughnessNode,
        oldColor = material.colorNode
      // Only the existing bright-silver finish. Numeric inputs are live uniforms:
      // switching to orange/graphite restores their original response immediately.
      const silver = materialMetalness
        .sub(1)
        .abs()
        .lessThan(1e-5)
        .and(materialRoughness.sub(0.19).abs().lessThan(1e-5))
      const mask = attribute<'float'>('treesPaintBevel', 'float').mul(silver.select(1, 0))
      const filtered = mix(materialRoughness, materialRoughness.max(0.4), mask).toVar(
        'treesPaintBevelRoughness',
      )
      const diagnostic = materialColor.rgb.mul(mix(1, 0.35, mask))
      material.colorNode = diagnostic
      material.roughnessNode = filtered
      material.needsUpdate = true
      restores.push(() => {
        if (material.roughnessNode === filtered) material.roughnessNode = oldRoughness
        if (material.colorNode === diagnostic) material.colorNode = oldColor
        material.needsUpdate = true
      })
    })
  } catch (error) {
    release()
    throw error
  }
  return release
}

import { Material, type Texture } from 'three'
import { isCompressedTraceTexture, resolveCompressedTraceTexture } from './compressedTraceTextures'

const traceMapFields = [
  'map',
  'normalMap',
  'roughnessMap',
  'metalnessMap',
  'emissiveMap',
  'alphaMap',
] as const
type TraceMaterial = Material & Partial<Record<(typeof traceMapFields)[number], Texture | null>>

/** Local material views inherit live finish/highlight scalars and only redirect
 * Speedball's supported map accessors. They own no Three resources or listeners.
 */
export function createTraceMaterialViews() {
  const views = new Map<Material, Material>()
  function get(material: Material) {
    const existing = views.get(material)
    if (existing) return existing
    const source = material as TraceMaterial
    if (!traceMapFields.some((field) => isCompressedTraceTexture(source[field]))) return material
    const view = Object.create(material) as Material
    for (const field of traceMapFields)
      Object.defineProperty(view, field, {
        get: () => resolveCompressedTraceTexture(source[field]),
      })
    views.set(material, view)
    return view
  }
  return {
    binding(binding: Material | Material[]) {
      if (!Array.isArray(binding)) return get(binding)
      const mapped = binding.map(get)
      return mapped.some((material, index) => material !== binding[index]) ? mapped : binding
    },
    prune(live: ReadonlyMap<Material, unknown>) {
      for (const [source, view] of views) if (!live.has(view)) views.delete(source)
    },
    dispose: () => views.clear(),
  }
}

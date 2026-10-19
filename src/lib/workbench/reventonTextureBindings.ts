import { CompressedTexture, Material, Mesh, Texture, type Group } from 'three'

// Identity/diagnostic metadata does not change sampling. Everything else, including
// future renderer-facing properties, is compared conservatively below.
const metadata = new Set(['id', 'uuid', 'name', 'userData'])
const vectors = new Set(['offset', 'repeat', 'center', 'matrix'])

/** Only ordinary, static loader textures qualify; never alias targets or callbacks. */
function eligible(texture: Texture) {
  const record = texture as unknown as Record<string, unknown>
  return (
    (texture.constructor === Texture || texture.constructor === CompressedTexture) &&
    !texture.isRenderTargetTexture &&
    !texture.renderTarget &&
    !texture.onUpdate &&
    !record._listeners &&
    texture.updateRanges.length === 0
  )
}

function equivalent(a: Texture, b: Texture) {
  if (a.constructor !== b.constructor || a.source !== b.source || !eligible(b)) return false
  if (
    !a.offset.equals(b.offset) ||
    !a.repeat.equals(b.repeat) ||
    !a.center.equals(b.center) ||
    !a.matrix.equals(b.matrix) ||
    a.mipmaps.length !== b.mipmaps.length ||
    a.mipmaps.some((mipmap, index) => mipmap !== b.mipmaps[index])
  )
    return false
  const left = a as unknown as Record<string, unknown>,
    right = b as unknown as Record<string, unknown>
  for (const key of new Set([...Object.getOwnPropertyNames(a), ...Object.getOwnPropertyNames(b)])) {
    if (metadata.has(key) || vectors.has(key) || key === 'mipmaps' || key === 'updateRanges')
      continue
    if (!Object.is(left[key], right[key])) return false
  }
  return true
}

/**
 * r185 WebGPU allocates per Texture, while GLTFLoader clones every texCoord>0
 * assignment. Alias exact sampler/UV/colour/data matches before any GPU upload.
 * All original textures remain loader-owned; this binding neither disposes nor
 * creates textures, and restores source material references before loader cleanup.
 */
export function canonicalizeReventonTextures(model: Group) {
  const sources = new Map<Texture['source'], Texture[]>(),
    originals = new Set<Texture>(),
    canonical = new Set<Texture>(),
    materials = new Set<Material>(),
    changes: { material: Material; key: string; original: Texture; replacement: Texture }[] = []
  model.traverse((node) => {
    if (!(node instanceof Mesh)) return
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      if (materials.has(material)) continue
      materials.add(material)
      const record = material as unknown as Record<string, unknown>
      for (const [key, value] of Object.entries(material)) {
        if (!(value instanceof Texture)) continue
        originals.add(value)
        if (!eligible(value)) {
          canonical.add(value)
          continue
        }
        const candidates = sources.get(value.source) ?? [],
          match = candidates.find((candidate) => equivalent(value, candidate))
        if (match) {
          record[key] = match
          if (match !== value) changes.push({ material, key, original: value, replacement: match })
          canonical.add(match)
        } else {
          candidates.push(value)
          sources.set(value.source, candidates)
          canonical.add(value)
        }
      }
    }
  })
  let disposed = false
  return {
    before: originals.size,
    after: canonical.size,
    dispose() {
      if (disposed) return
      disposed = true
      for (const { material, key, original, replacement } of changes) {
        const record = material as unknown as Record<string, unknown>
        // Do not overwrite a later explicit material/texture edit.
        if (record[key] === replacement) record[key] = original
      }
      changes.length = 0
      sources.clear()
      originals.clear()
      canonical.clear()
      materials.clear()
    },
  }
}

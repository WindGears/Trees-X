import {
  DataTexture,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  RepeatWrapping,
  RGBAFormat,
  LinearFilter,
  LinearMipmapLinearFilter,
} from 'three'
import type { Group, Material } from 'three'

/** Owns surface textures/materials only. The loader retains geometry and source materials. */
export function createSpeakerMaterials(root: Group) {
  const size = 256
  const pixels = new Uint8Array(size * size * 4)
  let seed = 431
  for (let y = 0; y < size; y++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    const line = 224 + (seed % 14)
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      const value = line + ((x * 13 + y * 7) % 3)
      pixels[i] = pixels[i + 1] = pixels[i + 2] = value
      pixels[i + 3] = 255
    }
  }
  const grain = new DataTexture(pixels, size, size, RGBAFormat)
  grain.wrapS = grain.wrapT = RepeatWrapping
  grain.repeat.set(3, 12)
  grain.magFilter = LinearFilter
  grain.minFilter = LinearMipmapLinearFilter
  grain.generateMipmaps = true
  grain.needsUpdate = true
  const materials = new Map<MeshStandardMaterial, MeshPhysicalMaterial>()
  const originals: { mesh: Mesh; material: Material | Material[] }[] = []
  root.traverse((object) => {
    if (!(object instanceof Mesh) || !(object.material instanceof MeshStandardMaterial)) return
    const original = object.material
    let material = materials.get(original)
    if (!material) {
      material = new MeshPhysicalMaterial()
      MeshStandardMaterial.prototype.copy.call(material, original)
      if (original.name === 'Chassis_Aluminium') {
        material.roughnessMap = grain
        material.anisotropy = 0.65
        material.anisotropyRotation = Math.PI / 2
      }
      if (original.name === 'Anodized_Graphite') {
        material.metalness = 0.35
        material.roughness = 0.5
      }
      materials.set(original, material)
    }
    originals.push({ mesh: object, material: original })
    object.material = material
  })
  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    for (const entry of originals) entry.mesh.material = entry.material
    for (const material of materials.values()) material.dispose()
    grain.dispose()
  }
}

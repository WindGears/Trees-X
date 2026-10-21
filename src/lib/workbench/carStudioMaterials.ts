import { Mesh, MeshPhysicalMaterial, type Color, type Group } from 'three'

const velvet = new Set(['18501', '18581', '19691'])
const leather = new Set(['18661', '19771'])
const chrome = new Set(['16262', '18270', '18347'])

/** VPB material IDs/names were checked against the original material records.
 * Keep maps, UVs, colors, physical IOR and specular branches unchanged. Values
 * are a reversible studio look on loaded materials, not source asset edits. */
export function applyCarStudioMaterials(model: Group, finishMaterials: readonly string[]) {
  const finishes = new Set(finishMaterials),
    originals = new Map<
      MeshPhysicalMaterial,
      {
        roughness: number
        clearcoat: number
        clearcoatRoughness: number
        specularIntensity: number
        sheen: number
        sheenRoughness: number
        sheenColor: Color
      }
    >()
  let disposed = false
  model.traverse((object) => {
    if (!(object instanceof Mesh)) return
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (!(material instanceof MeshPhysicalMaterial) || originals.has(material)) continue
      const id = /^Reventon \/ [^/]+ \/ (\d+)$/.exec(material.name)?.[1]
      if (!id) continue
      const finish = finishes.has(material.name),
        glass = id === '15103' || id === '21865',
        paint = id === '20159',
        soft = velvet.has(id) || leather.has(id),
        metal = chrome.has(id) || id === '18029'
      if (!finish && !glass && !paint && !soft && !metal) continue
      // Transparent trim and other lamp optics retain their original handling.
      if (!glass && (material.transparent || material.transmission > 0)) continue
      originals.set(material, {
        roughness: material.roughness,
        clearcoat: material.clearcoat,
        clearcoatRoughness: material.clearcoatRoughness,
        specularIntensity: material.specularIntensity,
        sheen: material.sheen,
        sheenRoughness: material.sheenRoughness,
        sheenColor: material.sheenColor.clone(),
      })
      if (finish || paint) {
        // Satin graphite with a separate broad coat highlight, never a chrome
        // conversion. Specular/IOR stay native so SSR support is not removed.
        material.roughness = finish ? 0.34 : 0.24
        material.clearcoat = finish ? 0.42 : 0.65
        material.clearcoatRoughness = finish ? 0.18 : 0.13
      } else if (glass) material.specularIntensity = 0.38
      else if (velvet.has(id)) {
        material.roughness = Math.max(material.roughness, 0.94)
        material.clearcoat = 0
        material.sheen = 0.1
        material.sheenRoughness = 0.8
        material.sheenColor.setRGB(0.4, 0.4, 0.4)
      } else if (leather.has(id)) {
        material.roughness = Math.max(material.roughness, 0.62)
        material.clearcoat = 0
      } else if (chrome.has(id)) material.roughness = Math.min(material.roughness, 0.21)
      else if (id === '18029') material.roughness = Math.min(material.roughness, 0.35)
      material.needsUpdate = true
    }
  })
  return {
    dispose() {
      if (disposed) return
      disposed = true
      for (const [material, original] of originals) {
        const { sheenColor, ...scalars } = original
        Object.assign(material, scalars)
        material.sheenColor.copy(sheenColor)
        material.needsUpdate = true
      }
      originals.clear()
    },
  }
}

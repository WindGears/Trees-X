import { LinearSRGBColorSpace, Mesh, MeshStandardMaterial, type Group } from 'three'

const overlayIds = new Set(['18110', '18821', '18981', '19061', '19141'])

/** Calibrate this recovered car's trim and alpha overlays; loader owns every source map. */
export function prepareReventonSurfaces(model: Group) {
  const visited = new Set<MeshStandardMaterial>()
  model.traverse((node) => {
    if (!(node instanceof Mesh)) return
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      if (!(material instanceof MeshStandardMaterial) || visited.has(material)) continue
      visited.add(material)
      const id = /^Reventon \/ [^/]+ \/ (\d+)$/.exec(material.name)?.[1]
      if (id === '18581') {
        const hadMap = material.map !== null
        // The recovered colour bake has large stains. Keep the authored weave,
        // roughness and stable occlusion, with a neutral linear charcoal tint.
        material.map = null
        material.color.setRGB(0.025, 0.026, 0.028, LinearSRGBColorSpace)
        if (hadMap) material.needsUpdate = true
      }
      if (!id || !overlayIds.has(id) || !material.transparent) continue
      const changed =
        !material.forceSinglePass ||
        material.depthWrite ||
        !material.polygonOffset ||
        material.polygonOffsetFactor !== -1 ||
        material.polygonOffsetUnits !== -1 ||
        material.alphaTest !== 0.02
      // These source BLEND meshes are thin grille/lettering layers above trim.
      // Avoid a second transparent pass and opaque depth from nearly clear texels.
      material.forceSinglePass = true
      material.depthWrite = false
      material.polygonOffset = true
      material.polygonOffsetFactor = -1
      material.polygonOffsetUnits = -1
      material.alphaTest = 0.02
      if (changed) material.needsUpdate = true
    }
  })
}

import { Color, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, Texture } from 'three'
import type { Group, Scene, WebGLRenderer } from 'three'
import { prepareReventonMaterials } from '../reventon/materials'
import { bindGlb } from './glbAdapter'
import { createReventonStage } from './reventonStage'
import { prepareReventonSurfaces } from './reventonSurfaceRepair'
import type { SceneAdapter } from './adapter'
import type { GlbSource, WorkbenchProduct } from './types'

/** Reuse authored PBR surfaces; the shared v3 controller owns both motion channels. */
export function bindReventon(
  product: WorkbenchProduct,
  source: GlbSource,
  model: Group,
  release: () => void,
): SceneAdapter {
  const adapter = bindGlb(product, source, model, release)
  prepareReventonMaterials(model)
  prepareReventonSurfaces(model)
  const finishes = new Map<MeshStandardMaterial, Color>()
  const emissive = new Map<MeshStandardMaterial, { color: Color; intensity: number }>()
  const textures = new Set<Texture>()
  let sourceObjects = 0
  model.traverse((object) => {
    if (!(object instanceof Mesh)) return
    const count: unknown = object.userData.source_object_count
    if (typeof count === 'number') sourceObjects += count
    const materials = Array.isArray(object.material) ? object.material : [object.material]
    object.castShadow = !materials.some(
      (m) => m.transparent || (m instanceof MeshPhysicalMaterial && m.transmission > 0),
    )
    for (const material of materials) {
      for (const value of Object.values(material)) if (value instanceof Texture) textures.add(value)
      if (!(material instanceof MeshStandardMaterial)) continue
      if (source.finishMaterials.includes(material.name))
        finishes.set(material, material.color.clone())
      emissive.set(material, {
        color: material.emissive.clone(),
        intensity: material.emissiveIntensity,
      })
    }
  })
  adapter.root.userData.adapter = 'reventon-v1'
  adapter.root.userData.sourceObjects = sourceObjects
  let studio: ReturnType<typeof createReventonStage> | undefined
  let disposed = false
  const clearSelection = () => {
    for (const [material, original] of emissive) {
      material.emissive.copy(original.color)
      material.emissiveIntensity = original.intensity
    }
  }
  return {
    ...adapter,
    attach(scene: Scene, renderer: WebGLRenderer) {
      if (disposed || studio) return
      studio = createReventonStage(renderer, scene, adapter.root)
      for (const texture of textures) {
        texture.anisotropy = renderer.capabilities.getMaxAnisotropy()
        texture.needsUpdate = true
      }
    },
    beforeRender: () => studio?.render(),
    apply() {
      adapter.apply()
      studio?.markDirty()
    },
    setFinish(color) {
      const original = color.toLowerCase() === product.presentation.finishes[0]?.color.toLowerCase()
      for (const [material, base] of finishes) {
        if (original) material.color.copy(base)
        else material.color.set(color)
      }
    },
    select(node) {
      clearSelection()
      if (!node) return
      adapter.nodes.get(node)?.traverse((object) => {
        if (!(object instanceof Mesh)) return
        for (const material of Array.isArray(object.material)
          ? object.material
          : [object.material]) {
          if (!(material instanceof MeshStandardMaterial)) continue
          material.emissive.set('#537382')
          material.emissiveIntensity = 0.13
        }
      })
    },
    dispose() {
      if (disposed) return
      disposed = true
      studio?.dispose()
      studio = undefined
      clearSelection()
      textures.clear()
      finishes.clear()
      emissive.clear()
      adapter.dispose()
    },
  }
}

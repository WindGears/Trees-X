import { Color, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, Texture } from 'three'
import type { Camera, Group, Scene } from 'three'
import { prepareReventonMaterials } from '../reventon/materials'
import { bindGlb } from './glbAdapter'
import { createReventonStage } from './reventonStage'
import { prepareReventonSurfaces } from './reventonSurfaceRepair'
import { canonicalizeReventonTextures } from './reventonTextureBindings'
import type { SceneAdapter } from './adapter'
import type { GlbSource, WorkbenchProduct } from './types'
import { isWebGpuRenderer, type WorkbenchRenderer } from './rendering/rendererTypes'
import type { WebGPURenderer } from 'three/webgpu'
import type { ReventonStage } from './reventonStage'
import type { ReventonStageOptions } from './reventonStage'
import { resolveCarStudioQuality } from './carStudioQuality'
import { applyCarStudioMaterials } from './carStudioMaterials'
import { resolveReventonFinishBindings } from './reventonFinishBindings'

export interface ReventonGpuDependencies {
  createStage(
    renderer: WebGPURenderer,
    scene: Scene,
    model: Group,
    options?: ReventonStageOptions,
  ): ReventonStage
  prepareMaterials(model: Group): { sync(): void; dispose(): void }
}

/** Reuse authored PBR surfaces; the shared v3 controller owns both motion channels. */
export function bindReventon(
  product: WorkbenchProduct,
  source: GlbSource,
  model: Group,
  release: () => void,
  gpu?: ReventonGpuDependencies,
): SceneAdapter {
  const finishMaterials = resolveReventonFinishBindings(source, model)
  const adapter = bindGlb(
    product,
    { ...source, finishMaterials: [...finishMaterials] },
    model,
    release,
  )
  prepareReventonMaterials(model)
  prepareReventonSurfaces(model)
  const finishes = new Map<MeshStandardMaterial, Color>()
  const emissive = new Map<MeshStandardMaterial, { color: Color; intensity: number }>()
  const textures = new Set<Texture>()
  const meshMaterials = new Map<Mesh, MeshStandardMaterial[]>()
  let sourceObjects = 0
  model.traverse((object) => {
    if (!(object instanceof Mesh)) return
    const count: unknown = object.userData.source_object_count
    if (typeof count === 'number') sourceObjects += count
    const materials = Array.isArray(object.material) ? object.material : [object.material]
    meshMaterials.set(
      object,
      materials.filter((m): m is MeshStandardMaterial => m instanceof MeshStandardMaterial),
    )
    object.castShadow = !materials.some(
      (m) => m.transparent || (m instanceof MeshPhysicalMaterial && m.transmission > 0),
    )
    for (const material of materials) {
      for (const value of Object.values(material)) if (value instanceof Texture) textures.add(value)
      if (!(material instanceof MeshStandardMaterial)) continue
      if (finishMaterials.includes(material.name)) finishes.set(material, material.color.clone())
      emissive.set(material, {
        color: material.emissive.clone(),
        intensity: material.emissiveIntensity,
      })
    }
  })
  adapter.root.userData.adapter = 'reventon-v1'
  adapter.root.userData.sourceObjects = sourceObjects
  adapter.root.userData.finishBinding = {
    corrected: finishMaterials !== source.finishMaterials,
    materials: [...finishMaterials],
  }
  let studio: ReturnType<typeof createReventonStage> | undefined
  let gpuMaterials: ReturnType<ReventonGpuDependencies['prepareMaterials']> | undefined
  let gpuTextures: ReturnType<typeof canonicalizeReventonTextures> | undefined
  let studioMaterials: ReturnType<typeof applyCarStudioMaterials> | undefined
  let disposed = false
  const clearSelection = () => {
    for (const [material, original] of emissive) {
      material.emissive.copy(original.color)
      material.emissiveIntensity = original.intensity
    }
  }
  return {
    ...adapter,
    attach(scene: Scene, renderer: WorkbenchRenderer, camera?: Camera) {
      if (disposed || studio) return
      if (isWebGpuRenderer(renderer)) {
        if (!gpu) throw new Error('汽车 WebGPU 舞台依赖未装配')
        try {
          const quality = resolveCarStudioQuality(
            source,
            typeof location === 'undefined' ? '' : location.search,
          )
          if (quality) {
            studioMaterials = applyCarStudioMaterials(model, finishMaterials)
            adapter.root.userData.carStudioQuality = quality
          }
          gpuTextures = canonicalizeReventonTextures(model)
          gpuMaterials = gpu.prepareMaterials(model)
          const showroom =
            quality &&
            camera &&
            new URLSearchParams(location.search).get('carShowroom') === 'cold-studio'
          studio = showroom
            ? gpu.createStage(renderer, scene, adapter.root, { quality, camera, source })
            : quality
              ? gpu.createStage(renderer, scene, adapter.root, { quality })
              : gpu.createStage(renderer, scene, adapter.root)
        } catch (error) {
          gpuMaterials?.dispose()
          gpuMaterials = undefined
          gpuTextures?.dispose()
          gpuTextures = undefined
          studioMaterials?.dispose()
          studioMaterials = undefined
          delete adapter.root.userData.carStudioQuality
          throw error
        }
      } else studio = createReventonStage(renderer, scene, adapter.root)
      for (const texture of textures) {
        texture.anisotropy = isWebGpuRenderer(renderer)
          ? renderer.getMaxAnisotropy()
          : renderer.capabilities.getMaxAnisotropy()
        texture.needsUpdate = true
      }
    },
    async prepare(signal?: AbortSignal) {
      signal?.throwIfAborted()
      if (disposed) throw new Error('Car adapter has been disposed')
      gpuMaterials?.sync()
      await studio?.prepare(signal)
      signal?.throwIfAborted()
    },
    beforeRender() {
      gpuMaterials?.sync()
      studio?.render()
    },
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
        // Source identities survive the realtime coordinator's material bindings too.
        for (const material of meshMaterials.get(object) ?? []) {
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
      gpuMaterials?.dispose()
      gpuMaterials = undefined
      gpuTextures?.dispose()
      gpuTextures = undefined
      studioMaterials?.dispose()
      studioMaterials = undefined
      delete adapter.root.userData.carStudioQuality
      textures.clear()
      finishes.clear()
      emissive.clear()
      meshMaterials.clear()
      adapter.dispose()
    },
  }
}

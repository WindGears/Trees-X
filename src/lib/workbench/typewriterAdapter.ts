import { MeshStandardMaterial, Vector3, type Group, type Scene } from 'three'
import type { SceneAdapter } from './adapter'
import { bindGlb } from './glbAdapter'
import { bindTypewriterRig, parseTypewriterRig } from './typewriterRig'
import { instanceTypewriter } from './typewriterInstances'
import { applyTypewriterFinishes } from './typewriterFinishes'
import type { GlbSource, WorkbenchProduct } from './types'
import { createTypewriterStudio } from './studio/stage'
import { isWebGpuRenderer, type WorkbenchRenderer } from './rendering/rendererTypes'
import type { WorkbenchStudio, WorkbenchStudioFactory } from './rendering/studio'
import type { StudioMoodUpdate } from './studio/mood'
import { isAuditedTypewriterSource } from './typewriterCandidate'
import { representativeTypebar, typebarInspectionOffset } from './typewriterInspection'

export function bindTypewriter(
  product: WorkbenchProduct,
  source: GlbSource,
  model: Group,
  data: unknown,
  release: () => void,
  studioFactory?: WorkbenchStudioFactory,
  exhibition = false,
): SceneAdapter {
  const parts = parseTypewriterRig(data)
  const adapter = bindGlb(product, source, model, release)
  const applyRig = bindTypewriterRig(parts, adapter.nodes, product.presentation)
  const materials = new Set<MeshStandardMaterial>()
  model.traverse((node) => {
    if ('material' in node) {
      const values: unknown[] = Array.isArray(node.material) ? node.material : [node.material]
      for (const material of values)
        if (material instanceof MeshStandardMaterial) materials.add(material)
    }
  })
  applyTypewriterFinishes(materials, source.transform.scale)
  const instances = instanceTypewriter(
    model.getObjectByName('typewriter-product') ?? model,
    parts,
    adapter.nodes,
  )
  adapter.root.userData.parts = parts.length
  adapter.root.userData.adapter = source.adapter
  const inspectionLayout =
    exhibition && product.slug === 'typewriter-study' && isAuditedTypewriterSource(source)
      ? product.presentation.actions.find(
          (action) => action.motion?.program?.type === 'typewriter-layout-v1',
        )?.id
      : undefined
  const modelOrigin = new Vector3()
  let studio: WorkbenchStudio | undefined
  const apply = () => {
    adapter.apply()
    applyRig(adapter.pose)
    instances.update()
    studio?.markDirty()
  }
  apply()
  let disposed = false
  return {
    ...adapter,
    apply,
    select: instances.select,
    nodeForHit: instances.nodeForHit,
    focusPosition(node, target, result) {
      if (!inspectionLayout || node !== representativeTypebar) return false
      const offset = typebarInspectionOffset(adapter.pose[inspectionLayout] ?? 0)
      if (!offset) return false
      modelOrigin.setFromMatrixPosition(adapter.root.matrixWorld)
      result.fromArray(offset).multiplyScalar(1 / 0.16)
      adapter.root.localToWorld(result).sub(modelOrigin).add(target)
      return true
    },
    attach(scene: Scene, renderer: WorkbenchRenderer) {
      if (disposed || studio) return
      if (studioFactory)
        studio = studioFactory(renderer, scene, adapter.root, product.presentation.stage?.groundY)
      else if (!isWebGpuRenderer(renderer))
        studio = createTypewriterStudio(
          renderer,
          scene,
          adapter.root,
          product.presentation.stage?.groundY,
        )
      else throw new Error('WebGPU 打字机舞台尚未准备完成')
    },
    beforeRender: () => studio?.render(),
    setStudioMood: (update: StudioMoodUpdate) => studio?.setMood?.(update),
    dispose() {
      if (disposed) return
      disposed = true
      studio?.dispose()
      studio = undefined
      instances.dispose()
      adapter.dispose()
    },
  }
}

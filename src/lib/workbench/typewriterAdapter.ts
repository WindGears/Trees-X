import { MeshStandardMaterial, type Group, type Scene } from 'three'
import { bindGlb } from './glbAdapter'
import { bindTypewriterRig, parseTypewriterRig } from './typewriterRig'
import { instanceTypewriter } from './typewriterInstances'
import { applyTypewriterFinishes } from './typewriterFinishes'
import type { GlbSource, WorkbenchProduct } from './types'
import { createTypewriterStudio } from './studio/stage'
import { isWebGpuRenderer, type WorkbenchRenderer } from './rendering/rendererTypes'
import type { WorkbenchStudioFactory } from './rendering/studio'

export function bindTypewriter(
  product: WorkbenchProduct,
  source: GlbSource,
  model: Group,
  data: unknown,
  release: () => void,
  studioFactory?: WorkbenchStudioFactory,
) {
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
  let studio: ReturnType<typeof createTypewriterStudio> | undefined
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

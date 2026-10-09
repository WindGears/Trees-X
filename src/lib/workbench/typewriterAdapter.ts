import { MeshStandardMaterial, type Group } from 'three'
import { bindGlb } from './glbAdapter'
import { bindTypewriterRig, parseTypewriterRig } from './typewriterRig'
import { instanceTypewriter } from './typewriterInstances'
import { applyTypewriterFinishes } from './typewriterFinishes'
import type { GlbSource, WorkbenchProduct } from './types'

export function bindTypewriter(
  product: WorkbenchProduct,
  source: GlbSource,
  model: Group,
  data: unknown,
  release: () => void,
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
  const apply = () => {
    adapter.apply()
    applyRig(adapter.pose)
    instances.update()
  }
  apply()
  let disposed = false
  return {
    ...adapter,
    apply,
    select: instances.select,
    nodeForHit: instances.nodeForHit,
    dispose() {
      if (disposed) return
      disposed = true
      instances.dispose()
      adapter.dispose()
    },
  }
}

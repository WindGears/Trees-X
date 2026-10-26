import { Mesh, MeshStandardMaterial, type Group } from 'three'
import { isAuditedReventonSource } from './reventonCandidate'
import type { GlbSource } from './types'

const legacyGroups = [
  'fixed',
  'door_1',
  'door_-1',
  'rear_cover_assembly',
  'wheel_1_1',
  'wheel_1_-1',
  'wheel_-1_1',
  'wheel_-1_-1',
]
const legacy = legacyGroups.map((group) => `Reventon / ${group} / 15023`)
export const reventonPaintBindings = Object.freeze(
  legacyGroups.slice(0, 4).map((group) => `Reventon / ${group} / 20159`),
)

/** Compatibility repair for the original generated configuration only. VPB 15023
 * is matte black plastic; 20159 is paint. Never rewrite administrator bindings,
 * source materials, the configuration object or a custom asset package. */
export function resolveReventonFinishBindings(source: GlbSource, model: Group): readonly string[] {
  if (
    !isAuditedReventonSource(source) ||
    source.finishMaterials.length !== legacy.length ||
    new Set(source.finishMaterials).size !== legacy.length ||
    !source.finishMaterials.every((name) => legacy.includes(name))
  )
    return source.finishMaterials
  const verified = new Set<string>()
  model.traverse((object) => {
    if (!(object instanceof Mesh)) return
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (
        material instanceof MeshStandardMaterial &&
        reventonPaintBindings.includes(material.name) &&
        material.userData.source_vpb_material_id === 20159
      )
        verified.add(material.name)
    }
  })
  return verified.size === reventonPaintBindings.length
    ? reventonPaintBindings
    : source.finishMaterials
}

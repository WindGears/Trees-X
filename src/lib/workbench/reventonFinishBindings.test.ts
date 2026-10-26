import { BoxGeometry, Group, Mesh, MeshPhysicalMaterial } from 'three'
import { describe, expect, it } from 'vitest'
import { reventonOriginalBundle, reventonRuntimeBundle } from './reventonCandidate'
import { reventonPaintBindings, resolveReventonFinishBindings } from './reventonFinishBindings'
import type { GlbSource } from './types'

function fixture() {
  const model = new Group(),
    geometry = new BoxGeometry()
  const materials = reventonPaintBindings.map((name) => {
    const material = new MeshPhysicalMaterial()
    material.name = name
    material.userData.source_vpb_material_id = 20159
    model.add(new Mesh(geometry, material))
    return material
  })
  const source: GlbSource = {
    kind: 'glb',
    adapter: 'reventon-v1',
    bundle: { ...reventonOriginalBundle },
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 },
    explode: [],
    finishMaterials: [
      'fixed',
      'door_1',
      'door_-1',
      'rear_cover_assembly',
      'wheel_1_1',
      'wheel_1_-1',
      'wheel_-1_1',
      'wheel_-1_-1',
    ].map((group) => `Reventon / ${group} / 15023`),
  }
  return {
    model,
    materials,
    source,
    dispose: () => {
      geometry.dispose()
      materials.forEach((m) => m.dispose())
    },
  }
}

describe('verified Reventon paint semantics', () => {
  it('repairs the exact legacy plastic list for both audited packages without changing config or materials', () => {
    const f = fixture(),
      original = structuredClone(f.source)
    try {
      expect(resolveReventonFinishBindings(f.source, f.model)).toEqual(reventonPaintBindings)
      expect(f.source).toEqual(original)
      expect(f.materials.every((m) => m.clearcoat === 0)).toBe(true)
      if (reventonRuntimeBundle) {
        f.source.bundle = { ...reventonRuntimeBundle }
        expect(resolveReventonFinishBindings(f.source, f.model)).toEqual(reventonPaintBindings)
      }
    } finally {
      f.dispose()
    }
  })
  it.each(['custom-package', 'custom-binding', 'missing-paint', 'wrong-provenance', 'duplicate'])(
    'preserves %s instead of guessing',
    (mode) => {
      const f = fixture()
      try {
        if (mode === 'custom-package') f.source.bundle.sha256 = 'f'.repeat(64)
        if (mode === 'custom-binding') f.source.finishMaterials = [f.source.finishMaterials[0]!]
        if (mode === 'missing-paint') f.model.children[0]!.removeFromParent()
        if (mode === 'wrong-provenance') f.materials[0]!.userData.source_vpb_material_id = 15023
        if (mode === 'duplicate') f.source.finishMaterials[0] = f.source.finishMaterials[1]!
        expect(resolveReventonFinishBindings(f.source, f.model)).toBe(f.source.finishMaterials)
      } finally {
        f.dispose()
      }
    },
  )
})

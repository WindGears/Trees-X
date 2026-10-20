import { describe, expect, it } from 'vitest'
import {
  isAuditedReventonSource,
  reventonCandidate,
  reventonOriginalBundle,
} from './reventonCandidate'
import type { BundleReference, GlbSource } from './types'

const original: GlbSource = {
  kind: 'glb',
  adapter: 'reventon-v1',
  bundle: { ...reventonOriginalBundle },
  transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 },
  finishMaterials: [],
  explode: [],
}
const candidate: BundleReference = {
  id: 'reventon-workbench',
  version: 2,
  manifest: '/models/reventon-runtime-v2/workbench-manifest.json',
  sha256: 'a'.repeat(64),
}
describe('immutable 4K Reventon candidate', () => {
  it('only changes the explicit source bundle and preserves all rig configuration', () => {
    const before = structuredClone(original)
    const selected = reventonCandidate(original, '?reventonAsset=runtime-v2', candidate)
    expect(selected.bundle).toEqual(candidate)
    expect(selected.bundle).not.toBe(candidate)
    expect(selected.transform).toBe(original.transform)
    expect(original).toEqual(before)
    expect(isAuditedReventonSource(selected, candidate)).toBe(true)
    expect(isAuditedReventonSource(original, candidate)).toBe(true)
  })
  it('preserves ordinary, invalid and administrator-selected resources', () => {
    expect(reventonCandidate(original, '', candidate)).toBe(original)
    expect(reventonCandidate(original, '?reventonAsset=other', candidate)).toBe(original)
    for (const patch of [
      { id: 'custom' },
      { version: 9 },
      { manifest: '/custom.json' },
      { sha256: 'b'.repeat(64) },
    ]) {
      const source = { ...original, bundle: { ...original.bundle, ...patch } }
      expect(reventonCandidate(source, '?reventonAsset=runtime-v2', candidate)).toBe(source)
      expect(isAuditedReventonSource(source, candidate)).toBe(false)
    }
    const unrelated: GlbSource = { ...original, adapter: 'typewriter-v1' }
    expect(reventonCandidate(unrelated, '?reventonAsset=runtime-v2', candidate)).toBe(unrelated)
    expect(isAuditedReventonSource(unrelated, candidate)).toBe(false)
  })
  it('fails clearly instead of pretending an unprepared or unregistered package loaded', () => {
    expect(() => reventonCandidate(original, '?reventonAsset=runtime-v2', null)).toThrow('尚未准备')
    expect(() =>
      reventonCandidate(original, '?reventonAsset=runtime-v2', { ...candidate, version: 3 }),
    ).toThrow('登记不完整')
  })
})

import { describe, expect, it } from 'vitest'
import { typewriterCandidate } from './typewriterCandidate'
import type { GlbSource } from './types'
import bundle from './typewriterV2Bundle.json'

const original: GlbSource = {
  kind: 'glb',
  adapter: 'typewriter-v1',
  bundle: {
    id: 'kimi-typewriter',
    version: 1,
    manifest: '/models/bundles/kimi-typewriter/v1/manifest.json',
    sha256: 'c216ad6101fabe469f7effa061a237fd3f1ad440550cafb10ff5c5f345a770bd',
  },
  transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: 0.16 },
  finishMaterials: ['enamel'],
  explode: [],
}

describe('explicit typewriter material candidate', () => {
  it('keeps the default source and unrelated products unmodified', () => {
    expect(typewriterCandidate(original, '')).toBe(original)
    expect(typewriterCandidate(original, '?typewriterAsset=invalid')).toBe(original)
    expect(
      typewriterCandidate({ ...original, adapter: 'piano-v1' }, '?typewriterAsset=v2').bundle,
    ).toBe(original.bundle)
  })
  it('uses an isolated candidate reference while preserving axes, rig adapter and source snapshot', () => {
    const before = structuredClone(original)
    const candidate = typewriterCandidate(original, '?typewriterAsset=v2&renderPipeline=realtime')
    expect(candidate.bundle).toEqual(bundle)
    expect(candidate.bundle).not.toBe(bundle)
    expect(candidate.transform).toBe(original.transform)
    expect(candidate.adapter).toBe('typewriter-v1')
    expect(original).toEqual(before)
  })
  it('does not silently replace an administrator custom bundle', () => {
    for (const patch of [{ id: 'another' }, { version: 2 }, { sha256: 'a'.repeat(64) }]) {
      const source = { ...original, bundle: { ...original.bundle, ...patch } }
      expect(typewriterCandidate(source, '?typewriterAsset=v2')).toBe(source)
    }
  })
})

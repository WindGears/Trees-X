import { Group, Scene } from 'three'
import { describe, expect, it } from 'vitest'
import { isCarStudioScene, resolveCarStudioQuality } from './carStudioQuality'
import { reventonOriginalBundle, reventonRuntimeBundle } from './reventonCandidate'
import type { GlbSource } from './types'

const source: GlbSource = {
  kind: 'glb',
  adapter: 'reventon-v1',
  bundle: { ...reventonOriginalBundle },
  transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 },
  finishMaterials: [],
  explode: [],
}

describe('car-only studio capability', () => {
  it('requires the explicit option and the exact audited source reference', () => {
    expect(resolveCarStudioQuality(source, '?carQuality=studio')).toBe('studio')
    expect(resolveCarStudioQuality(source, '')).toBeUndefined()
    expect(resolveCarStudioQuality(source, '?carQuality=cinematic')).toBeUndefined()
    for (const key of ['id', 'version', 'manifest', 'sha256'] as const) {
      const bundle = { ...source.bundle, [key]: key === 'version' ? 99 : 'custom' }
      expect(resolveCarStudioQuality({ ...source, bundle }, '?carQuality=studio')).toBeUndefined()
    }
    expect(
      resolveCarStudioQuality({ ...source, adapter: 'pbr-v1' }, '?carQuality=studio'),
    ).toBeUndefined()
    if (reventonRuntimeBundle)
      expect(
        resolveCarStudioQuality({ ...source, bundle: reventonRuntimeBundle }, '?carQuality=studio'),
      ).toBe('studio')
  })

  it('publishes the marker only on a registered car adapter root', () => {
    const scene = new Scene(),
      root = new Group()
    scene.add(root)
    root.userData.carStudioQuality = 'studio'
    expect(isCarStudioScene(scene)).toBe(false)
    root.userData.adapter = 'typewriter-v1'
    expect(isCarStudioScene(scene)).toBe(false)
    root.userData.adapter = 'reventon-v1'
    expect(isCarStudioScene(scene)).toBe(true)
    delete root.userData.carStudioQuality
    expect(isCarStudioScene(scene)).toBe(false)
  })
})

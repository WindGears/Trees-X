import { Group, Scene } from 'three'
import { describe, expect, it } from 'vitest'
import {
  isCarStudioScene,
  resolveCarStudioQuality,
  resolveCarStudioPaint,
  resolveCarStudioTrim,
} from './carStudioQuality'
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
  it('requires an audited showroom for the satin trim candidate', () => {
    const search = '?carQuality=studio&carShowroom=cold-studio&carStudioTrim=satin'
    expect(resolveCarStudioTrim(source, search)).toBe('satin')
    expect(resolveCarStudioTrim(source, '?carStudioTrim=satin')).toBe('source')
    expect(resolveCarStudioTrim(source, search.replace('satin', 'custom'))).toBe('source')
    expect(
      resolveCarStudioTrim(
        { ...source, bundle: { ...source.bundle, sha256: 'f'.repeat(64) } },
        search,
      ),
    ).toBe('source')
  })
  it('keeps calibrated graphite behind audited showroom and explicit paint selection', () => {
    const search = '?carQuality=studio&carShowroom=cold-studio&carStudioPaint=graphite'
    expect(resolveCarStudioPaint(source, search)).toBe('graphite')
    expect(resolveCarStudioPaint(source, '?carStudioPaint=graphite')).toBe('source')
    expect(resolveCarStudioPaint(source, '?carQuality=studio&carStudioPaint=graphite')).toBe(
      'source',
    )
    expect(resolveCarStudioPaint(source, search.replace('graphite', 'custom'))).toBe('source')
    expect(
      resolveCarStudioPaint(
        { ...source, bundle: { ...source.bundle, sha256: 'f'.repeat(64) } },
        search,
      ),
    ).toBe('source')
  })
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

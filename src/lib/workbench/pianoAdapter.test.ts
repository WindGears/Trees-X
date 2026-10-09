import {
  AnimationClip,
  AnimationMixer,
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  NumberKeyframeTrack,
  Quaternion,
  QuaternionKeyframeTrack,
  Vector3,
  VectorKeyframeTrack,
} from 'three'
import { describe, expect, it, vi } from 'vitest'
import { bindPiano } from './pianoAdapter'
import { defaultStage } from './presentationV2'
import type { PianoRig } from './pianoRig'
import type { GlbSource, WorkbenchProduct } from './types'

function fixture() {
  const source: GlbSource = {
    kind: 'glb',
    adapter: 'piano-v1',
    bundle: {
      id: 'piano-test',
      version: 1,
      manifest: '/models/bundles/piano-test/v1/manifest.json',
      sha256: '0'.repeat(64),
    },
    transform: { position: [5, 1, -2], rotation: [0, 0, 0], scale: 2 },
    finishMaterials: ['paint'],
    explode: [],
  }
  const product: WorkbenchProduct = {
    slug: 'piano-test',
    name: 'Piano test fixture',
    category: 'Test',
    description: 'Small real Three animation fixture, not the recovered model.',
    presentation: {
      version: 3,
      source,
      stage: structuredClone(defaultStage),
      camera: { position: [3, 2, 5], target: [0, 1, 0], minDistance: 1, maxDistance: 12 },
      views: [{ id: 'perspective', label: 'Overview', position: [3, 2, 5], target: [0, 1, 0] }],
      hotspots: [
        {
          id: 'key',
          node: 'piano-part-key',
          name: 'Key',
          description: 'Semantic key',
          cameraOffset: [1, 1, 1],
        },
      ],
      finishes: [{ id: 'original', name: 'Original', color: '#202020' }],
      actions: [
        {
          id: 'sound-path',
          node: 'piano-product',
          label: 'Explore',
          kind: 'progress',
          motion: {
            duration: 7,
            openLabel: 'Explore',
            closeLabel: 'Restore',
            program: { type: 'piano-sound-path-v1', file: 'rig.json' },
          },
        },
      ],
      structure: true,
      structureActionId: 'sound-path',
      guide: [],
    },
  }
  const model = new Group(),
    semantic = new Group(),
    section = new Group(),
    flat = new Group(),
    geometry = new BoxGeometry(2, 2, 2),
    paint = new MeshStandardMaterial({
      color: '#202020',
      emissive: '#123456',
      emissiveIntensity: 0.1,
    }),
    flatPaint = paint.clone()
  model.name = 'piano-product'
  semantic.name = 'piano-part-key'
  semantic.position.set(4, 3, 2)
  section.name = 'section-key'
  flat.name = 'flat-key'
  section.userData.pianoPart = semantic.name
  flat.userData.pianoPart = semantic.name
  paint.name = 'paint'
  flatPaint.name = 'flat-paint'
  paint.userData.sourceEnvMapIntensity = 1.25
  flatPaint.userData.sourceEnvMapIntensity = 0.7
  const target = geometry.getAttribute('position').clone()
  for (let i = 0; i < target.count; i++) target.setX(i, target.getX(i) * 2)
  geometry.morphAttributes.position = [target]
  geometry.morphTargetsRelative = false
  const deform = new Mesh(geometry, paint),
    shared = new Mesh(geometry, paint),
    flatMesh = new Mesh(geometry, flatPaint)
  deform.name = 'deform-key'
  shared.name = 'shared-section-key'
  flatMesh.name = 'flat-key-mesh'
  section.add(deform, shared)
  flat.add(flatMesh)
  model.add(semantic, section, flat)
  const rotation = (angle: number) =>
    new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), angle).toArray()
  const clip = new AnimationClip('piano-sound-path', 7, [
    new VectorKeyframeTrack('section-key.position', [0, 3.5, 7], [0, 0, 0, 2, 4, 0, 4, 0, 0]),
    new QuaternionKeyframeTrack(
      'section-key.quaternion',
      [0, 3.5, 7],
      [...rotation(0), ...rotation(Math.PI / 2), ...rotation(Math.PI)],
    ),
    new VectorKeyframeTrack('section-key.scale', [0, 3.5, 7], [1, 1, 1, 1.5, 1, 1, 1, 1, 1]),
    new VectorKeyframeTrack('flat-key.position', [0, 3.5, 7], [10, 0, 0, 12, 0, 0, 14, 0, 0]),
    new NumberKeyframeTrack('deform-key.morphTargetInfluences', [0, 3.5, 7], [0, 0.5, 1]),
  ])
  const rig: PianoRig = {
    version: 1,
    type: 'piano-sound-path-v1',
    clip: 'piano-sound-path',
    duration: 7,
    sampleStep: 0.01,
    parts: [
      {
        id: 'key',
        node: semantic.name,
        name: 'Key',
        layer: 'keyboard',
        section: [section.name],
        flat: [flat.name],
        restPoint: [4, 3, 2],
      },
    ],
    curves: [
      Array.from({ length: 701 }, (_, i) => 1 - i / 700),
      Array.from({ length: 701 }, (_, i) => i / 700),
    ],
    surfaces: [
      { node: section.name, curves: [0], line: false, castShadow: true },
      { node: flat.name, curves: [1], line: false, castShadow: true },
    ],
  }
  const geometryDisposed = vi.fn(),
    paintDisposed = vi.fn(),
    flatPaintDisposed = vi.fn()
  geometry.addEventListener('dispose', geometryDisposed)
  paint.addEventListener('dispose', paintDisposed)
  flatPaint.addEventListener('dispose', flatPaintDisposed)
  const release = vi.fn(() => {
    geometry.dispose()
    paint.dispose()
    flatPaint.dispose()
  })
  const bind = (animations = [clip], data: unknown = rig) =>
    bindPiano(product, source, model, animations, data, release)
  return {
    bind,
    clip,
    rig,
    source,
    product,
    model,
    semantic,
    section,
    flat,
    deform,
    shared,
    flatMesh,
    paint,
    flatPaint,
    geometry,
    release,
    geometryDisposed,
    paintDisposed,
    flatPaintDisposed,
  }
}

function snapshot(f: ReturnType<typeof fixture>) {
  return {
    section: [
      f.section.position.toArray(),
      f.section.quaternion.toArray(),
      f.section.scale.toArray(),
    ],
    flat: f.flat.position.toArray(),
    morph: [...f.deform.morphTargetInfluences!],
    visibility: [f.section.visible, f.flat.visible],
    opacity: [f.paint.opacity, f.flatPaint.opacity],
    transparent: [f.paint.transparent, f.flatPaint.transparent],
    depthWrite: [f.paint.depthWrite, f.flatPaint.depthWrite],
    shadows: [f.deform.castShadow, f.flatMesh.castShadow],
  }
}

describe('piano registered adapter', () => {
  it('samples real TRS and morph tracks and can return from the clip endpoint', () => {
    const f = fixture(),
      adapter = f.bind()
    try {
      adapter.pose['sound-path'] = 0.5
      adapter.apply()
      expect(f.section.position.toArray()).toEqual([2, 4, 0])
      expect(f.section.scale.toArray()).toEqual([1.5, 1, 1])
      expect(f.section.quaternion.y).toBeCloseTo(Math.SQRT1_2, 6)
      expect(f.deform.morphTargetInfluences).toEqual([0.5])
      expect(f.paint.opacity).toBe(0.5)
      expect(f.flatPaint.opacity).toBe(0.5)
      expect(f.paint.depthWrite).toBe(false)
      expect(f.deform.castShadow).toBe(false)
      const middle = snapshot(f)
      adapter.pose['sound-path'] = 1
      adapter.apply()
      expect(f.section.visible).toBe(false)
      expect(f.flat.visible).toBe(true)
      expect(f.flat.position.toArray()).toEqual([14, 0, 0])
      expect(f.deform.morphTargetInfluences).toEqual([1])
      adapter.pose['sound-path'] = 0.5
      adapter.apply()
      expect(snapshot(f)).toEqual(middle)
    } finally {
      adapter.dispose()
    }
  })

  it('has deterministic reverse samples and no drift over 50 complete round trips', () => {
    const f = fixture(),
      adapter = f.bind()
    try {
      const forward = Array.from({ length: 101 }, (_, i) => {
        adapter.pose['sound-path'] = i / 100
        adapter.apply()
        return snapshot(f)
      })
      for (let i = 100; i >= 0; i--) {
        adapter.pose['sound-path'] = i / 100
        adapter.apply()
        expect(snapshot(f)).toEqual(forward[i])
      }
      for (let i = 0; i < 50; i++) {
        adapter.pose['sound-path'] = 1
        adapter.apply()
        adapter.pose['sound-path'] = 0
        adapter.apply()
        expect(snapshot(f)).toEqual(forward[0])
      }
      adapter.pose['sound-path'] = 2
      adapter.apply()
      expect(snapshot(f)).toEqual(forward[100])
      adapter.pose['sound-path'] = -1
      adapter.apply()
      expect(snapshot(f)).toEqual(forward[0])
    } finally {
      adapter.dispose()
    }
  })

  it('follows visible section and flat meshes in world space and maps their hits to one part', () => {
    const f = fixture(),
      adapter = f.bind(),
      point = new Vector3()
    try {
      expect(adapter.point(f.semantic.name, point)?.toArray()).toEqual([5, 1, -2])
      expect(adapter.nodeForHit(f.deform)).toBe(f.semantic)
      expect(adapter.nodeForHit(f.shared)).toBe(f.semantic)
      adapter.pose['sound-path'] = 1
      adapter.apply()
      expect(adapter.point(f.semantic.name, point)?.toArray()).toEqual([33, 1, -2])
      expect(adapter.nodeForHit(f.flatMesh)).toBe(f.semantic)
      expect(adapter.nodeForHit(f.model)).toBe(f.model)
      expect(adapter.point(f.semantic.name, point, [1, 0, 0])?.toArray()).toEqual([15, 7, 2])
      f.flat.visible = false
      expect(adapter.point(f.semantic.name, point)?.toArray()).toEqual([13, 7, 2])
    } finally {
      adapter.dispose()
    }
  })

  it('restores selection colors and releases mixer and shared resources exactly once', () => {
    const uncacheRoot = vi.spyOn(AnimationMixer.prototype, 'uncacheRoot'),
      uncacheClip = vi.spyOn(AnimationMixer.prototype, 'uncacheClip'),
      f = fixture(),
      original = f.paint.emissive.clone(),
      originalFlat = f.flatPaint.emissive.clone(),
      adapter = f.bind()
    try {
      expect(f.paint.envMapIntensity).toBe(1.25)
      expect(f.flatPaint.envMapIntensity).toBe(0.7)
      adapter.setFinish('#607080')
      const finish = f.paint.color.clone()
      adapter.select(f.semantic.name)
      expect(f.paint.emissive.equals(original)).toBe(false)
      expect(f.paint.color.equals(finish)).toBe(true)
      adapter.select(f.semantic.name)
      adapter.select()
      expect(f.paint.emissive.equals(original)).toBe(true)
      expect(f.flatPaint.emissive.equals(originalFlat)).toBe(true)
      expect(f.paint.emissiveIntensity).toBe(0.1)
      expect(f.geometryDisposed).not.toHaveBeenCalled()
      adapter.select(f.semantic.name)
      adapter.dispose()
      adapter.dispose()
      expect(f.paint.emissive.equals(original)).toBe(true)
      expect(f.release).toHaveBeenCalledTimes(1)
      expect(f.geometryDisposed).toHaveBeenCalledTimes(1)
      expect(f.paintDisposed).toHaveBeenCalledTimes(1)
      expect(f.flatPaintDisposed).toHaveBeenCalledTimes(1)
      expect(uncacheRoot).toHaveBeenCalledExactlyOnceWith(f.model)
      expect(uncacheClip).toHaveBeenCalledExactlyOnceWith(f.clip)
      expect(adapter.nodes.size).toBe(0)
      expect(adapter.root.children).toHaveLength(0)
    } finally {
      adapter.dispose()
      uncacheRoot.mockRestore()
      uncacheClip.mockRestore()
    }
  })

  it('rejects missing clips, mismatched duration, missing surfaces and wrong material slots', () => {
    const cases: ((f: ReturnType<typeof fixture>) => void)[] = [
      (f) => {
        f.clip.name = 'other-clip'
      },
      (f) => {
        f.clip.duration = 6
      },
      (f) => {
        f.clip.tracks = []
      },
      (f) => {
        f.flat.name = 'missing-flat'
      },
      (f) => {
        f.rig.surfaces[0]!.curves = [0, 1, 0]
      },
    ]
    for (const mutate of cases) {
      const f = fixture()
      try {
        mutate(f)
        expect(() => f.bind()).toThrow()
      } finally {
        // Failed construction leaves decoded resources to the loader owner.
        f.release()
      }
    }
  })
})

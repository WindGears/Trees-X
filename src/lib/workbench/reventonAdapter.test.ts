import { readFileSync } from 'node:fs'
import {
  BoxGeometry,
  Color,
  Group,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Quaternion,
  Scene,
  Texture,
  Vector3,
} from 'three'
import { MeshPhysicalNodeMaterial, type WebGPURenderer } from 'three/webgpu'
import { describe, expect, it, vi } from 'vitest'
import { parseProduct } from './api'
import { bindReventon, type ReventonGpuDependencies } from './reventonAdapter'
import { progressActions } from './motionConfig'
import type { GlbSource, MotionTrack } from './types'
import { isCarStudioScene } from './carStudioQuality'

function fixture() {
  const raw: unknown = JSON.parse(
    readFileSync('server/src/main/resources/presentations/reventon-workbench-v1.json', 'utf8'),
  )
  const product = parseProduct(raw)
  if (product.presentation.source.kind !== 'glb') throw new Error('Expected car GLB fixture')
  const source: GlbSource = product.presentation.source
  source.transform = { position: [2, 1, -3], rotation: [0, 0.37, 0], scale: 1.25 }
  const model = new Group(),
    parent = new Group(),
    geometry = new BoxGeometry(1, 1, 1)
  model.name = 'Reventon__Studio_Validation'
  parent.name = 'FixtureParent'
  parent.position.set(0.3, 0.7, -0.2)
  parent.rotation.set(0.2, -0.15, 0.1)
  parent.scale.setScalar(0.85)
  model.add(parent)
  const tracks = progressActions(product.presentation).flatMap(
    (action) => action.motion.tracks ?? [],
  )
  const names = [...new Set(tracks.map((track) => track.node))]
  const nodes = names.map((name, index) => {
    const node = new Group()
    node.name = name
    node.position.set(index * 0.2 - 0.6, 0.1 + index * 0.04, index * -0.13)
    node.rotation.set(0.12, index * 0.035, -0.08)
    parent.add(node)
    return node
  })
  const paints = source.finishMaterials.map((name, index) => {
    const material = new MeshStandardMaterial()
    material.name = name
    material.color.setRGB(0.2 + index * 0.03, 0.25 + index * 0.025, 0.3 + index * 0.02)
    const surface = new Mesh(geometry, material)
    surface.name = 'FixtureSurface-' + index
    surface.userData.source_object_count = 3
    ;(nodes[index - 1] ?? parent).add(surface)
    return material
  })
  const interior = new MeshStandardMaterial({ color: '#14191c' }),
    trim = new Mesh(geometry, interior)
  interior.name = 'FixtureUnlistedInterior'
  trim.name = 'FixtureTrim'
  parent.add(trim)
  const original = paints.map((material) => material.color.clone())
  const rest = new Map(
    nodes.map((node) => [
      node.name,
      { position: node.position.clone(), quaternion: node.quaternion.clone() },
    ]),
  )
  const geometryDisposed = vi.fn(),
    materialsDisposed = vi.fn()
  geometry.addEventListener('dispose', geometryDisposed)
  for (const material of [...paints, interior])
    material.addEventListener('dispose', materialsDisposed)
  const release = vi.fn(() => {
    geometry.dispose()
    for (const material of [...paints, interior]) material.dispose()
  })
  return {
    product,
    source,
    model,
    nodes,
    geometry,
    paints,
    interior,
    original,
    rest,
    geometryDisposed,
    materialsDisposed,
    release,
    bind: () => bindReventon(product, source, model, release),
  }
}

function snapshot(f: ReturnType<typeof fixture>) {
  return f.nodes.map((node) => ({
    id: node.name,
    position: node.position.toArray(),
    quaternion: node.quaternion.toArray(),
    scale: node.scale.toArray(),
  }))
}

function localProgress(track: MotionTrack, progress: number) {
  return Math.max(0, Math.min(1, (progress - track.range[0]) / (track.range[1] - track.range[0])))
}

describe('Reventon registered workbench adapter', () => {
  it.each([false, true])(
    'commits graphite reset color only after successful setup (failure=%s)',
    (fail) => {
      vi.stubGlobal('location', {
        search: '?carQuality=studio&carShowroom=cold-studio&carStudioPaint=graphite',
      })
      const f = fixture(),
        paint = new MeshPhysicalMaterial({ color: '#101010' }),
        native = paint.color.clone(),
        stage = {
          render: vi.fn(),
          markDirty: vi.fn(),
          dispose: vi.fn(),
          prepare: vi.fn(async () => {}),
        }
      paint.name = 'Reventon / fixed / 20159'
      paint.userData.source_vpb_material_id = 20159
      f.source.finishMaterials = [paint.name]
      f.model.add(new Mesh(f.geometry, paint))
      const adapter = bindReventon(f.product, f.source, f.model, f.release, {
        prepareMaterials: () => ({ sync: vi.fn(), dispose: vi.fn() }),
        createStage: () => {
          expect(paint.color.getHexString()).toBe('484b4f')
          if (fail) throw new Error('candidate setup failed')
          return stage
        },
      })
      try {
        const renderer = {
          isWebGPURenderer: true,
          getMaxAnisotropy: () => 16,
        } as unknown as WebGPURenderer
        if (fail)
          expect(() => adapter.attach?.(new Scene(), renderer)).toThrow('candidate setup failed')
        else adapter.attach?.(new Scene(), renderer)
        adapter.setFinish('#eeeeee')
        adapter.setFinish(f.product.presentation.finishes[0]!.color)
        expect(paint.color.getHexString()).toBe(fail ? native.getHexString() : '484b4f')
        adapter.dispose()
        expect(paint.color).toEqual(native)
      } finally {
        adapter.dispose()
        paint.dispose()
        vi.unstubAllGlobals()
      }
    },
  )

  it.each([false, true])('owns studio look restoration after GPU attach (failure=%s)', (fail) => {
    vi.stubGlobal('location', { search: '?carQuality=studio' })
    const f = fixture(),
      material = new MeshPhysicalMaterial({ roughness: 0.451 }),
      scene = new Scene(),
      stage = {
        render: vi.fn(),
        markDirty: vi.fn(),
        dispose: vi.fn(),
        prepare: vi.fn(async () => {}),
      }
    material.name = f.source.finishMaterials[0]!
    f.model.add(new Mesh(f.geometry, material))
    const release = vi.fn(() => {
        expect(material.roughness).toBe(0.451)
        expect(material.clearcoat).toBe(0)
        f.release()
      }),
      gpu: ReventonGpuDependencies = {
        prepareMaterials: vi.fn(() => {
          expect(material.roughness).toBe(0.34)
          return { sync: vi.fn(), dispose: vi.fn() }
        }),
        createStage: vi.fn((_renderer, _scene, root, options) => {
          expect(root.userData.carStudioQuality).toBe('studio')
          expect(options).toEqual({ quality: 'studio' })
          if (fail) throw new Error('studio setup failed')
          return stage
        }),
      },
      adapter = bindReventon(f.product, f.source, f.model, release, gpu)
    scene.add(adapter.root)
    try {
      const renderer = {
        isWebGPURenderer: true,
        getMaxAnisotropy: () => 16,
      } as unknown as WebGPURenderer
      if (fail) expect(() => adapter.attach?.(scene, renderer)).toThrow('studio setup failed')
      else adapter.attach?.(scene, renderer)
      expect(isCarStudioScene(scene)).toBe(!fail)
      adapter.dispose()
      adapter.dispose()
      expect(isCarStudioScene(scene)).toBe(false)
      expect(release).toHaveBeenCalledTimes(1)
    } finally {
      adapter.dispose()
      material.dispose()
      vi.unstubAllGlobals()
    }
  })

  it('does not apply studio material or stage options to administrator resource references', () => {
    vi.stubGlobal('location', { search: '?carQuality=studio' })
    const f = fixture(),
      material = new MeshPhysicalMaterial({ roughness: 0.451 }),
      scene = new Scene(),
      stage = {
        render: vi.fn(),
        markDirty: vi.fn(),
        dispose: vi.fn(),
        prepare: vi.fn(async () => {}),
      }
    material.name = f.source.finishMaterials[0]!
    f.model.add(new Mesh(f.geometry, material))
    f.source.bundle = { ...f.source.bundle, sha256: 'f'.repeat(64) }
    const gpu: ReventonGpuDependencies = {
        prepareMaterials: () => ({ sync: vi.fn(), dispose: vi.fn() }),
        createStage: vi.fn(() => stage),
      },
      adapter = bindReventon(f.product, f.source, f.model, f.release, gpu),
      renderer = { isWebGPURenderer: true, getMaxAnisotropy: () => 16 } as unknown as WebGPURenderer
    try {
      scene.add(adapter.root)
      adapter.attach?.(scene, renderer)
      expect(material.roughness).toBe(0.451)
      expect(isCarStudioScene(scene)).toBe(false)
      expect(gpu.createStage).toHaveBeenCalledExactlyOnceWith(renderer, scene, adapter.root)
    } finally {
      adapter.dispose()
      material.dispose()
      vi.unstubAllGlobals()
    }
  })

  it('canonicalizes exact borrowed maps before GPU bindings and restores them before loader release', () => {
    const f = fixture(),
      first = new Texture(),
      clone = first.clone(),
      stage = {
        render: vi.fn(),
        markDirty: vi.fn(),
        dispose: vi.fn(),
        prepare: vi.fn(async () => {}),
      }
    first.needsUpdate = true
    f.paints[0]!.map = first
    f.paints[1]!.map = clone
    const release = vi.fn(() => {
        expect(f.paints[0]!.map).toBe(first)
        expect(f.paints[1]!.map).toBe(clone)
        f.release()
      }),
      materials = {
        sync: vi.fn(),
        dispose: vi.fn(() => expect(f.paints[1]!.map).toBe(f.paints[0]!.map)),
      },
      gpu: ReventonGpuDependencies = {
        prepareMaterials: vi.fn(() => {
          expect(f.paints[1]!.map).toBe(f.paints[0]!.map)
          return materials
        }),
        createStage: () => stage,
      },
      adapter = bindReventon(f.product, f.source, f.model, release, gpu)
    // WebGL and pre-attach state keep original references.
    expect(f.paints[1]!.map).toBe(clone)
    adapter.attach?.(new Scene(), {
      isWebGPURenderer: true,
      getMaxAnisotropy: () => 16,
    } as unknown as WebGPURenderer)
    const firstDispose = vi.spyOn(first, 'dispose'),
      cloneDispose = vi.spyOn(clone, 'dispose')
    adapter.dispose()
    adapter.dispose()
    expect(release).toHaveBeenCalledTimes(1)
    expect(materials.dispose).toHaveBeenCalledTimes(1)
    expect(firstDispose).not.toHaveBeenCalled()
    expect(cloneDispose).not.toHaveBeenCalled()
    first.dispose()
    clone.dispose()
  })

  it.each(['materials', 'stage'])(
    'restores source texture references after failed GPU %s preparation',
    (phase) => {
      const f = fixture(),
        first = new Texture(),
        clone = first.clone(),
        materials = { sync: vi.fn(), dispose: vi.fn() }
      first.needsUpdate = true
      f.paints[0]!.map = first
      f.paints[1]!.map = clone
      const gpu: ReventonGpuDependencies = {
          prepareMaterials: () => {
            expect(f.paints[1]!.map).toBe(f.paints[0]!.map)
            if (phase === 'materials') throw new Error('failed materials')
            return materials
          },
          createStage: () => {
            throw new Error('failed stage')
          },
        },
        adapter = bindReventon(f.product, f.source, f.model, f.release, gpu)
      expect(() =>
        adapter.attach?.(new Scene(), { isWebGPURenderer: true } as unknown as WebGPURenderer),
      ).toThrow(`failed ${phase}`)
      expect(f.paints[1]!.map).toBe(clone)
      expect(f.release).not.toHaveBeenCalled()
      adapter.dispose()
      expect(f.release).toHaveBeenCalledTimes(1)
      first.dispose()
      clone.dispose()
    },
  )

  it('selects the GPU dependencies once, preserves source selection through derived bindings, and disposes them before loader resources', () => {
    const f = fixture(),
      scene = new Scene(),
      stage = {
        render: vi.fn(),
        markDirty: vi.fn(),
        dispose: vi.fn(),
        prepare: vi.fn(async () => {}),
      },
      materials = { sync: vi.fn(), dispose: vi.fn() },
      selected = f.nodes[0]!.children.find((node): node is Mesh => node instanceof Mesh)!,
      runtime = new MeshPhysicalNodeMaterial(),
      gpu: ReventonGpuDependencies = {
        createStage: vi.fn(() => stage),
        prepareMaterials: vi.fn(() => {
          selected.material = runtime
          return materials
        }),
      },
      renderer = {
        isWebGPURenderer: true,
        getMaxAnisotropy: () => 16,
      } as unknown as WebGPURenderer,
      adapter = bindReventon(f.product, f.source, f.model, f.release, gpu),
      initial = f.paints[1]!.emissive.clone()
    adapter.attach?.(scene, renderer)
    adapter.attach?.(scene, renderer)
    expect(gpu.prepareMaterials).toHaveBeenCalledExactlyOnceWith(f.model)
    expect(gpu.createStage).toHaveBeenCalledExactlyOnceWith(renderer, scene, adapter.root)
    adapter.select?.(f.nodes[0]!.name)
    expect(f.paints[1]!.emissive.getHexString()).toBe('537382')
    expect(f.paints[1]!.emissiveIntensity).toBe(0.13)
    adapter.select?.()
    expect(f.paints[1]!.emissive.equals(initial)).toBe(true)
    adapter.beforeRender?.()
    expect(materials.sync).toHaveBeenCalledTimes(1)
    expect(stage.render).toHaveBeenCalledTimes(1)
    adapter.apply()
    expect(stage.markDirty).toHaveBeenCalledTimes(1)
    adapter.dispose()
    adapter.dispose()
    expect(stage.dispose).toHaveBeenCalledTimes(1)
    expect(materials.dispose).toHaveBeenCalledTimes(1)
    expect(materials.dispose.mock.invocationCallOrder[0]).toBeLessThan(
      f.release.mock.invocationCallOrder[0]!,
    )
    expect(f.release).toHaveBeenCalledTimes(1)
    runtime.dispose()
  })

  it('restores and releases GPU material bindings after partial stage setup fails', () => {
    const f = fixture(),
      materials = { sync: vi.fn(), dispose: vi.fn() },
      gpu: ReventonGpuDependencies = {
        prepareMaterials: () => materials,
        createStage: () => {
          throw new Error('stage initialization failed')
        },
      },
      adapter = bindReventon(f.product, f.source, f.model, f.release, gpu),
      renderer = { isWebGPURenderer: true } as unknown as WebGPURenderer
    expect(() => adapter.attach?.(new Scene(), renderer)).toThrow('stage initialization failed')
    expect(materials.dispose).toHaveBeenCalledTimes(1)
    expect(f.release).not.toHaveBeenCalled()
    adapter.dispose()
    expect(materials.dispose).toHaveBeenCalledTimes(1)
    expect(f.release).toHaveBeenCalledTimes(1)
  })

  it('combines both door rotations and all seven separation groups from their initial poses', () => {
    const f = fixture(),
      adapter = f.bind()
    try {
      const actions = progressActions(f.product.presentation),
        doors = actions.find((action) => action.id === 'open-doors')!,
        parts = actions.find((action) => action.id === 'explore-parts')!
      expect(doors.motion.tracks).toHaveLength(2)
      expect(parts.motion.tracks).toHaveLength(7)
      adapter.pose['open-doors'] = 0.625
      adapter.pose['explore-parts'] = 0.58
      adapter.apply()
      for (const track of parts.motion.tracks ?? []) {
        if (track.type !== 'translate') throw new Error('Expected separation translation')
        const node = adapter.nodes.get(track.node)!,
          base = f.rest.get(track.node)!
        const expected = base.position
          .clone()
          .addScaledVector(new Vector3(...track.offset), localProgress(track, 0.58))
        expect(node.position.distanceTo(expected)).toBeLessThan(1e-12)
      }
      for (const track of doors.motion.tracks ?? []) {
        if (track.type !== 'rotate') throw new Error('Expected door rotation')
        const node = adapter.nodes.get(track.node)!,
          base = f.rest.get(track.node)!
        const expected = base.quaternion
          .clone()
          .multiply(
            new Quaternion().setFromAxisAngle(
              new Vector3(...track.axis).normalize(),
              track.angle * localProgress(track, 0.625),
            ),
          )
        expect(1 - Math.abs(node.quaternion.dot(expected))).toBeLessThan(1e-12)
      }
      const combined = snapshot(f)
      adapter.pose['open-doors'] = 0
      adapter.apply()
      expect(snapshot(f).map((item) => item.position)).toEqual(
        combined.map((item) => item.position),
      )
      adapter.pose['open-doors'] = 0.625
      adapter.pose['explore-parts'] = 0
      adapter.apply()
      expect(snapshot(f).map((item) => item.quaternion)).toEqual(
        combined.map((item) => item.quaternion),
      )
      expect(adapter.root.userData.adapter).toBe('reventon-v1')
      expect(adapter.root.userData.sourceObjects).toBe(f.paints.length * 3)
    } finally {
      adapter.dispose()
    }
  })

  it('samples 101 progress points in both directions and restores without drift for 50 cycles', () => {
    const f = fixture(),
      adapter = f.bind()
    try {
      for (const action of progressActions(f.product.presentation)) {
        const other = action.id === 'open-doors' ? 'explore-parts' : 'open-doors'
        adapter.pose[other] = 0.37
        const forward = Array.from({ length: 101 }, (_, index) => {
          adapter.pose[action.id] = index / 100
          adapter.apply()
          return snapshot(f)
        })
        for (let index = 100; index >= 0; index--) {
          adapter.pose[action.id] = index / 100
          adapter.apply()
          expect(snapshot(f)).toEqual(forward[index])
        }
      }
      adapter.pose['open-doors'] = 0
      adapter.pose['explore-parts'] = 0
      adapter.apply()
      const initial = snapshot(f)
      for (let cycle = 0; cycle < 50; cycle++) {
        adapter.pose['open-doors'] = 1
        adapter.pose['explore-parts'] = 1
        adapter.apply()
        adapter.pose['open-doors'] = 0
        adapter.apply()
        adapter.pose['explore-parts'] = 0
        adapter.apply()
        expect(snapshot(f)).toEqual(initial)
      }
    } finally {
      adapter.dispose()
    }
  })

  it('keeps explicit hotspot anchors attached to a moving node in world space', () => {
    const f = fixture(),
      adapter = f.bind(),
      point = new Vector3()
    try {
      const hotspot = f.product.presentation.hotspots.find((entry) => entry.id === 'door_1')!,
        node = adapter.nodes.get(hotspot.node)!
      if (!hotspot.anchor) throw new Error('Expected local hotspot anchor')
      const initial = adapter.point(hotspot.node, point, hotspot.anchor)!.clone()
      adapter.pose['open-doors'] = 0.7
      adapter.pose['explore-parts'] = 0.63
      adapter.apply()
      const moved = adapter.point(hotspot.node, point, hotspot.anchor)!.clone()
      expect(moved.distanceTo(initial)).toBeGreaterThan(0.1)
      expect(
        moved.distanceTo(new Vector3(...hotspot.anchor).applyMatrix4(node.matrixWorld)),
      ).toBeLessThan(1e-12)
      expect(moved.distanceTo(node.getWorldPosition(new Vector3()))).toBeGreaterThan(0.1)
      adapter.pose['open-doors'] = 0
      adapter.pose['explore-parts'] = 0
      adapter.apply()
      expect(adapter.point(hotspot.node, point, hotspot.anchor)!.distanceTo(initial)).toBeLessThan(
        1e-12,
      )
    } finally {
      adapter.dispose()
    }
  })

  it('preserves distinct original colors and only recolors configured body materials', () => {
    const f = fixture(),
      adapter = f.bind(),
      interior = f.interior.color.clone()
    try {
      adapter.setFinish(f.product.presentation.finishes[0]!.color)
      f.paints.forEach((material, index) =>
        expect(material.color.equals(f.original[index]!)).toBe(true),
      )
      const color = '#607080'
      adapter.setFinish(color)
      f.paints.forEach((material) => expect(material.color.equals(new Color(color))).toBe(true))
      expect(f.interior.color.equals(interior)).toBe(true)
      adapter.setFinish(f.product.presentation.finishes[0]!.color)
      f.paints.forEach((material, index) =>
        expect(material.color.equals(f.original[index]!)).toBe(true),
      )
      expect(f.interior.color.equals(interior)).toBe(true)
    } finally {
      adapter.dispose()
    }
  })

  it('leaves decoded geometry and materials to the loader and releases them once on disposal', () => {
    const f = fixture(),
      adapter = f.bind()
    expect(f.geometryDisposed).not.toHaveBeenCalled()
    expect(f.materialsDisposed).not.toHaveBeenCalled()
    adapter.pose['open-doors'] = 0.5
    adapter.pose['explore-parts'] = 1
    adapter.apply()
    expect(f.geometryDisposed).not.toHaveBeenCalled()
    adapter.dispose()
    adapter.dispose()
    expect(f.release).toHaveBeenCalledTimes(1)
    expect(f.geometryDisposed).toHaveBeenCalledTimes(1)
    expect(f.materialsDisposed).toHaveBeenCalledTimes(f.paints.length + 1)
    expect(adapter.nodes.size).toBe(0)
    expect(adapter.root.children).toHaveLength(0)
  })
})

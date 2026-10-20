import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BoxGeometry,
  DataTexture,
  EquirectangularReflectionMapping,
  FloatType,
  Group,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  PerspectiveCamera,
  RGBAFormat,
  Scene,
  Texture,
  Vector3,
} from 'three'
import { texture, uniform, vec3 } from 'three/tsl'
import type { WebGPURenderer } from 'three/webgpu'
import {
  createProbeField,
  type SpeedballField,
  type SpeedballState,
  type SpeedballStats,
} from 'speedball-gi'
import { createRealtimeDdgi } from './field'
import { ddgiBudget } from './contract'
import { reventonRealtimeProfile, type RealtimeProductProfile } from '../productProfile'
import { withPreparationLease } from '../../preparationLease'

vi.mock('speedball-gi', () => ({ createProbeField: vi.fn() }))
const create = vi.mocked(createProbeField),
  cleanups: (() => void)[] = []

function fakeField() {
  const state: SpeedballState = {
      dirty: true,
      buildDirty: true,
      buildStage: 0,
      rebuildBackoff: 0,
      inFlight: false,
      tickBudgetRays: 98304,
      lastTransformInstanceCount: 0,
      lastTlasRefitCount: 0,
      sceneStorageRebinds: 0,
      sceneStorageRewrites: 0,
      mapsArenaRebinds: 0,
      mapsArenaRewrites: 0,
      updatedCount: 0,
      cascadeState: [{ needsClear: true }],
    },
    stats: SpeedballStats = {
      probes: 0,
      res: new Vector3(2, 2, 2),
      atlas: [1, 1],
      rays: 64,
      active: false,
      reflectionQuality: 'off',
      cascades: 1,
      budgetRays: 98304,
    }
  let data = false
  const tick = vi.fn<SpeedballField['tick']>(async () => {
    if (!data) {
      data = true
      stats.active = true
      state.dirty = state.buildDirty = false
      state.buildStage = 2
      create.mock.calls[0]![0].onRebuilt()
    } else {
      state.updatedCount = stats.probes
      state.cascadeState[0]!.needsClear = false
    }
  })
  const api: SpeedballField = {
    node: {
      active: true,
      cacheToken: 'test-structure',
      normalBiasNode: [{ value: 0.02 }],
      sampleBiasScaleNode: { value: 1 },
      intensityNode: uniform(1),
      enabledNode: uniform(1),
      sampleIrradiance: vi.fn(() => vec3(0.4)),
    },
    tick,
    resetFramePacing: vi.fn(),
    setEnabled: vi.fn(),
    setRayBudget: vi.fn(),
    setVolumes: vi.fn((volumes) => {
      stats.res.copy(volumes[0]!.res)
      stats.probes = stats.res.x * stats.res.y * stats.res.z
    }),
    setSky: vi.fn(),
    setSkyIntensity: vi.fn(),
    markTransformsDirty: vi.fn(),
    markMaterialValuesDirty: vi.fn(),
    markTopologyDirty: vi.fn(),
    forceLightingRefresh: vi.fn(),
    isSupported: () => true,
    hasData: () => data,
    getStats: () => stats,
    _debugState: () => ({
      ...state,
      cascadeState: state.cascadeState.map((entry) => ({ ...entry })),
    }),
    dispose: vi.fn(),
  }
  create.mockReturnValue(api)
  return { api, state, stats, tick }
}

function fixture(profile?: RealtimeProductProfile, legacySchedule = false) {
  const scene = new Scene(),
    product = new Group(),
    geometry = new BoxGeometry(),
    material = new MeshStandardMaterial(),
    mesh = new InstancedMesh(geometry, material, 2),
    hdr = new DataTexture(new Float32Array(2 * 2 * 4).fill(1), 2, 2, RGBAFormat, FloatType),
    hook = vi.fn(),
    renderer = {
      backend: { isWebGPUBackend: true },
      lighting: { createNode: hook },
    } as unknown as WebGPURenderer,
    onReadyChanged = vi.fn(),
    onError = vi.fn()
  hdr.mapping = EquirectangularReflectionMapping
  scene.environment = hdr
  scene.environmentIntensity = 0.35
  product.userData.workbenchProduct = 'typewriter-study'
  product.add(mesh)
  scene.add(product)
  const fake = fakeField(),
    adapter = createRealtimeDdgi({
      renderer,
      scene,
      profile,
      legacySchedule,
      onReadyChanged,
      onError,
    })
  cleanups.push(() => {
    adapter.dispose()
    geometry.dispose()
    material.dispose()
    mesh.dispose()
    hdr.dispose()
  })
  return {
    scene,
    product,
    geometry,
    material,
    mesh,
    hdr,
    renderer,
    hook,
    onReadyChanged,
    onError,
    fake,
    adapter,
  }
}

beforeEach(() => create.mockReset())
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
  vi.restoreAllMocks()
})

describe('owned fixed-budget DDGI field', () => {
  it('defers physical field/proxy cleanup until a leased native tick settles while immediately rejecting stale output', async () => {
    const f = fixture(),
      proxyScene = create.mock.calls[0]![0].scene,
      clear = vi.spyOn(proxyScene, 'clear')
    let finish!: () => void
    f.fake.tick.mockImplementationOnce(() => new Promise<void>((resolve) => (finish = resolve)))
    const tick = withPreparationLease(f.renderer, () => f.adapter.tick())
    f.adapter.dispose()
    f.adapter.dispose()
    expect(f.adapter.snapshot()).toMatchObject({ ready: false, disposed: true, inFlight: true })
    expect(f.fake.api.dispose).not.toHaveBeenCalled()
    expect(clear).not.toHaveBeenCalled()
    expect(proxyScene.children.length).toBeGreaterThan(0)
    finish()
    await tick
    expect(f.fake.api.dispose).toHaveBeenCalledOnce()
    expect(clear).toHaveBeenCalledOnce()
    expect(f.onReadyChanged).not.toHaveBeenCalled()
    expect(f.onError).not.toHaveBeenCalled()
  })
  it('uses the car profile volume with the same fixed solve budget and an independent field owner', async () => {
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    const f = fixture(reventonRealtimeProfile)
    expect(f.fake.api.setVolumes).toHaveBeenCalledOnce()
    const volume = vi.mocked(f.fake.api.setVolumes).mock.calls[0]![0][0]!
    expect(volume.res.toArray()).toEqual([12, 8, 16])
    expect(f.fake.api.setRayBudget).toHaveBeenCalledWith(98304)
    await f.adapter.tick()
    now = 100
    await f.adapter.tick()
    expect(f.adapter.snapshot()).toMatchObject({
      profile: 'reventon-v1',
      ready: true,
      probes: 1536,
      actualRays: 64,
      actualBudgetRays: 98304,
      reflectionQuality: 'off',
    })
    f.adapter.dispose()
    f.adapter.dispose()
    expect(f.fake.api.dispose).toHaveBeenCalledOnce()
  })

  it('retains the old per-frame car schedule only behind the explicit comparison option', async () => {
    vi.spyOn(performance, 'now').mockReturnValue(1000)
    const f = fixture(reventonRealtimeProfile, true)
    await f.adapter.tick(0)
    await f.adapter.tick(0)
    expect(f.adapter.snapshot()).toMatchObject({ ready: true, scheduling: null })
    expect(f.adapter.needsUpdate()).toBe(true)
    expect(f.fake.tick).toHaveBeenCalledTimes(2)
  })

  it('caches car GI after twelve full settling solves without rescanning on orbit frames', async () => {
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    const f = fixture(reventonRealtimeProfile),
      sceneSync = vi.spyOn(f.scene, 'updateMatrixWorld')
    await f.adapter.tick()
    for (let index = 1; index <= 12; index++) {
      now = index * 100
      expect(f.adapter.needsUpdate()).toBe(true)
      await f.adapter.tick()
    }
    expect(sceneSync).toHaveBeenCalledOnce()
    expect(f.adapter.snapshot()).toMatchObject({
      ready: true,
      acceptedTicks: 13,
      scheduling: { remainingSolves: 0, cached: true, completed: 12 },
    })
    for (let index = 0; index < 50; index++) {
      now += 100
      f.adapter.invalidate('camera')
      expect(f.adapter.needsUpdate()).toBe(false)
      await f.adapter.tick()
    }
    expect(f.fake.tick).toHaveBeenCalledTimes(13)
    expect(sceneSync).toHaveBeenCalledOnce()
    f.mesh.setMatrixAt(1, new Matrix4().makeTranslation(1, 0, 0))
    f.mesh.instanceMatrix.needsUpdate = true
    f.adapter.invalidate('pose')
    expect(f.adapter.needsUpdate()).toBe(true)
    await f.adapter.tick()
    expect(f.fake.api.markTransformsDirty).toHaveBeenCalledOnce()
    expect(sceneSync).toHaveBeenCalledTimes(2)
    expect(f.adapter.snapshot()).toMatchObject({
      scheduling: { remainingSolves: 11, cached: false },
      actualRays: 64,
      actualBudgetRays: 98304,
    })
  })

  it('advances car rebuilds while moving and uses world activity rather than camera quiet time', async () => {
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    const f = fixture(reventonRealtimeProfile)
    await f.adapter.tick(0)
    now = 100
    f.adapter.invalidate('camera')
    await f.adapter.tick(0)
    expect(f.fake.tick).toHaveBeenLastCalledWith({ idleMs: 100, playing: false })
    now = 200
    f.scene.environmentIntensity = 0.5
    f.adapter.invalidate('environment')
    await f.adapter.tick(500)
    expect(f.fake.api.setSky).toHaveBeenCalledTimes(2)
    expect(f.fake.tick).toHaveBeenLastCalledWith({ idleMs: 0, playing: false })
    now = 250
    await f.adapter.tick()
    expect(f.fake.tick).toHaveBeenCalledTimes(3)
    now = 300
    f.fake.state.dirty = f.fake.state.buildDirty = true
    f.fake.tick.mockImplementationOnce(async () => {})
    await f.adapter.tick()
    expect(f.adapter.snapshot()).toMatchObject({ ready: false, error: null })
    now = 400
    expect(f.adapter.needsUpdate()).toBe(true)
    f.fake.tick.mockImplementationOnce(async () => {
      f.fake.state.dirty = f.fake.state.buildDirty = false
      create.mock.calls[0]![0].onRebuilt()
    })
    await f.adapter.tick()
    expect(f.adapter.snapshot()).toMatchObject({ ready: true, error: null })
  })

  it.each(['setVolumes', 'setRayBudget', 'setSkyIntensity', 'setEnabled'] as const)(
    'releases the field and proxy once when construction %s throws while protecting borrowed sources',
    (setter) => {
      const scene = new Scene(),
        product = new Group(),
        geometry = new BoxGeometry(),
        map = new Texture(),
        material = new MeshStandardMaterial({ map }),
        mesh = new InstancedMesh(geometry, material, 2),
        hdr = new DataTexture(new Float32Array(2 * 2 * 4).fill(1), 2, 2, RGBAFormat, FloatType),
        renderer = { backend: { isWebGPUBackend: true } } as unknown as WebGPURenderer,
        fake = fakeField(),
        proxyReleased = vi.fn(),
        borrowedReleases = [
          vi.spyOn(geometry, 'dispose'),
          vi.spyOn(material, 'dispose'),
          vi.spyOn(map, 'dispose'),
          vi.spyOn(mesh, 'dispose'),
          vi.spyOn(hdr, 'dispose'),
        ]
      product.userData.workbenchProduct = 'typewriter-study'
      product.add(mesh)
      scene.add(product)
      scene.environment = hdr
      cleanups.push(() => {
        geometry.dispose()
        material.dispose()
        map.dispose()
        mesh.dispose()
        hdr.dispose()
      })
      create.mockImplementationOnce((options) => {
        const clear = options.scene.clear.bind(options.scene)
        vi.spyOn(options.scene, 'clear').mockImplementation(() => {
          proxyReleased()
          return clear()
        })
        expect(options.scene.children).toHaveLength(1)
        return fake.api
      })
      const failure = new Error(`${setter} rejected`)
      vi.mocked(fake.api[setter]).mockImplementationOnce(() => {
        throw failure
      })
      expect(() => createRealtimeDdgi({ renderer, scene })).toThrow(failure)
      expect(fake.api.dispose).toHaveBeenCalledTimes(1)
      expect(proxyReleased).toHaveBeenCalledTimes(1)
      expect(create.mock.calls[0]![0].scene.children).toHaveLength(0)
      expect(mesh.parent).toBe(product)
      expect(product.parent).toBe(scene)
      expect(mesh.geometry).toBe(geometry)
      expect(mesh.material).toBe(material)
      expect(material.map).toBe(map)
      expect(scene.environment).toBe(hdr)
      for (const release of borrowedReleases) expect(release).not.toHaveBeenCalled()
    },
  )

  it('uses the low-level field with explicit 16-longest volume and never installs a lights hook or disposes sources', async () => {
    const f = fixture(),
      releases = [
        vi.spyOn(f.geometry, 'dispose'),
        vi.spyOn(f.material, 'dispose'),
        vi.spyOn(f.hdr, 'dispose'),
      ]
    expect(create.mock.calls[0]![0]).toMatchObject({
      renderer: f.renderer,
      divisions: 16,
      rays: 64,
      cascades: 1,
      reflectionQuality: 'off',
      autoDetectChanges: false,
      roughReflections: false,
      continuous: true,
    })
    expect(create.mock.calls[0]![0].scene).not.toBe(f.scene)
    expect(f.fake.api.setVolumes).toHaveBeenCalledWith([
      expect.objectContaining({ res: new Vector3(16, 9, 10) }),
    ])
    expect(f.fake.api.setRayBudget).toHaveBeenCalledWith(ddgiBudget.maxRaysPerTick)
    await f.adapter.tick()
    await f.adapter.tick()
    expect(f.renderer.lighting.createNode).toBe(f.hook)
    f.adapter.dispose()
    f.adapter.dispose()
    expect(f.fake.api.dispose).toHaveBeenCalledTimes(1)
    for (const release of releases) expect(release).not.toHaveBeenCalled()
  })

  it('waits for an initialized actual solve before exposing irradiance/validity and notifies structural readiness', async () => {
    const f = fixture(),
      depth = texture(new Texture()),
      normal = texture(new Texture()),
      camera = new PerspectiveCamera()
    cleanups.push(() => {
      depth.value.dispose()
      normal.value.dispose()
    })
    expect(f.adapter.createReceiver({ depth, normal, camera })).toBeNull()
    await f.adapter.tick()
    expect(f.adapter.snapshot().ready).toBe(false)
    expect(f.adapter.createReceiver({ depth, normal, camera })).toBeNull()
    await f.adapter.tick()
    const receiver = f.adapter.createReceiver({ depth, normal, camera })
    expect(receiver?.irradiance.isNode).toBe(true)
    expect(receiver?.validity.isNode).toBe(true)
    expect(f.fake.api.node.sampleIrradiance).toHaveBeenCalledOnce()
    expect(f.adapter.snapshot()).toMatchObject({
      ready: true,
      actualRays: 64,
      actualBudgetRays: 98304,
      probes: 1440,
      reflectionQuality: 'off',
      environment: { linearHDR: true, intensity: 0.35 },
    })
    expect(f.onReadyChanged).toHaveBeenCalledTimes(2)
    expect(f.onError).not.toHaveBeenCalled()
  })

  it('resets only upstream frame pacing before every accepted tick and sends real instance/material dirty targets', async () => {
    const f = fixture()
    await f.adapter.tick()
    await f.adapter.tick()
    f.mesh.setMatrixAt(1, new Matrix4().makeTranslation(2, 1, 0))
    f.mesh.instanceMatrix.needsUpdate = true
    f.material.color.set('#779922')
    await f.adapter.tick()
    expect(f.fake.api.resetFramePacing).toHaveBeenCalledTimes(3)
    for (const options of f.fake.tick.mock.calls)
      expect(options[0]).toEqual({ idleMs: 0, playing: false })
    const targets = vi.mocked(f.fake.api.markTransformsDirty).mock.calls[0]![0]
    expect(Array.isArray(targets) && targets[0]).toBeInstanceOf(InstancedMesh)
    expect(f.fake.api.markMaterialValuesDirty).toHaveBeenCalledWith([f.material])
    expect(f.fake.api.setSky).toHaveBeenCalledTimes(1)
    f.scene.environmentIntensity = 0.5
    await f.adapter.tick()
    expect(f.fake.api.setSky).toHaveBeenCalledTimes(2)
  })

  it('forwards finite quiet time while continuous solves and dirty instance/material packets stay live', async () => {
    const f = fixture()
    await f.adapter.tick(200)
    await f.adapter.tick(300)
    f.mesh.setMatrixAt(1, new Matrix4().makeTranslation(1, 0, 0))
    f.mesh.instanceMatrix.needsUpdate = true
    f.material.color.set('#665544')
    await f.adapter.tick(12)
    expect(f.fake.tick).toHaveBeenLastCalledWith({ idleMs: 12, playing: false })
    expect(f.fake.api.markTransformsDirty).toHaveBeenCalledOnce()
    expect(f.fake.api.markMaterialValuesDirty).toHaveBeenCalledWith([f.material])
    expect(create.mock.calls[0]![0].continuous).toBe(true)
    expect(f.adapter.snapshot()).toMatchObject({
      ready: true,
      activity: { idleMs: 12, playing: false, mode: 'merged-activity' },
      actualRays: 64,
      actualBudgetRays: 98304,
    })
    await f.adapter.tick(225)
    expect(f.fake.tick).toHaveBeenLastCalledWith({ idleMs: 225, playing: false })
    // Never enter the upstream playing->rest lane that reduces the fixed budget.
    expect(f.fake.tick.mock.calls.every(([options]) => options?.playing === false)).toBe(true)
    expect(f.fake.api.resetFramePacing).toHaveBeenCalledTimes(4)
  })

  it.each([NaN, Infinity, -Infinity, -20])(
    'treats untrusted quiet time %s as activity rather than permission to rebuild',
    async (idleMs) => {
      const f = fixture()
      await f.adapter.tick(idleMs)
      expect(f.fake.tick).toHaveBeenCalledWith({ idleMs: 0, playing: false })
      expect(f.adapter.snapshot().activity.idleMs).toBe(0)
      expect(f.onError).not.toHaveBeenCalled()
    },
  )

  it('retains a legitimate queued rebuild during motion and accepts its completion after quiet', async () => {
    const f = fixture()
    await f.adapter.tick(250)
    await f.adapter.tick(250)
    f.fake.state.dirty = f.fake.state.buildDirty = true
    f.fake.tick.mockImplementationOnce(async () => {})
    await f.adapter.tick(0)
    expect(f.adapter.snapshot()).toMatchObject({ ready: false, error: null })
    expect(f.fake.tick).toHaveBeenLastCalledWith({ idleMs: 0, playing: false })
    f.fake.tick.mockImplementationOnce(async () => {
      f.fake.state.dirty = f.fake.state.buildDirty = false
      create.mock.calls[0]![0].onRebuilt()
    })
    await f.adapter.tick(250)
    expect(f.adapter.snapshot()).toMatchObject({ ready: true, error: null })
    expect(f.fake.tick).toHaveBeenLastCalledWith({ idleMs: 250, playing: false })
    expect(f.onError).not.toHaveBeenCalled()
  })

  it('coalesces overlapping host ticks and discards a late completion after disposal', async () => {
    const f = fixture()
    let resolve!: () => void
    f.fake.tick.mockImplementationOnce(
      () =>
        new Promise<void>((complete) => {
          resolve = complete
        }),
    )
    const first = f.adapter.tick(),
      second = f.adapter.tick()
    expect(first).toBe(second)
    expect(f.fake.tick).toHaveBeenCalledOnce()
    f.adapter.dispose()
    resolve()
    await first
    expect(f.onReadyChanged).not.toHaveBeenCalled()
    expect(f.adapter.snapshot()).toMatchObject({ ready: false, disposed: true, acceptedTicks: 0 })
    expect(f.fake.api.dispose).toHaveBeenCalledOnce()
  })

  it('lets a new warm-night texture binding rebuild and resume instead of treating dirty as a failure', async () => {
    const f = fixture(),
      map = new Texture()
    cleanups.push(() => map.dispose())
    await f.adapter.tick()
    await f.adapter.tick()
    expect(f.adapter.snapshot().ready).toBe(true)
    f.material.map = map
    f.material.needsUpdate = true
    f.fake.tick.mockImplementationOnce(async () => {
      // Real updateMaterialValues returns null for a changed map binding;
      // refreshMaterialValues requests a fresh build and ends this tick.
      f.fake.state.dirty = f.fake.state.buildDirty = true
    })
    await f.adapter.tick()
    expect(f.fake.api.markMaterialValuesDirty).toHaveBeenCalledWith([f.material])
    expect(f.adapter.snapshot()).toMatchObject({ ready: false, error: null })
    f.fake.tick.mockImplementationOnce(async () => {
      f.fake.state.dirty = f.fake.state.buildDirty = false
      f.fake.state.updatedCount = 0
      f.fake.state.cascadeState[0]!.needsClear = true
      create.mock.calls[0]![0].onRebuilt()
    })
    await f.adapter.tick()
    expect(f.adapter.snapshot()).toMatchObject({ ready: false, error: null })
    await f.adapter.tick()
    expect(f.adapter.snapshot()).toMatchObject({ ready: true, error: null })
    expect(f.onError).not.toHaveBeenCalled()
    expect(f.fake.api.dispose).not.toHaveBeenCalled()
    expect(f.material.map).toBe(map)
  })

  it('allows a lighting refresh to request a cached-kernel rebuild before tick', async () => {
    const f = fixture()
    await f.adapter.tick()
    await f.adapter.tick()
    f.fake.api.forceLightingRefresh = vi.fn(() => {
      f.fake.state.dirty = true
      f.fake.state.buildDirty = false
    })
    f.scene.environmentIntensity = 0.5
    f.fake.tick.mockImplementationOnce(async () => {})
    await f.adapter.tick()
    expect(f.adapter.snapshot()).toMatchObject({ ready: false, error: null })
    expect(f.onError).not.toHaveBeenCalled()
  })

  it('still reports an unsolicited swallowed solve failure after a ready field', async () => {
    const f = fixture()
    await f.adapter.tick()
    await f.adapter.tick()
    f.fake.tick.mockImplementationOnce(async () => {
      f.fake.state.dirty = true
      f.fake.state.buildDirty = false
    })
    await f.adapter.tick()
    expect(f.adapter.snapshot()).toMatchObject({
      ready: false,
      error: expect.stringContaining('rejected'),
    })
    expect(f.onError).toHaveBeenCalledOnce()
  })

  it('fails closed rather than silently lowering the ray budget or probe resolution', async () => {
    const f = fixture()
    await f.adapter.tick()
    await f.adapter.tick()
    f.fake.stats.budgetRays = 2048
    await f.adapter.tick()
    expect(f.adapter.snapshot()).toMatchObject({
      ready: false,
      error: expect.stringContaining('fixed'),
    })
    expect(f.onError).toHaveBeenCalledOnce()
    const calls = f.fake.tick.mock.calls.length
    await f.adapter.tick()
    expect(f.fake.tick).toHaveBeenCalledTimes(calls)
  })

  it('reports swallowed upstream build/solve failure state and exposes no sampler', async () => {
    const f = fixture()
    f.fake.tick.mockImplementationOnce(async () => {
      f.fake.state.rebuildBackoff = 10
    })
    await f.adapter.tick()
    expect(f.adapter.snapshot()).toMatchObject({
      ready: false,
      error: expect.stringContaining('rejected'),
    })
    expect(f.onError).toHaveBeenCalledOnce()
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AmbientLight,
  BoxGeometry,
  Color,
  DataTexture,
  Fog,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  PerspectiveCamera,
  RectAreaLight,
  Scene,
  Texture,
} from 'three'
import type { WebGPURenderer } from 'three/webgpu'
import type { ReventonStage } from '../../reventonStage'
import type { GlbSource } from '../../types'
import { reventonOriginalBundle, reventonRuntimeBundle } from '../../reventonCandidate'
import { coldStudioConfig } from './config'
import { getShowroomEnvironment } from './binding'
import * as geometryModule from './geometry'
import * as lightsModule from './lights'
import { createColdStudioProbe } from './probe'
import { coldStudioRequested, createColdShowroomStage } from './stage'
import { loadShowroomAssets } from './assets'

vi.mock('./probe', () => ({ createColdStudioProbe: vi.fn() }))
vi.mock('./assets', () => ({ loadShowroomAssets: vi.fn() }))

type Probe = Awaited<ReturnType<typeof createColdStudioProbe>>

function probe(role: 'specular' | 'indirect' = 'specular'): Probe {
  const texture = new DataTexture()
  const size = role === 'indirect' ? 256 : 1024
  return {
    texture,
    snapshot: Object.freeze({
      faces: 6 as const,
      role,
      faceResolution: size,
      width: size * 4,
      height: size * 2,
      linearHDR: true as const,
      captureVersion: coldStudioConfig.revision,
      cpuBytes: size * size * 4 * 2 * 16,
      cubeColorBytes: size * size * 6 * 8,
      conversionColorBytes: size * size * 4 * 2 * 16,
    }),
    dispose: vi.fn(() => texture.dispose()),
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept
    reject = fail
  })
  return { promise, resolve, reject }
}

function fixture() {
  const scene = new Scene(),
    model = new Group(),
    camera = new PerspectiveCamera(),
    oldEnvironment = new Texture(),
    oldTrace = new Texture(),
    oldBackground = new Color('#987654'),
    oldFog = new Fog('#123456', 8, 20),
    host = new Group(),
    ambient = new AmbientLight('#ffeedd', 0.2),
    geometry = new BoxGeometry(),
    material = new MeshPhysicalMaterial(),
    car = new Mesh(geometry, material),
    ground = new Group(),
    key = new RectAreaLight(),
    strip = new RectAreaLight(),
    library = new Map<unknown, unknown>(),
    renderer = {
      toneMappingExposure: 1.7,
      library: {
        getLightNodeClass: (type: unknown) => library.get(type),
        addLight: (node: unknown, type: unknown) => library.set(type, node),
      },
    },
    base = {
      prepare: vi.fn(async (signal?: AbortSignal) => {
        signal?.throwIfAborted()
      }),
      markDirty: vi.fn(),
      render: vi.fn(),
      dispose: vi.fn(),
    } satisfies ReventonStage
  model.name = 'actual car excluded from static capture'
  model.add(car)
  host.name = 'workbench-lighting'
  host.add(ambient)
  ground.name = 'workbench-ground'
  key.name = 'Reventon / key softbox'
  strip.name = 'Reventon / reflection strip'
  scene.environment = oldEnvironment
  scene.background = oldBackground
  scene.fog = oldFog
  scene.environmentRotation.set(0.1, 0.2, 0.3)
  scene.environmentIntensity = 1.3
  Object.defineProperty(scene.userData, 'traceBackground', {
    value: oldTrace,
    enumerable: false,
    configurable: true,
    writable: true,
  })
  scene.add(model, host, ground, key, strip)
  const stage = createColdShowroomStage(
    renderer as unknown as WebGPURenderer,
    scene,
    model,
    camera,
    base,
  )
  return {
    scene,
    model,
    car,
    material,
    camera,
    renderer,
    base,
    oldEnvironment,
    oldTrace,
    oldBackground,
    oldFog,
    ambient,
    ground,
    key,
    strip,
    stage,
    dispose() {
      stage.dispose()
      geometry.dispose()
      material.dispose()
      oldEnvironment.dispose()
      oldTrace.dispose()
    },
  }
}

const fixtures: ReturnType<typeof fixture>[] = []
const make = () => {
  const current = fixture()
  fixtures.push(current)
  return current
}

beforeEach(() => {
  vi.mocked(createColdStudioProbe).mockReset()
  const surface = () => ({
    map: new Texture(),
    normalMap: new Texture(),
    roughnessMap: new Texture(),
  })
  vi.mocked(loadShowroomAssets).mockReset().mockResolvedValue({
    floor: surface(),
    wall: surface(),
    dispose: vi.fn(),
  })
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
})
afterEach(() => {
  for (const current of fixtures.splice(0)) current.dispose()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('cold studio audited gate and static scene ownership', () => {
  it('requires the explicit room switch, studio quality and exact audited resource identity', () => {
    const source: GlbSource = {
      kind: 'glb',
      adapter: 'reventon-v1',
      bundle: { ...reventonOriginalBundle },
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 },
      finishMaterials: [],
      explode: [],
    }
    expect(coldStudioRequested({ quality: 'studio', source }, '?carShowroom=cold-studio')).toBe(
      true,
    )
    if (reventonRuntimeBundle)
      expect(
        coldStudioRequested(
          { quality: 'studio', source: { ...source, bundle: { ...reventonRuntimeBundle } } },
          '?carShowroom=cold-studio',
        ),
      ).toBe(true)
    expect(coldStudioRequested({ quality: 'studio', source }, '')).toBe(false)
    expect(coldStudioRequested({ source }, '?carShowroom=cold-studio')).toBe(false)
    expect(coldStudioRequested(undefined, '?carShowroom=cold-studio')).toBe(false)
    for (const overrides of [
      { sha256: '0'.repeat(64) },
      { manifest: '/other.glb' },
      { version: 99 },
      { id: 'administrator-copy' },
    ])
      expect(
        coldStudioRequested(
          { quality: 'studio', source: { ...source, bundle: { ...source.bundle, ...overrides } } },
          '?carShowroom=cold-studio',
        ),
      ).toBe(false)
    expect(
      coldStudioRequested(
        { quality: 'studio', source: { ...source, adapter: 'pbr-v1' } },
        '?carShowroom=cold-studio',
      ),
    ).toBe(false)
  })

  it('captures room-only radiance followed by independently lit panels-black indirect light', async () => {
    const full = probe(),
      indirect = probe('indirect'),
      calls: { scene: Scene; panels: number[]; carPresent: boolean }[] = []
    vi.mocked(createColdStudioProbe).mockImplementation(
      async (_renderer, scene, _config, _signal, options) => {
        const panels: number[] = []
        let carPresent = false
        scene.traverse((node) => {
          if (node.name === 'actual car excluded from static capture') carPresent = true
          if (
            node instanceof Mesh &&
            node.userData.showroomLightId &&
            node.material instanceof MeshBasicMaterial
          )
            panels.push(node.material.color.r)
        })
        calls.push({ scene, panels, carPresent })
        return options?.role === 'indirect' ? indirect : full
      },
    )
    const f = make(),
      originalMaterial = f.car.material
    await f.stage.prepare()
    expect(calls).toHaveLength(2)
    expect(calls[0]!.scene).toBe(calls[1]!.scene)
    expect(calls.every((entry) => !entry.carPresent)).toBe(true)
    expect(calls[0]!.panels).toHaveLength(4)
    expect(calls[0]!.panels.every((value) => value > 1)).toBe(true)
    expect(calls[1]!.panels).toEqual([0, 0, 0, 0])
    expect(calls[0]!.scene.children).toHaveLength(0)
    expect(f.scene.environment).toBe(full.texture)
    expect(f.scene.userData.traceBackground).toBe(indirect.texture)
    expect(f.car.material).toBe(originalMaterial)
    expect(f.material.envMap).toBeNull()
    expect(getShowroomEnvironment(f.scene)).toMatchObject({
      texture: full.texture,
      irradiance: indirect.texture,
      config: coldStudioConfig,
    })
    expect(getShowroomEnvironment(new Scene())).toBeUndefined()
    expect(f.model.userData.carShowroom).toMatchObject({
      phase: 'ready',
      error: null,
      probe: { captures: 6, resolution: 1024, totalFaceDraws: 12 },
    })
    await f.stage.prepare()
    expect(createColdStudioProbe).toHaveBeenCalledTimes(2)
    expect(f.base.prepare).toHaveBeenCalledOnce()
    f.stage.render()
    f.stage.markDirty()
    expect(createColdStudioProbe).toHaveBeenCalledTimes(2)
    expect(f.base.render).toHaveBeenCalledOnce()
    expect(f.base.markDirty).toHaveBeenCalledOnce()
    f.stage.dispose()
    f.stage.dispose()
    expect(full.dispose).toHaveBeenCalledOnce()
    expect(indirect.dispose).toHaveBeenCalledOnce()
    expect(f.base.dispose).toHaveBeenCalledOnce()
    expect(getShowroomEnvironment(f.scene)).toBeUndefined()
  })

  it('restores host environment, trace descriptor, lighting, background, ground and exposure', async () => {
    const full = probe(),
      indirect = probe('indirect')
    vi.mocked(createColdStudioProbe).mockResolvedValueOnce(full).mockResolvedValueOnce(indirect)
    const f = make()
    expect(f.ambient.intensity).toBe(0)
    expect(f.ground.visible).toBe(false)
    expect(f.scene.fog).toBeNull()
    expect(f.key.position.toArray()).toEqual(coldStudioConfig.lights.key.position)
    expect(f.strip.position.toArray()).toEqual(coldStudioConfig.lights.strip.position)
    await f.stage.prepare()
    f.stage.dispose()
    expect(f.scene.environment).toBe(f.oldEnvironment)
    expect(f.scene.userData.traceBackground).toBe(f.oldTrace)
    expect(Object.getOwnPropertyDescriptor(f.scene.userData, 'traceBackground')?.enumerable).toBe(
      false,
    )
    expect(f.scene.background).toBe(f.oldBackground)
    expect(f.scene.fog).toBe(f.oldFog)
    expect(f.scene.environmentRotation.toArray()).toEqual([0.1, 0.2, 0.3, 'XYZ'])
    expect(f.scene.environmentIntensity).toBe(1.3)
    expect(f.renderer.toneMappingExposure).toBe(1.7)
    expect(f.ambient.intensity).toBe(0.2)
    expect(f.ground.visible).toBe(true)
    expect(f.scene.getObjectByName('Trees X / cold studio')).toBeUndefined()
    expect(f.model.userData.carShowroom).toBeUndefined()
  })

  it('keeps the old EXR and operable base stage if either capture fails', async () => {
    const f = make(),
      full = probe(),
      warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(createColdStudioProbe)
      .mockResolvedValueOnce(full)
      .mockRejectedValueOnce(new Error('indirect readback failed'))
    await expect(f.stage.prepare()).resolves.toBeUndefined()
    expect(f.scene.environment).toBe(f.oldEnvironment)
    expect(f.scene.userData.traceBackground).toBe(f.oldTrace)
    expect(getShowroomEnvironment(f.scene)).toBeUndefined()
    expect(f.model.userData.carShowroom).toMatchObject({
      phase: 'error',
      error: 'indirect readback failed',
    })
    expect(full.dispose).toHaveBeenCalledOnce()
    expect(warning).toHaveBeenCalledOnce()
    expect(f.base.prepare).toHaveBeenCalledOnce()
    f.stage.render()
    expect(f.base.render).toHaveBeenCalledOnce()
    f.stage.dispose()
    expect(full.dispose).toHaveBeenCalledOnce()
  })

  it('keeps the old environment when the initial radiance capture itself fails', async () => {
    vi.mocked(createColdStudioProbe).mockRejectedValueOnce(new Error('initial capture failed'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const f = make()
    await expect(f.stage.prepare()).resolves.toBeUndefined()
    expect(f.model.userData.carShowroom).toMatchObject({
      phase: 'error',
      error: 'initial capture failed',
    })
    expect(f.scene.environment).toBe(f.oldEnvironment)
    expect(f.scene.userData.traceBackground).toBe(f.oldTrace)
    expect(createColdStudioProbe).toHaveBeenCalledOnce()
    expect(f.base.prepare).toHaveBeenCalledOnce()
    expect(getShowroomEnvironment(f.scene)).toBeUndefined()
  })

  it.each([1, 2])(
    'cleans partially authored capture resources when area light %s registration throws',
    async (failureAt) => {
      const f = make(),
        roomFactory = geometryModule.createColdStudioGeometry,
        capturedRooms: ReturnType<typeof geometryModule.createColdStudioGeometry>[] = [],
        partialLights: RectAreaLight[] = [],
        releases: { count: number }[] = []
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      vi.spyOn(geometryModule, 'createColdStudioGeometry').mockImplementation((config) => {
        const room = roomFactory(config)
        vi.spyOn(room, 'dispose')
        capturedRooms.push(room)
        return room
      })
      let call = 0
      vi.spyOn(lightsModule, 'createShowroomAreaLight').mockImplementation(() => {
        call++
        if (call === failureAt) throw new Error('area light library rejected')
        const light = new RectAreaLight(),
          release = { count: 0 }
        light.addEventListener('dispose', () => {
          release.count++
        })
        releases.push(release)
        partialLights.push(light)
        return light
      })
      const oldRelease = vi.spyOn(f.oldEnvironment, 'dispose')
      await expect(f.stage.prepare()).resolves.toBeUndefined()
      expect(f.model.userData.carShowroom).toMatchObject({
        phase: 'error',
        error: 'area light library rejected',
      })
      expect(createColdStudioProbe).not.toHaveBeenCalled()
      expect(capturedRooms).toHaveLength(1)
      expect(capturedRooms[0]!.dispose).toHaveBeenCalledOnce()
      expect(capturedRooms[0]!.root.children).toHaveLength(0)
      expect(partialLights).toHaveLength(failureAt - 1)
      for (const release of releases) expect(release.count).toBe(1)
      expect(f.scene.environment).toBe(f.oldEnvironment)
      expect(f.scene.userData.traceBackground).toBe(f.oldTrace)
      expect(getShowroomEnvironment(f.scene)).toBeUndefined()
      expect(oldRelease).not.toHaveBeenCalled()
      expect(f.base.prepare).toHaveBeenCalledOnce()
      // A stuck `preparing` guard would retain the room and skip base cleanup.
      f.stage.dispose()
      f.stage.dispose()
      expect(f.scene.getObjectByName('Trees X / cold studio')).toBeUndefined()
      expect(f.base.dispose).toHaveBeenCalledOnce()
      expect(f.model.userData.carShowroom).toBeUndefined()
      expect(oldRelease).not.toHaveBeenCalled()
      for (const release of releases) expect(release.count).toBe(1)
    },
  )

  it('a disposed stage never publishes successfully completed late probe owners', async () => {
    const pending = deferred<Probe>(),
      full = probe()
    vi.mocked(createColdStudioProbe).mockReturnValueOnce(pending.promise)
    const f = make(),
      preparing = f.stage.prepare(),
      failure = expect(preparing).rejects.toThrow()
    await vi.waitFor(() => expect(createColdStudioProbe).toHaveBeenCalledOnce())
    const captureRoom = vi.mocked(createColdStudioProbe).mock.calls[0]![1].children[0]!
    f.stage.dispose()
    expect(captureRoom.children.length).toBeGreaterThan(0)
    expect(f.base.dispose).not.toHaveBeenCalled()
    pending.resolve(full)
    await failure
    expect(captureRoom.children).toHaveLength(0)
    expect(full.dispose).toHaveBeenCalledOnce()
    expect(createColdStudioProbe).toHaveBeenCalledOnce()
    expect(f.base.dispose).toHaveBeenCalledOnce()
    expect(f.base.prepare).not.toHaveBeenCalled()
    expect(f.scene.environment).toBe(f.oldEnvironment)
    expect(f.scene.userData.traceBackground).toBe(f.oldTrace)
    expect(getShowroomEnvironment(f.scene)).toBeUndefined()
    expect(f.model.userData.carShowroom).toBeUndefined()
  })

  it('retains installed probe and stage resources until pending base preparation settles', async () => {
    const full = probe(),
      indirect = probe('indirect'),
      pending = deferred<void>()
    vi.mocked(createColdStudioProbe).mockResolvedValueOnce(full).mockResolvedValueOnce(indirect)
    const f = make()
    f.base.prepare.mockImplementation(() => pending.promise)
    const preparing = f.stage.prepare(),
      failure = expect(preparing).rejects.toThrow()
    await vi.waitFor(() => expect(f.base.prepare).toHaveBeenCalledOnce())
    const mainRoom = f.scene.getObjectByName('Trees X / cold studio')!
    f.stage.dispose()
    expect(full.dispose).not.toHaveBeenCalled()
    expect(indirect.dispose).not.toHaveBeenCalled()
    expect(f.base.dispose).not.toHaveBeenCalled()
    expect(mainRoom.parent).toBe(f.scene)
    expect(f.scene.environment).toBe(full.texture)
    pending.resolve(undefined)
    await failure
    expect(full.dispose).toHaveBeenCalledOnce()
    expect(indirect.dispose).toHaveBeenCalledOnce()
    expect(f.base.dispose).toHaveBeenCalledOnce()
    expect(mainRoom.parent).toBeNull()
    expect(f.scene.environment).toBe(f.oldEnvironment)
    expect(getShowroomEnvironment(f.scene)).toBeUndefined()
  })

  it('cancellation never publishes a late capture or frees its room before settlement', async () => {
    const pending = deferred<Probe>(),
      abort = new AbortController(),
      full = probe()
    let captureRoom: Group | undefined
    vi.mocked(createColdStudioProbe).mockImplementation(
      async (_renderer, scene, _config, signal) => {
        captureRoom = scene.children.find((child) => child instanceof Group) as Group | undefined
        const result = await pending.promise
        signal?.throwIfAborted()
        return result
      },
    )
    const f = make(),
      preparing = f.stage.prepare(abort.signal)
    const failure = expect(preparing).rejects.toThrow()
    await vi.waitFor(() => expect(createColdStudioProbe).toHaveBeenCalledOnce())
    expect(captureRoom?.children.length).toBeGreaterThan(0)
    abort.abort()
    f.stage.dispose()
    expect(f.base.dispose).not.toHaveBeenCalled()
    expect(captureRoom?.children.length).toBeGreaterThan(0)
    pending.resolve(full)
    await failure
    // A real rejected probe owns its returned/unpublished texture; the mocked
    // implementation deliberately never returned `full`, so release it here.
    full.dispose()
    expect(captureRoom?.children).toHaveLength(0)
    expect(f.scene.environment).toBe(f.oldEnvironment)
    expect(f.base.dispose).toHaveBeenCalledOnce()
    expect(f.model.userData.carShowroom).toBeUndefined()
    expect(createColdStudioProbe).toHaveBeenCalledOnce()
    expect(f.base.prepare).not.toHaveBeenCalled()
  })

  it('rejects an already canceled preparation without capture and preserves borrowed textures', async () => {
    const f = make(),
      abort = new AbortController(),
      oldRelease = vi.spyOn(f.oldEnvironment, 'dispose'),
      traceRelease = vi.spyOn(f.oldTrace, 'dispose')
    abort.abort()
    await expect(f.stage.prepare(abort.signal)).rejects.toThrow()
    expect(createColdStudioProbe).not.toHaveBeenCalled()
    f.stage.dispose()
    expect(oldRelease).not.toHaveBeenCalled()
    expect(traceRelease).not.toHaveBeenCalled()
  })
})

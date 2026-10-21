// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, ref, shallowRef, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import {
  BoxGeometry,
  DataTexture,
  EquirectangularReflectionMapping,
  FloatType,
  Group,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  RGBAFormat,
  Scene,
  Texture,
  Vector2,
  Vector3,
} from 'three'
import { float, texture, uniform, vec3 } from 'three/tsl'
import type { createProbeField, SpeedballField, SpeedballState, SpeedballStats } from 'speedball-gi'
import { useWorkbenchScene } from './useWorkbenchScene'
import { parseProduct } from '@/lib/workbench/api'
import type { WorkbenchProduct } from '@/lib/workbench/types'
import { useWorkbenchStore } from '@/stores/workbench'
import { retirePreparedRenderer } from '@/lib/workbench/rendering/preparationLease'

function deferred() {
  let resolve!: () => void, reject!: (error: Error) => void
  const promise = new Promise<void>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

const mocks = vi.hoisted(() => ({
  runtime: undefined as ReturnType<typeof runtime> | undefined,
  controllers: [] as ReturnType<typeof controller>[],
  fields: [] as ReturnType<typeof strictField>[],
  activeField: undefined as SpeedballField | undefined,
  events: [] as string[],
  createField: vi.fn<typeof createProbeField>(),
}))

vi.mock('@tresjs/core', () => ({
  useTres: () => mocks.runtime,
  useTresContext: () => mocks.runtime!.context,
  useLoop: () => mocks.runtime!.loop,
}))
vi.mock('speedball-gi', () => ({ createProbeField: mocks.createField }))
vi.mock('@/lib/workbench/controller', () => ({
  createStageController: () => {
    const owned = controller()
    mocks.controllers.push(owned)
    return owned
  },
}))
vi.mock('@/lib/workbench/rendering/environment', () => ({
  createBaseEnvironment: async () => {
    const image = new DataTexture(new Float32Array(16).fill(1), 2, 2, RGBAFormat, FloatType)
    image.mapping = EquirectangularReflectionMapping
    return { texture: image, dispose: () => image.dispose() }
  },
}))
vi.mock('@/lib/workbench/rendering/realtime/geometryOwnership', () => ({
  ownGeometryAttributes: () => ({ dispose: vi.fn() }),
}))
vi.mock('@/lib/workbench/rendering/realtime/clock', () => ({
  createRealtimeClock: () => ({
    frame: (draw: () => void) => draw(),
    pause: vi.fn(),
    resume: vi.fn(),
    dispose: vi.fn(),
  }),
}))
vi.mock('@/lib/workbench/rendering/realtime/motion', () => ({
  createMotionHistory: () => ({
    node: float(0),
    reset: vi.fn(),
    beginFrame: vi.fn(),
    commitFrame: vi.fn(),
    cancelFrame: vi.fn(),
    stats: () => ({ objects: 1, instances: 0, historyBytes: 64, frameOpen: false }),
    dispose: vi.fn(),
  }),
}))
vi.mock('@/lib/workbench/rendering/realtime/materials', () => ({
  createRealtimeMaterials: () => ({
    install: vi.fn(),
    sync: vi.fn(),
    restore: vi.fn(),
    stats: () => ({ supported: 1 }),
  }),
}))
vi.mock('@/lib/workbench/rendering/realtime/signals', () => ({
  createRealtimeSignals: (_renderer: unknown, _scene: Scene, camera: PerspectiveCamera) => {
    const image = new Texture(),
      input = texture(image)
    return {
      prepare: async (signal?: AbortSignal) => {
        signal?.throwIfAborted()
        await mocks.runtime!.renderer.compileAsync()
      },
      render: vi.fn(),
      commitFrame: vi.fn(),
      cancelFrame: vi.fn(),
      resetHistory: vi.fn(),
      environment: vi.fn(),
      setSignals: vi.fn(),
      setProfile: vi.fn(),
      snapshot: () => ({ ssr: true, ssgi: true, denoise: true }),
      sampling: () => null,
      ddgiInputs: () => ({ depth: input, normal: input, camera }),
      setWorldGi: vi.fn(),
      dispose: () => image.dispose(),
    }
  },
}))
vi.mock('@/lib/workbench/cameraCapture', () => ({ useCameraCaptureSession: () => undefined }))
vi.mock('@/lib/workbench/motionSession', () => ({
  useMotionSession: () => ({ report: vi.fn(), snapshot: () => ({}) }),
}))
vi.mock('@/lib/workbench/viewportFraming', () => ({
  createViewportFraming: () => ({ update: vi.fn(), finish: vi.fn(), dispose: vi.fn() }),
}))

function strictField(options: Parameters<typeof createProbeField>[0]) {
  if (mocks.activeField) throw new Error('strict low-level singleton is still occupied')
  const id = mocks.fields.length + 1,
    native = deferred(),
    stats: SpeedballStats = {
      probes: 0,
      res: new Vector3(),
      atlas: [1, 1],
      rays: 64,
      active: true,
      reflectionQuality: 'off',
      cascades: 1,
      budgetRays: 98304,
    },
    state: SpeedballState = {
      dirty: false,
      buildDirty: false,
      buildStage: 2,
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
      cascadeState: [{ needsClear: false }],
    }
  const api: SpeedballField = {
    node: {
      active: true,
      cacheToken: `field-${id}`,
      normalBiasNode: [{ value: 0.02 }],
      sampleBiasScaleNode: { value: 1 },
      intensityNode: uniform(1),
      enabledNode: uniform(1),
      sampleIrradiance: () => vec3(0.4),
    },
    tick: vi.fn(async () => {
      mocks.events.push(`tick:${id}`)
      await native.promise
      state.updatedCount = stats.probes
      options.onRebuilt()
    }),
    resetFramePacing: vi.fn(),
    setEnabled: vi.fn(),
    setRayBudget: vi.fn(),
    setVolumes: (volumes) => {
      stats.res.copy(volumes[0]!.res)
      stats.probes = stats.res.x * stats.res.y * stats.res.z
    },
    setSky: vi.fn(),
    setSkyIntensity: vi.fn(),
    markTransformsDirty: vi.fn(),
    markMaterialValuesDirty: vi.fn(),
    markTopologyDirty: vi.fn(),
    forceLightingRefresh: vi.fn(),
    isSupported: () => true,
    hasData: () => state.updatedCount > 0,
    getStats: () => stats,
    _debugState: () => state,
    dispose: vi.fn(() => {
      expect(mocks.activeField).toBe(api)
      mocks.events.push(`dispose:${id}`)
      mocks.activeField = undefined
    }),
  }
  mocks.activeField = api
  mocks.events.push(`create:${id}`)
  const owned = { api, native, proxy: options.scene }
  mocks.fields.push(owned)
  return owned
}

function runtime() {
  const scene = shallowRef(new Scene()),
    camera = shallowRef(new PerspectiveCamera()),
    listeners = new Set<() => void>(),
    isActive = ref(true)
  const renderer = {
    isWebGPURenderer: true,
    backend: { isWebGPUBackend: true },
    toneMappingExposure: 1,
    domElement: document.createElement('canvas'),
    init: vi.fn(async () => {}),
    compileAsync: vi.fn(async () => {}),
    getDrawingBufferSize: (size: Vector2) => size.set(1440, 1000),
    onError: vi.fn(),
    render: vi.fn(),
    dispose: vi.fn(),
  }
  let draw: (notify: () => void) => void = (notify) => notify()
  return {
    scene,
    camera,
    renderer,
    context: {
      renderer: {
        instance: renderer,
        isInitialized: ref(true),
        onRender: (callback: () => void) => {
          listeners.add(callback)
          return { off: () => listeners.delete(callback) }
        },
        onReady: () => ({ off: vi.fn() }),
        replaceRenderFunction: (callback: typeof draw) => {
          draw = callback
        },
      },
    },
    sizes: { width: ref(1440), height: ref(1000) },
    invalidate: vi.fn(),
    loop: {
      isActive,
      start: () => (isActive.value = true),
      stop: () => (isActive.value = false),
      onBeforeRender: vi.fn(),
    },
    present: () => draw(() => [...listeners].forEach((callback) => callback())),
  }
}

function controller() {
  const sources: { root: Group; geometry: BoxGeometry; material: MeshStandardMaterial }[] = []
  let current: (typeof sources)[number] | undefined
  const unload = vi.fn(() => {
    if (!current) return
    current.root.removeFromParent()
    current.geometry.dispose()
    current.material.dispose()
    current = undefined
  })
  return {
    sources,
    load: vi.fn(async (product: WorkbenchProduct) => {
      const root = new Group(),
        geometry = new BoxGeometry(),
        material = new MeshStandardMaterial()
      root.name = product.slug
      root.userData.workbenchProduct = 'typewriter-study'
      root.add(new Mesh(geometry, material))
      current = { root, geometry, material }
      sources.push(current)
      mocks.runtime!.scene.value.add(root)
      return current
    }),
    unload,
    cancelLoading: vi.fn(),
    dispose: unload,
    sync: vi.fn(),
    enableInteraction: vi.fn(),
    setActive: vi.fn(),
    beforeRender: vi.fn(),
    command: vi.fn(),
    pauseObservation: vi.fn(),
    motionCommand: vi.fn(),
    resetMotion: vi.fn(),
    pulse: vi.fn(),
    project: vi.fn(),
    restoreCamera: vi.fn(),
    restoreSelection: vi.fn(),
    snapshotCamera: vi.fn(),
  }
}

const samples: unknown[] = JSON.parse(
  readFileSync('server/src/main/resources/samples/products.json', 'utf8'),
)
let app: App | undefined, sceneOwner: ReturnType<typeof useWorkbenchScene> | undefined
function mount() {
  app = createApp(
    defineComponent({
      setup() {
        sceneOwner = useWorkbenchScene(
          { active: true, place: vi.fn(), commit: vi.fn(), realtimePipeline: true },
          vi.fn(),
          vi.fn(),
        )
        return () => h('div')
      },
    }),
  )
  app.mount(document.createElement('div'))
}
async function firstFrame(count = 1) {
  await vi.waitFor(() => expect(mocks.runtime!.renderer.compileAsync).toHaveBeenCalledTimes(count))
  await vi.dynamicImportSettled()
  mocks.runtime!.present()
  await nextTick()
  expect(useWorkbenchStore().available).toBe(true)
  expect(sceneOwner!.realLighting.snapshot()?.preparation?.sceneInputs).toBe(true)
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.stubGlobal('location', { search: '?indirectLighting=ddgi' })
  mocks.runtime = runtime()
  mocks.controllers = []
  mocks.fields = []
  mocks.activeField = undefined
  mocks.events = []
  mocks.createField.mockReset().mockImplementation((options) => strictField(options).api)
  useWorkbenchStore().preview(parseProduct(samples[0]))
})
afterEach(async () => {
  for (const field of mocks.fields) field.native.resolve()
  await vi.dynamicImportSettled()
  app?.unmount()
  app = undefined
  useWorkbenchStore().dispose()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('real scene handoff with leased DDGI singleton disposal', () => {
  it('physically frees the previous low-level field before a same-host retry constructs its successor', async () => {
    mount()
    await firstFrame()
    expect(mocks.fields).toHaveLength(1)
    const compilation = deferred()
    mocks.runtime!.renderer.compileAsync.mockImplementationOnce(() => compilation.promise)
    await useWorkbenchStore().retry()
    await vi.waitFor(() => expect(mocks.runtime!.renderer.compileAsync).toHaveBeenCalledTimes(2))
    await vi.dynamicImportSettled()
    try {
      // Keep the actual successor lease alive while the dynamic field import
      // settles. An immediate compile mock could hide the old disposal bug.
      expect(mocks.createField).toHaveBeenCalledTimes(2)
      expect(mocks.events).toEqual(['create:1', 'dispose:1', 'create:2'])
      expect(sceneOwner!.realLighting.snapshot()?.indirectLighting?.error).toBeNull()
    } finally {
      compilation.resolve()
    }
    await firstFrame(2)
    expect(mocks.createField).toHaveBeenCalledTimes(2)
    expect(mocks.events).toEqual(['create:1', 'dispose:1', 'create:2'])
    expect(mocks.fields[0]!.api.dispose).toHaveBeenCalledOnce()
    expect(mocks.fields[0]!.proxy.children).toHaveLength(0)
    expect(sceneOwner!.realLighting.snapshot()?.indirectLighting?.error).toBeNull()
    expect(mocks.runtime!.renderer.dispose).not.toHaveBeenCalled()
  })

  it.each(['resolve', 'reject'] as const)(
    'waits outside the next lease for an old native tick to %s and skips an overtaken selection',
    async (outcome) => {
      mount()
      await firstFrame()
      const host = mocks.runtime!,
        store = useWorkbenchStore(),
        first = mocks.fields[0]!,
        source = mocks.controllers[0]!.sources[0]!,
        geometryDisposed = vi.spyOn(source.geometry, 'dispose'),
        materialDisposed = vi.spyOn(source.material, 'dispose')
      host.present()
      expect(first.api.tick).toHaveBeenCalledOnce()
      store.preview(parseProduct(samples[1]))
      await nextTick()
      const latest = parseProduct(samples[2])
      store.preview(latest)
      await nextTick()
      expect(mocks.createField).toHaveBeenCalledOnce()
      expect(first.api.dispose).not.toHaveBeenCalled()
      expect(geometryDisposed).not.toHaveBeenCalled()
      expect(materialDisposed).not.toHaveBeenCalled()
      expect(source.root.parent).toBe(host.scene.value)
      if (outcome === 'resolve') first.native.resolve()
      else first.native.reject(new Error('old native tick rejected'))
      await firstFrame(2)
      expect(mocks.controllers[0]!.load).toHaveBeenCalledTimes(2)
      expect(mocks.controllers[0]!.load.mock.lastCall?.[0]).toEqual(latest)
      expect(mocks.createField).toHaveBeenCalledTimes(2)
      expect(mocks.events).toEqual(['create:1', 'tick:1', 'dispose:1', 'create:2'])
      expect(geometryDisposed).toHaveBeenCalledOnce()
      expect(materialDisposed).toHaveBeenCalledOnce()
      expect(sceneOwner!.realLighting.snapshot()?.indirectLighting?.error).toBeNull()
      expect(host.renderer.dispose).not.toHaveBeenCalled()
    },
  )

  it('reports failed old-owner disposal without constructing a successor inside the failing handoff', async () => {
    mount()
    await firstFrame()
    const store = useWorkbenchStore(),
      first = mocks.fields[0]!,
      dispose = vi.mocked(first.api.dispose),
      release = dispose.getMockImplementation()!
    dispose.mockImplementationOnce(() => {
      release()
      throw new Error('native field cleanup failed')
    })
    await store.retry()
    await vi.waitFor(() => expect(store.status).toBe('error'))
    expect(mocks.createField).toHaveBeenCalledOnce()
    expect(dispose).toHaveBeenCalledOnce()
    expect(first.proxy.children).toHaveLength(0)
    expect(mocks.activeField).toBeUndefined()
    expect(store.error).toContain('资源清理失败')
    expect(mocks.runtime!.renderer.dispose).not.toHaveBeenCalled()
    await store.retry()
    await firstFrame(2)
    expect(mocks.createField).toHaveBeenCalledTimes(2)
    expect(sceneOwner!.realLighting.snapshot()?.indirectLighting?.error).toBeNull()
  })

  it('defers the actual field, borrowed source and renderer disposal until an unmounted native tick settles', async () => {
    mount()
    await firstFrame()
    const host = mocks.runtime!,
      first = mocks.fields[0]!,
      source = mocks.controllers[0]!.sources[0]!,
      geometryDisposed = vi.spyOn(source.geometry, 'dispose')
    host.present()
    expect(first.api.tick).toHaveBeenCalledOnce()
    app!.unmount()
    app = undefined
    retirePreparedRenderer(host.renderer, host.renderer.dispose)
    expect(first.api.dispose).not.toHaveBeenCalled()
    expect(geometryDisposed).not.toHaveBeenCalled()
    expect(host.renderer.dispose).not.toHaveBeenCalled()
    first.native.resolve()
    await vi.waitFor(() => expect(host.renderer.dispose).toHaveBeenCalledOnce())
    expect(first.api.dispose).toHaveBeenCalledOnce()
    expect(geometryDisposed).toHaveBeenCalledOnce()
    expect(first.proxy.children).toHaveLength(0)
    expect(mocks.createField).toHaveBeenCalledOnce()
    expect(mocks.activeField).toBeUndefined()
  })
})

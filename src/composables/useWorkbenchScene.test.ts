// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, reactive, ref, shallowRef, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { PerspectiveCamera, Scene, Texture } from 'three'
import { useWorkbenchScene, type WorkbenchSceneProps } from './useWorkbenchScene'
import { useWorkbenchStore } from '@/stores/workbench'
import { parseProduct } from '@/lib/workbench/api'
import type { WorkbenchProduct } from '@/lib/workbench/types'
import type { LoadPhase } from '@/lib/workbench/assetBundle'
import type { OwnedEnvironment } from '@/lib/workbench/rendering/environment'
import type {
  HybridCoordinatorOptions,
  RefinementStatus,
} from '@/lib/workbench/rendering/refinementTypes'

type Listener = () => void
function hook() {
  const listeners = new Set<Listener>()
  return {
    listeners,
    on(callback: Listener) {
      listeners.add(callback)
      return { off: vi.fn(() => listeners.delete(callback)) }
    },
    trigger() {
      for (const callback of [...listeners]) callback()
    },
  }
}
function controller() {
  return {
    load: vi
      .fn<(product: WorkbenchProduct, phase: (value: LoadPhase) => void) => Promise<object>>()
      .mockResolvedValue({}),
    unload: vi.fn(),
    dispose: vi.fn(),
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
function coordinator(options: HybridCoordinatorOptions) {
  const status: RefinementStatus = {
    phase: 'raster',
    slug: null,
    revision: 0,
    generation: 0,
    samples: null,
    target: 128,
    realtime: false,
    error: null,
  }
  let firstRasterMs: number | null = null
  return {
    options,
    render: vi.fn((notify: Listener) => {
      options.beforeRaster()
      firstRasterMs = 1
      notify()
    }),
    invalidate: vi.fn(() => options.invalidate()),
    unload: vi.fn(),
    dispose: vi.fn(),
    ready: vi.fn((slug: string, revision: number) => {
      Object.assign(status, { slug, revision, phase: 'waiting' })
      options.report({ ...status })
    }),
    setActive: vi.fn(),
    setInteracting: vi.fn(),
    refine: vi.fn(),
    setRealtime: vi.fn(),
    retry: vi.fn(),
    snapshot: vi.fn(() => ({ ...status, firstRasterMs })),
  }
}
function environment() {
  const texture = new Texture()
  return { texture, dispose: vi.fn(() => texture.dispose()) }
}
function runtime() {
  const scene = shallowRef(new Scene()),
    camera = shallowRef(new PerspectiveCamera()),
    render = hook(),
    ready = hook(),
    isActive = ref(true)
  const renderer = {
    isWebGPURenderer: true,
    toneMappingExposure: 1,
    domElement: document.createElement('canvas'),
    init: vi.fn(async () => {}),
    compileAsync: vi.fn(async () => {}),
    render: vi.fn(),
    dispose: vi.fn(),
  }
  let draw: (notify: Listener) => void = (notify) => notify()
  const context = {
    renderer: {
      instance: renderer,
      isInitialized: ref(true),
      onRender: render.on,
      onReady: ready.on,
      replaceRenderFunction: vi.fn((callback: (notify: Listener) => void) => {
        draw = callback
      }),
    },
  }
  return {
    scene,
    camera,
    renderer,
    context,
    render,
    ready,
    sizes: { width: ref(1440), height: ref(1000) },
    invalidate: vi.fn(),
    loop: {
      isActive,
      start: vi.fn(() => {
        isActive.value = true
      }),
      stop: vi.fn(() => {
        isActive.value = false
      }),
      onBeforeRender: vi.fn(),
    },
    present: () => draw(render.trigger),
    draw: (notify: Listener) => draw(notify),
  }
}
const mocks = vi.hoisted(() => ({
  runtime: undefined as ReturnType<typeof runtime> | undefined,
  controllers: [] as ReturnType<typeof controller>[],
  coordinators: [] as ReturnType<typeof coordinator>[],
  environments: [] as ReturnType<typeof environment>[],
  createEnvironment: vi.fn<(renderer: unknown, signal: AbortSignal) => Promise<OwnedEnvironment>>(),
  registerCapture: vi.fn<() => Listener>(),
  unregisterCapture: vi.fn(),
}))
vi.mock('@tresjs/core', () => ({
  useTres: () => mocks.runtime,
  useTresContext: () => mocks.runtime!.context,
  useLoop: () => mocks.runtime!.loop,
}))
vi.mock('@/lib/workbench/controller', () => ({
  createStageController: () => {
    const value = controller()
    mocks.controllers.push(value)
    return value
  },
}))
vi.mock('@/lib/workbench/rendering/environment', () => ({
  createBaseEnvironment: (renderer: unknown, signal: AbortSignal) =>
    mocks.createEnvironment(renderer, signal),
}))
vi.mock('@/lib/workbench/rendering/coordinator', () => ({
  createHybridCoordinator: (options: HybridCoordinatorOptions) => {
    const value = coordinator(options)
    mocks.coordinators.push(value)
    return value
  },
}))
vi.mock('@/lib/workbench/cameraCapture', () => ({
  useCameraCaptureSession: () => ({ register: mocks.registerCapture }),
}))
vi.mock('@/lib/workbench/motionSession', () => ({
  useMotionSession: () => ({ report: vi.fn(), snapshot: () => ({}) }),
}))
vi.mock('@/lib/workbench/viewportFraming', () => ({
  createViewportFraming: () => ({ update: vi.fn(), finish: vi.fn(), dispose: vi.fn() }),
}))

const samples: unknown[] = JSON.parse(
  readFileSync('server/src/main/resources/samples/products.json', 'utf8'),
)
let app: App | undefined
function mount() {
  const props = reactive<WorkbenchSceneProps>({ active: true, place: vi.fn(), commit: vi.fn() })
  app = createApp(
    defineComponent({
      setup() {
        useWorkbenchScene(props, vi.fn(), vi.fn())
        return () => h('div')
      },
    }),
  )
  app.mount(document.createElement('div'))
  return props
}
async function awaitFrame() {
  await vi.waitFor(() => expect(mocks.runtime!.renderer.compileAsync).toHaveBeenCalled())
  // Loading and compile success alone must not open interaction.
  expect(useWorkbenchStore().available).toBe(false)
  mocks.runtime!.present()
  await nextTick()
  expect(useWorkbenchStore().available).toBe(true)
}
beforeEach(() => {
  setActivePinia(createPinia())
  mocks.runtime = runtime()
  mocks.controllers = []
  mocks.coordinators = []
  mocks.environments = []
  mocks.createEnvironment.mockReset().mockImplementation(async () => {
    const value = environment()
    mocks.environments.push(value)
    return value
  })
  mocks.unregisterCapture.mockReset()
  mocks.registerCapture.mockReset().mockReturnValue(mocks.unregisterCapture)
  useWorkbenchStore().preview(parseProduct(samples[0]))
})
afterEach(() => {
  app?.unmount()
  app = undefined
  useWorkbenchStore().dispose()
  vi.restoreAllMocks()
})

describe('shared workbench scene setup and recovery', () => {
  it('cleans every partial GPU owner after capture registration fails and rebuilds on retry', async () => {
    mocks.registerCapture.mockImplementationOnce(() => {
      throw new Error('camera registration failed')
    })
    mount()
    const store = useWorkbenchStore(),
      host = mocks.runtime!
    await vi.waitFor(() => expect(store.status).toBe('error'))
    expect(store.error).toBe('camera registration failed')
    expect(mocks.controllers).toHaveLength(1)
    expect(mocks.controllers[0]!.dispose).toHaveBeenCalledOnce()
    expect(mocks.coordinators[0]!.dispose).toHaveBeenCalledOnce()
    expect(mocks.environments[0]!.dispose).toHaveBeenCalledOnce()
    expect(host.scene.value.environment).toBeNull()
    expect(host.renderer.dispose).not.toHaveBeenCalled()
    expect(host.loop.isActive.value).toBe(false)
    const notify = vi.fn()
    host.draw(notify)
    expect(host.renderer.render).toHaveBeenCalledWith(host.scene.value, host.camera.value)
    expect(notify).toHaveBeenCalledOnce()
    host.renderer.render.mockImplementationOnce(() => {
      throw new Error('raster unavailable')
    })
    expect(() => host.draw(notify)).toThrow('raster unavailable')
    expect(notify).toHaveBeenCalledTimes(2)
    const oldDraw = host.context.renderer.replaceRenderFunction.mock.lastCall?.[0]
    await store.retry()
    await awaitFrame()
    expect(mocks.controllers).toHaveLength(2)
    expect(mocks.coordinators).toHaveLength(2)
    expect(mocks.environments).toHaveLength(2)
    expect(host.context.renderer.replaceRenderFunction.mock.lastCall?.[0]).not.toBe(oldDraw)
    expect(mocks.controllers[1]!.enableInteraction).toHaveBeenCalledOnce()
    expect(mocks.controllers[1]!.dispose).not.toHaveBeenCalled()
    app!.unmount()
    app = undefined
    for (const value of [...mocks.controllers, ...mocks.coordinators, ...mocks.environments])
      expect(value.dispose).toHaveBeenCalledOnce()
    expect(mocks.unregisterCapture).toHaveBeenCalledOnce()
    expect(host.render.listeners.size).toBe(0)
    expect(host.ready.listeners.size).toBe(0)
    expect(host.renderer.dispose).not.toHaveBeenCalled()
  })

  it('keeps a failed base environment retryable without a stale controller or replacement renderer', async () => {
    mocks.createEnvironment.mockRejectedValueOnce(new Error('environment readback failed'))
    mount()
    const store = useWorkbenchStore(),
      host = mocks.runtime!
    await vi.waitFor(() => expect(store.status).toBe('error'))
    expect(store.error).toBe('environment readback failed')
    expect(mocks.controllers).toHaveLength(0)
    expect(mocks.coordinators).toHaveLength(0)
    const notify = vi.fn()
    host.draw(notify)
    expect(notify).toHaveBeenCalledOnce()
    await store.retry()
    await awaitFrame()
    expect(mocks.controllers).toHaveLength(1)
    expect(mocks.coordinators).toHaveLength(1)
    expect(host.renderer.init).toHaveBeenCalledTimes(2)
    expect(host.renderer.dispose).not.toHaveBeenCalled()
  })

  it('aborts unmounting setup and releases a late environment without attaching or reporting failure', async () => {
    let resolve!: (value: OwnedEnvironment) => void
    const pending = new Promise<OwnedEnvironment>((done) => {
      resolve = done
    })
    mocks.createEnvironment.mockReturnValueOnce(pending)
    const store = useWorkbenchStore(),
      failed = vi.spyOn(store, 'failed')
    mount()
    await vi.waitFor(() => expect(mocks.createEnvironment).toHaveBeenCalledOnce())
    const signal = mocks.createEnvironment.mock.calls[0]![1]
    app!.unmount()
    app = undefined
    expect(signal.aborted).toBe(true)
    const late = environment()
    resolve(late)
    await vi.waitFor(() => expect(late.dispose).toHaveBeenCalledOnce())
    expect(mocks.controllers).toHaveLength(0)
    expect(mocks.coordinators).toHaveLength(0)
    expect(mocks.runtime!.scene.value.environment).toBeNull()
    expect(failed).not.toHaveBeenCalled()
    expect(mocks.runtime!.renderer.dispose).not.toHaveBeenCalled()
  })

  it('loads only the latest selection when product changes during asynchronous environment preparation', async () => {
    let resolve!: (value: OwnedEnvironment) => void
    mocks.createEnvironment.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done
      }),
    )
    mount()
    await vi.waitFor(() => expect(mocks.createEnvironment).toHaveBeenCalledOnce())
    const store = useWorkbenchStore(),
      latest = parseProduct(samples[2])
    store.preview(latest)
    await nextTick()
    const owned = environment()
    resolve(owned)
    await awaitFrame()
    expect(mocks.controllers).toHaveLength(1)
    expect(mocks.controllers[0]!.load).toHaveBeenCalledOnce()
    expect(mocks.controllers[0]!.load.mock.calls[0]?.[0]).toEqual(latest)
    expect(mocks.coordinators[0]!.ready).toHaveBeenCalledWith(latest.slug, store.revision)
    expect(mocks.createEnvironment).toHaveBeenCalledOnce()
    app!.unmount()
    app = undefined
    expect(owned.dispose).toHaveBeenCalledOnce()
  })

  it('restarts a settled Tres clock for new work and keeps it stopped while the stage is hidden', async () => {
    const props = mount()
    await awaitFrame()
    const host = mocks.runtime!,
      hybrid = mocks.coordinators[0]!
    expect(host.loop.isActive.value).toBe(false)
    hybrid.options.invalidate()
    expect(host.loop.isActive.value).toBe(true)
    const status = hybrid.snapshot()
    hybrid.options.report({ ...status, phase: 'ready' })
    host.present()
    expect(host.loop.isActive.value).toBe(false)
    hybrid.options.invalidate()
    expect(host.loop.isActive.value).toBe(true)
    props.active = false
    await nextTick()
    expect(hybrid.setActive).toHaveBeenLastCalledWith(false)
    expect(host.loop.isActive.value).toBe(false)
    const starts = host.loop.start.mock.calls.length
    hybrid.options.invalidate()
    expect(host.loop.start).toHaveBeenCalledTimes(starts)
  })
})

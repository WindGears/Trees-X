import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PerspectiveCamera, Scene, Texture, Vector2 } from 'three'
import { float, texture, vec3 } from 'three/tsl'
import type { WebGPURenderer } from 'three/webgpu'
import type { DdgiFieldOptions } from './ddgi/field'
import type { RealtimeIrradiance } from './signals'
import type { RealtimeChange } from './types'
import { reventonRealtimeProfile, typewriterRealtimeProfile } from './productProfile'

const factories = vi.hoisted(() => ({
  clock: vi.fn(),
  motion: vi.fn(),
  signals: vi.fn(),
  materials: vi.fn(),
}))
vi.mock('./clock', () => ({ createRealtimeClock: factories.clock }))
vi.mock('./motion', () => ({ createMotionHistory: factories.motion }))
vi.mock('./signals', () => ({ createRealtimeSignals: factories.signals }))
vi.mock('./materials', () => ({ createRealtimeMaterials: factories.materials }))

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept
    reject = fail
  })
  return { promise, resolve, reject }
}

function field() {
  const state = { ready: false, disposed: false },
    ticks: ReturnType<typeof deferred<void>>[] = [],
    receiver: RealtimeIrradiance = { irradiance: vec3(0.4), validity: float(1) }
  return {
    state,
    ticks,
    receiver,
    api: {
      invalidate: vi.fn(),
      needsUpdate: vi.fn(() => true),
      tick: vi.fn<(_idleMs?: number) => Promise<void>>(() => {
        const pending = deferred<void>()
        ticks.push(pending)
        return pending.promise
      }),
      createReceiver: vi.fn(() => (state.ready && !state.disposed ? receiver : null)),
      snapshot: vi.fn(() => ({ ...state })),
      dispose: vi.fn(() => {
        state.disposed = true
        state.ready = false
      }),
    },
  }
}

const cleanups: (() => void)[] = []
beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
})
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) cleanup()
  await vi.dynamicImportSettled()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function fixture(search = '?indirectLighting=ddgi') {
  vi.stubGlobal('location', { search })
  const moduleGate = deferred<void>(),
    imports = vi.fn(),
    fields: ReturnType<typeof field>[] = [],
    create = vi.fn<(options: DdgiFieldOptions) => ReturnType<typeof field>['api']>(() => {
      const next = field()
      fields.push(next)
      return next.api
    })
  vi.doMock('./ddgi/field', async () => {
    imports()
    await moduleGate.promise
    return { createRealtimeDdgi: create }
  })
  const scene = new Scene(),
    camera = new PerspectiveCamera(),
    source = new Texture(),
    inputs = { depth: texture(source), normal: texture(source), camera },
    flags = { ssr: true, ssgi: true, denoise: true },
    clock = {
      frame: vi.fn((draw: () => void) => draw()),
      pause: vi.fn(),
      resume: vi.fn(),
      dispose: vi.fn(),
    },
    motion = {
      node: float(0),
      reset: vi.fn(),
      beginFrame: vi.fn(),
      commitFrame: vi.fn(),
      cancelFrame: vi.fn(),
      stats: () => ({ objects: 1, instances: 1, historyBytes: 64, frameOpen: false }),
      dispose: vi.fn(),
    },
    signals = {
      render: vi.fn(),
      commitFrame: vi.fn(),
      cancelFrame: vi.fn(),
      resetHistory: vi.fn(),
      environment: vi.fn(),
      setSignals: vi.fn(),
      setProfile: vi.fn(),
      snapshot: () => flags,
      sampling: () => null,
      ddgiInputs: vi.fn(() => inputs),
      setWorldGi: vi.fn<(value: RealtimeIrradiance | null) => void>(),
      dispose: vi.fn(),
    },
    materials = {
      install: vi.fn(),
      sync: vi.fn(),
      restore: vi.fn(),
      stats: () => ({ supported: 1 }),
    },
    renderer = {
      onError: vi.fn(),
      getDrawingBufferSize: (size: Vector2) => size.set(1440, 1000),
      render: vi.fn(),
      dispose: vi.fn(),
    },
    beforeRaster = vi.fn(),
    invalidate = vi.fn(),
    notify = vi.fn()
  factories.clock.mockReturnValue(clock)
  factories.motion.mockReturnValue(motion)
  factories.signals.mockReturnValue(signals)
  factories.materials.mockReturnValue(materials)
  const { createRealtimeCoordinator } = await import('./coordinator'),
    coordinator = createRealtimeCoordinator({
      renderer: renderer as unknown as WebGPURenderer,
      scene,
      camera,
      beforeRaster,
      invalidate,
      report: vi.fn(),
    })
  cleanups.push(() => {
    coordinator.dispose()
    moduleGate.resolve()
    for (const item of fields) for (const tick of item.ticks) tick.resolve()
    source.dispose()
  })
  // Most asynchronous-boundary cases begin after the required first complete
  // raster. Keep their assertions scoped to subsequent serialized tick/draws.
  function firstRaster() {
    coordinator.render(notify)
    for (const call of [
      signals.render,
      signals.commitFrame,
      motion.beginFrame,
      motion.commitFrame,
      beforeRaster,
      clock.frame,
      notify,
    ])
      call.mockClear()
  }
  return {
    coordinator,
    moduleGate,
    imports,
    create,
    fields,
    clock,
    motion,
    signals,
    renderer,
    beforeRaster,
    invalidate,
    notify,
    inputs,
    firstRaster,
    async load(warmFirstRaster = true) {
      moduleGate.resolve()
      await vi.dynamicImportSettled()
      expect(create).toHaveBeenCalledTimes(1)
      if (warmFirstRaster && coordinator.snapshot().frames === 0) firstRaster()
      return fields[0]!
    },
    async finishTick(item: ReturnType<typeof field>, index = item.ticks.length - 1) {
      item.ticks[index]!.resolve()
      // Drain the tick's then/catch/finally chain, without a second draw loop.
      for (let turn = 0; turn < 6; turn++) await Promise.resolve()
    },
  }
}

describe('optional DDGI coordinator asynchronous boundaries', () => {
  it('rebuilds product-specific signal owners on handoff while reusing the renderer', async () => {
    const f = await fixture('?indirectLighting=ssgi')
    f.coordinator.prepare(typewriterRealtimeProfile)
    expect(factories.signals).toHaveBeenCalledTimes(1)
    f.coordinator.prepare(typewriterRealtimeProfile)
    expect(factories.signals).toHaveBeenCalledTimes(1)
    f.coordinator.prepare(reventonRealtimeProfile)
    expect(f.signals.dispose).toHaveBeenCalledTimes(1)
    expect(factories.signals).toHaveBeenCalledTimes(2)
    expect(factories.signals.mock.calls[1]?.[4]).toBe(reventonRealtimeProfile)
    f.coordinator.prepare(typewriterRealtimeProfile)
    expect(f.signals.dispose).toHaveBeenCalledTimes(2)
    expect(factories.signals).toHaveBeenCalledTimes(3)
    expect(f.renderer.dispose).not.toHaveBeenCalled()
  })

  it('passes the explicit legacy car scheduling comparison without changing the profile', async () => {
    const f = await fixture('?indirectLighting=ddgi&carRenderTuning=legacy')
    f.coordinator.prepare(reventonRealtimeProfile)
    await f.load()
    expect(f.create.mock.calls[0]![0]).toMatchObject({
      profile: reventonRealtimeProfile,
      legacySchedule: true,
    })
  })
  it('draws cached car frames synchronously while the optional field has no due solve', async () => {
    const f = await fixture()
    f.coordinator.prepare(reventonRealtimeProfile)
    const probe = await f.load()
    probe.api.needsUpdate.mockReturnValue(false)
    f.coordinator.invalidate('camera')
    f.coordinator.render(f.notify)
    expect(probe.api.invalidate).toHaveBeenLastCalledWith('camera')
    expect(probe.api.tick).not.toHaveBeenCalled()
    expect(f.signals.render).toHaveBeenCalledOnce()
    expect(f.notify).toHaveBeenCalledOnce()
    probe.api.needsUpdate.mockReturnValue(true)
    f.coordinator.invalidate('pose')
    f.coordinator.render(f.notify)
    expect(probe.api.invalidate).toHaveBeenLastCalledWith('pose')
    expect(probe.api.tick).toHaveBeenCalledOnce()
    expect(f.signals.render).toHaveBeenCalledOnce()
    await f.finishTick(probe)
    expect(f.signals.render).toHaveBeenCalledTimes(2)
  })

  it('holds a native tick lease until settlement so host teardown or its successor cannot free inputs early', async () => {
    const f = await fixture()
    f.coordinator.prepare(reventonRealtimeProfile)
    const probe = await f.load()
    const { waitForPreparations } = await import('../preparationLease')
    f.coordinator.render(f.notify)
    let settled = false
    const quiescent = waitForPreparations(f.renderer).then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)
    f.coordinator.setActive(false)
    await f.finishTick(probe)
    await quiescent
    expect(settled).toBe(true)
    expect(f.signals.render).not.toHaveBeenCalled()
    expect(f.notify).not.toHaveBeenCalled()
  })
  it('commits the first real raster before compute even when the optional module is already ready', async () => {
    const f = await fixture()
    f.coordinator.prepare(reventonRealtimeProfile)
    f.coordinator.ready('reventon', 1)
    const probe = await f.load(false)
    f.coordinator.render(f.notify)
    expect(probe.api.tick).not.toHaveBeenCalled()
    expect(f.signals.render).toHaveBeenCalledOnce()
    expect(f.signals.commitFrame).toHaveBeenCalledOnce()
    expect(f.motion.commitFrame).toHaveBeenCalledOnce()
    expect(f.notify).toHaveBeenCalledOnce()
    expect(f.coordinator.snapshot()).toMatchObject({ frames: 1, productProfile: 'reventon-v1' })
    f.coordinator.render(f.notify)
    expect(probe.api.tick).toHaveBeenCalledOnce()
    expect(f.signals.render).toHaveBeenCalledOnce()
    await f.finishTick(probe)
    expect(f.signals.render).toHaveBeenCalledTimes(2)
  })

  it('passes and restores the registered profile on car/typewriter prepares without retaining the old field', async () => {
    const f = await fixture()
    f.coordinator.prepare(reventonRealtimeProfile)
    const car = await f.load(false)
    expect(f.create.mock.calls[0]![0].profile?.adapterId).toBe('reventon-v1')
    expect(factories.signals.mock.calls[0]![4]?.adapterId).toBe('reventon-v1')
    expect(f.signals.setProfile).toHaveBeenLastCalledWith(reventonRealtimeProfile)
    f.coordinator.render(f.notify)
    f.coordinator.prepare(typewriterRealtimeProfile)
    await vi.dynamicImportSettled()
    expect(car.api.dispose).toHaveBeenCalledOnce()
    expect(f.create.mock.calls[1]![0].profile?.adapterId).toBe('typewriter-v1')
    expect(f.signals.setProfile).toHaveBeenLastCalledWith(typewriterRealtimeProfile)
    const next = f.fields[1]!
    f.coordinator.render(f.notify)
    expect(next.api.tick).not.toHaveBeenCalled()
    f.coordinator.render(f.notify)
    expect(next.api.tick).toHaveBeenCalledOnce()
    await f.finishTick(next)
    expect(f.coordinator.snapshot().productProfile).toBe('typewriter-v1')
    expect(factories.signals).toHaveBeenCalledTimes(2)
    expect(f.renderer.dispose).not.toHaveBeenCalled()
  })

  it('finishes an old pending compute before the successor first raster and only then solves its own field', async () => {
    const f = await fixture()
    f.coordinator.prepare(reventonRealtimeProfile)
    const car = await f.load()
    f.coordinator.render(f.notify)
    expect(car.api.tick).toHaveBeenCalledOnce()
    f.coordinator.prepare(typewriterRealtimeProfile)
    await vi.dynamicImportSettled()
    const next = f.fields[1]!
    f.coordinator.render(f.notify)
    expect(next.api.tick).not.toHaveBeenCalled()
    expect(f.signals.render).not.toHaveBeenCalled()
    await f.finishTick(car)
    f.coordinator.render(f.notify)
    expect(next.api.tick).not.toHaveBeenCalled()
    expect(f.signals.render).toHaveBeenCalledOnce()
    f.coordinator.render(f.notify)
    expect(next.api.tick).toHaveBeenCalledOnce()
    await f.finishTick(next)
    expect(f.signals.render).toHaveBeenCalledTimes(2)
    expect(f.coordinator.snapshot().productProfile).toBe('typewriter-v1')
  })

  it('does not begin a probe solve after a failed first raster', async () => {
    const f = await fixture()
    f.coordinator.prepare(reventonRealtimeProfile)
    const probe = await f.load(false)
    f.signals.render.mockImplementationOnce(() => {
      throw new Error('first raster failed')
    })
    f.coordinator.render(f.notify)
    f.coordinator.render(f.notify)
    expect(probe.api.tick).not.toHaveBeenCalled()
    expect(f.signals.commitFrame).not.toHaveBeenCalled()
    expect(f.motion.commitFrame).not.toHaveBeenCalled()
    expect(f.coordinator.snapshot()).toMatchObject({
      phase: 'error',
      frames: 0,
      firstRasterMs: null,
      error: 'first raster failed',
    })
  })

  it('lets quiet time advance across completed frames without inventing another activity event', async () => {
    let now = 1000
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    const f = await fixture()
    f.coordinator.prepare()
    f.coordinator.ready('typewriter-study', 1)
    const probe = await f.load()
    f.coordinator.render(f.notify)
    expect(probe.api.tick).toHaveBeenLastCalledWith(0)
    await f.finishTick(probe)
    now = 1100
    f.coordinator.render(f.notify)
    expect(probe.api.tick).toHaveBeenLastCalledWith(100)
    await f.finishTick(probe)
    now = 1350
    f.coordinator.render(f.notify)
    expect(probe.api.tick).toHaveBeenLastCalledWith(350)
    await f.finishTick(probe)
    expect(f.signals.render).toHaveBeenCalledTimes(3)
    expect(f.notify).toHaveBeenCalledTimes(3)
  })

  it('refreshes quiet time for every scene change channel without blocking its raster frame', async () => {
    let now = 1000
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    const f = await fixture()
    f.coordinator.prepare()
    const probe = await f.load()
    const changes: RealtimeChange[] = [
      'camera',
      'pose',
      'camera-cut',
      'pose-jump',
      'materials',
      'lights',
      'environment',
      'size',
      'all',
    ]
    for (const kind of changes) {
      now += 500
      f.coordinator.invalidate(kind)
      now += 25
      f.coordinator.render(f.notify)
      expect(probe.api.tick).toHaveBeenLastCalledWith(25)
      await f.finishTick(probe)
    }
    expect(f.signals.render).toHaveBeenCalledTimes(changes.length)
  })

  it('holds quiet time at zero throughout an interaction and starts a fresh window on release', async () => {
    let now = 1000
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    const f = await fixture()
    f.coordinator.prepare()
    const probe = await f.load()
    f.coordinator.setInteracting(true)
    now = 5000
    f.coordinator.render(f.notify)
    expect(probe.api.tick).toHaveBeenLastCalledWith(0)
    await f.finishTick(probe)
    f.coordinator.setInteracting(false)
    now = 5120
    f.coordinator.setInteracting(false)
    f.coordinator.render(f.notify)
    expect(probe.api.tick).toHaveBeenLastCalledWith(120)
    await f.finishTick(probe)
    now = 5250
    f.coordinator.render(f.notify)
    expect(probe.api.tick).toHaveBeenLastCalledWith(250)
    await f.finishTick(probe)
  })

  it('does not treat hidden time or a stale interaction hold as a resumed rebuild window', async () => {
    let now = 1000
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    const f = await fixture()
    f.coordinator.prepare()
    const probe = await f.load()
    f.coordinator.setInteracting(true)
    f.coordinator.setActive(false)
    now = 9000
    f.coordinator.setActive(true)
    f.coordinator.render(f.notify)
    expect(probe.api.tick).toHaveBeenLastCalledWith(0)
    await f.finishTick(probe)
    now = 9300
    f.coordinator.render(f.notify)
    expect(probe.api.tick).toHaveBeenLastCalledWith(300)
    await f.finishTick(probe)
  })

  it('keeps a new activity time that arrives while the serialized previous tick is pending', async () => {
    let now = 1000
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    const f = await fixture()
    f.coordinator.prepare()
    const probe = await f.load()
    f.coordinator.render(f.notify)
    now = 1450
    f.coordinator.invalidate('pose')
    f.coordinator.render(f.notify)
    expect(probe.api.tick).toHaveBeenCalledTimes(1)
    expect(f.signals.render).not.toHaveBeenCalled()
    await f.finishTick(probe)
    now = 1500
    f.coordinator.render(f.notify)
    expect(probe.api.tick).toHaveBeenLastCalledWith(50)
    await f.finishTick(probe)
  })

  it('keeps the ordinary SSGI path synchronous without importing the optional field', async () => {
    const f = await fixture('')
    f.coordinator.prepare()
    f.coordinator.ready('typewriter-study', 1)
    f.coordinator.render(f.notify)
    expect(f.signals.render).toHaveBeenCalledTimes(1)
    expect(f.notify).toHaveBeenCalledTimes(1)
    expect(f.imports).not.toHaveBeenCalled()
    expect(f.coordinator.snapshot().indirectLighting).toMatchObject({
      requested: 'ssgi',
      actual: 'ssgi',
      preparing: false,
    })
  })

  it('submits a real first raster while the optional module import is unresolved', async () => {
    const f = await fixture()
    f.coordinator.prepare()
    f.coordinator.ready('typewriter-study', 1)
    f.coordinator.render(f.notify)
    expect(f.create).not.toHaveBeenCalled()
    expect(f.signals.render).toHaveBeenCalledTimes(1)
    expect(f.coordinator.snapshot()).toMatchObject({
      frames: 1,
      indirectLighting: { requested: 'ddgi', actual: 'ssgi', preparing: true },
    })
    expect(f.coordinator.snapshot().firstRasterMs).toBeGreaterThanOrEqual(0)
    await f.load()
  })

  it.each(['unload', 'dispose'] as const)(
    'ignores module completion after %s without constructing a stale field',
    async (operation) => {
      const f = await fixture()
      f.coordinator.prepare()
      f.coordinator[operation]()
      f.invalidate.mockClear()
      f.moduleGate.resolve()
      await vi.dynamicImportSettled()
      expect(f.create).not.toHaveBeenCalled()
      expect(f.invalidate).not.toHaveBeenCalled()
      expect(f.signals.render).not.toHaveBeenCalled()
      expect(f.coordinator.snapshot().indirectLighting).toMatchObject({
        actual: 'ssgi',
        preparing: false,
        error: null,
      })
    },
  )

  it('serializes probe ticks with raster and attaches a ready receiver using existing G-buffer inputs', async () => {
    const f = await fixture()
    f.coordinator.prepare()
    f.coordinator.ready('typewriter-study', 1)
    const probe = await f.load()
    f.coordinator.render(f.notify)
    f.coordinator.render(f.notify)
    f.coordinator.render(f.notify)
    expect(probe.api.tick).toHaveBeenCalledTimes(1)
    expect(f.signals.render).not.toHaveBeenCalled()
    expect(f.clock.frame).not.toHaveBeenCalled()
    expect(f.beforeRaster).not.toHaveBeenCalled()
    probe.state.ready = true
    f.create.mock.calls[0]![0].onReadyChanged?.()
    await f.finishTick(probe)
    expect(probe.api.createReceiver).toHaveBeenCalledWith(f.inputs)
    expect(f.signals.setWorldGi).toHaveBeenLastCalledWith(probe.receiver)
    expect(f.signals.render).toHaveBeenCalledTimes(1)
    expect(f.clock.frame).toHaveBeenCalledTimes(1)
    expect(f.beforeRaster).toHaveBeenCalledTimes(1)
    expect(f.notify).toHaveBeenCalledTimes(1)
    expect(f.coordinator.snapshot().indirectLighting?.actual).toBe('ddgi')
    f.coordinator.render(f.notify)
    expect(probe.api.tick).toHaveBeenCalledTimes(2)
    expect(f.signals.render).toHaveBeenCalledTimes(1)
    expect(f.beforeRaster).toHaveBeenCalledTimes(1)
    await f.finishTick(probe)
    expect(f.signals.render).toHaveBeenCalledTimes(2)
    expect(f.clock.frame).toHaveBeenCalledTimes(2)
    expect(f.beforeRaster).toHaveBeenCalledTimes(2)
  })

  it('does not draw, notify or restart rendering for a tick that completes after hiding', async () => {
    const f = await fixture()
    f.coordinator.prepare()
    f.coordinator.ready('typewriter-study', 1)
    const probe = await f.load()
    f.coordinator.render(f.notify)
    f.coordinator.setActive(false)
    f.invalidate.mockClear()
    probe.state.ready = true
    f.create.mock.calls[0]![0].onReadyChanged?.()
    await f.finishTick(probe)
    expect(f.signals.render).not.toHaveBeenCalled()
    expect(f.signals.setWorldGi).not.toHaveBeenCalled()
    expect(f.notify).not.toHaveBeenCalled()
    expect(f.invalidate).not.toHaveBeenCalled()
    expect(f.coordinator.snapshot()).toMatchObject({ active: false, frames: 1 })
    f.coordinator.setActive(true)
    f.coordinator.render(f.notify)
    await f.finishTick(probe)
    expect(f.signals.render).toHaveBeenCalledTimes(1)
    expect(f.coordinator.snapshot().firstRasterMs).toBeGreaterThanOrEqual(0)
  })

  it('returns to native SSGI after a failed tick while retaining SSR, denoise and frame commits', async () => {
    const f = await fixture()
    f.coordinator.prepare()
    f.coordinator.ready('typewriter-study', 1)
    const probe = await f.load()
    f.coordinator.render(f.notify)
    probe.ticks[0]!.reject(new Error('probe compute rejected'))
    for (let turn = 0; turn < 6; turn++) await Promise.resolve()
    expect(f.signals.setWorldGi).toHaveBeenLastCalledWith(null)
    expect(f.signals.setSignals).not.toHaveBeenCalled()
    f.coordinator.render(f.notify)
    expect(f.signals.render).toHaveBeenCalledTimes(1)
    expect(f.signals.commitFrame).toHaveBeenCalledTimes(1)
    expect(f.motion.commitFrame).toHaveBeenCalledTimes(1)
    expect(f.coordinator.snapshot()).toMatchObject({
      phase: 'ready',
      error: null,
      signals: { ssr: true, ssgi: true, denoise: true },
      indirectLighting: { actual: 'ssgi', error: 'probe compute rejected' },
    })
  })

  it('detaches the ready receiver when the field reports an internally caught solve failure', async () => {
    const f = await fixture()
    f.coordinator.prepare()
    f.coordinator.ready('typewriter-study', 1)
    const probe = await f.load(),
      callbacks = f.create.mock.calls[0]![0]
    f.coordinator.render(f.notify)
    probe.state.ready = true
    callbacks.onReadyChanged?.()
    await f.finishTick(probe)
    expect(f.signals.setWorldGi).toHaveBeenLastCalledWith(probe.receiver)
    f.coordinator.render(f.notify)
    // Real field.advance catches errors and reports them rather than rejecting
    // tick. This must select the same SSGI fallback as a rejected tick.
    probe.state.ready = false
    callbacks.onReadyChanged?.()
    callbacks.onError?.(new Error('probe solve reported failure'))
    await f.finishTick(probe)
    expect(f.signals.setWorldGi).toHaveBeenLastCalledWith(null)
    expect(f.signals.setSignals).not.toHaveBeenCalled()
    expect(f.signals.render).toHaveBeenCalledTimes(2)
    expect(f.coordinator.snapshot()).toMatchObject({
      error: null,
      indirectLighting: { actual: 'ssgi', error: 'probe solve reported failure' },
    })
  })

  it('detaches a ready receiver on the next raster after an independent field error callback', async () => {
    const f = await fixture()
    f.coordinator.prepare()
    f.coordinator.ready('typewriter-study', 1)
    const probe = await f.load(),
      callbacks = f.create.mock.calls[0]![0]
    f.coordinator.render(f.notify)
    probe.state.ready = true
    callbacks.onReadyChanged?.()
    await f.finishTick(probe)
    expect(f.signals.setWorldGi).toHaveBeenLastCalledWith(probe.receiver)
    f.signals.setWorldGi.mockClear()

    // No tick is pending and readiness does not change. The independent error
    // callback must still remove the already compiled world-space receiver.
    callbacks.onError?.(new Error('probe failed between frames'))
    expect(f.signals.setWorldGi).not.toHaveBeenCalled()
    f.coordinator.render(f.notify)
    expect(f.signals.setWorldGi).toHaveBeenCalledExactlyOnceWith(null)
    expect(f.signals.setWorldGi.mock.invocationCallOrder[0]).toBeLessThan(
      f.signals.render.mock.invocationCallOrder[1]!,
    )
    expect(probe.api.tick).toHaveBeenCalledTimes(1)
    expect(f.signals.setSignals).not.toHaveBeenCalled()
    expect(f.signals.render).toHaveBeenCalledTimes(2)
    expect(f.signals.commitFrame).toHaveBeenCalledTimes(2)
    expect(f.motion.commitFrame).toHaveBeenCalledTimes(2)
    expect(f.notify).toHaveBeenCalledTimes(2)
    expect(f.coordinator.snapshot()).toMatchObject({
      phase: 'ready',
      error: null,
      signals: { ssr: true, ssgi: true, denoise: true },
      indirectLighting: { actual: 'ssgi', error: 'probe failed between frames' },
    })
  })

  it('keeps fallback rendering available after the optional module import rejects', async () => {
    const f = await fixture()
    f.coordinator.prepare()
    f.moduleGate.reject(new Error('optional module unavailable'))
    await vi.dynamicImportSettled()
    f.coordinator.render(f.notify)
    expect(f.signals.render).toHaveBeenCalledTimes(1)
    expect(f.coordinator.snapshot().indirectLighting).toMatchObject({
      actual: 'ssgi',
      preparing: false,
      // Vitest wraps rejected import factories in its own module error. The
      // coordinator must still surface a reason and retain its raster fallback.
      error: expect.any(String),
    })
    expect(f.coordinator.snapshot().error).toBeNull()
  })

  it('preserves SSR and SSGI when the imported field constructor rejects', async () => {
    const f = await fixture()
    f.create.mockImplementationOnce(() => {
      throw new Error('DDGI device unsupported')
    })
    f.coordinator.prepare()
    f.moduleGate.resolve()
    await vi.dynamicImportSettled()
    f.coordinator.render(f.notify)
    expect(f.signals.render).toHaveBeenCalledTimes(1)
    expect(f.signals.setSignals).not.toHaveBeenCalled()
    expect(f.coordinator.snapshot()).toMatchObject({
      error: null,
      signals: { ssr: true, ssgi: true, denoise: true },
      indirectLighting: { actual: 'ssgi', preparing: false, error: 'DDGI device unsupported' },
    })
  })

  it('ignores old field callbacks after unload rather than poisoning its successor', async () => {
    const f = await fixture()
    f.coordinator.prepare()
    const old = await f.load(),
      callbacks = f.create.mock.calls[0]![0]
    f.coordinator.unload()
    f.coordinator.prepare()
    await vi.dynamicImportSettled()
    expect(f.create).toHaveBeenCalledTimes(2)
    callbacks.onReadyChanged?.()
    callbacks.onError?.(new Error('old generation probe failed late'))
    expect(old.api.dispose).toHaveBeenCalledTimes(1)
    expect(f.coordinator.snapshot().indirectLighting).toMatchObject({
      // The successor module is loaded but its first probe solve is pending.
      preparing: true,
      error: null,
    })
    const next = f.fields[1]!
    f.firstRaster()
    f.coordinator.render(f.notify)
    expect(next.api.tick).toHaveBeenCalledTimes(1)
    await f.finishTick(next)
    expect(next.api.createReceiver).not.toHaveBeenCalled()
    expect(f.signals.render).toHaveBeenCalledTimes(1)
  })

  it('contains a scene update failure after probe compute and recovers the pending frame on retry', async () => {
    const f = await fixture()
    f.coordinator.prepare()
    const probe = await f.load()
    f.beforeRaster.mockImplementationOnce(() => {
      throw new Error('scene update rejected')
    })
    expect(() => f.coordinator.render(f.notify)).not.toThrow()
    expect(probe.api.tick).toHaveBeenCalledTimes(1)
    expect(f.clock.frame).not.toHaveBeenCalled()
    expect(f.beforeRaster).not.toHaveBeenCalled()
    expect(f.coordinator.snapshot()).toMatchObject({ error: null, frames: 1 })
    await f.finishTick(probe)
    expect(f.clock.frame).toHaveBeenCalledTimes(1)
    expect(f.beforeRaster).toHaveBeenCalledTimes(1)
    expect(f.signals.render).not.toHaveBeenCalled()
    expect(f.signals.commitFrame).not.toHaveBeenCalled()
    expect(f.motion.beginFrame).not.toHaveBeenCalled()
    expect(f.motion.commitFrame).not.toHaveBeenCalled()
    expect(f.notify).not.toHaveBeenCalled()
    expect(f.coordinator.snapshot()).toMatchObject({
      phase: 'error',
      error: 'scene update rejected',
      frames: 1,
    })
    f.coordinator.unload()
    f.coordinator.prepare()
    f.coordinator.ready('typewriter-study', 2)
    await vi.dynamicImportSettled()
    const retry = f.fields[1]!
    f.coordinator.render(f.notify)
    expect(retry.api.tick).not.toHaveBeenCalled()
    expect(f.beforeRaster).toHaveBeenCalledTimes(2)
    f.coordinator.render(f.notify)
    expect(retry.api.tick).toHaveBeenCalledTimes(1)
    await f.finishTick(retry)
    expect(f.clock.frame).toHaveBeenCalledTimes(3)
    expect(f.beforeRaster).toHaveBeenCalledTimes(3)
    expect(f.signals.render).toHaveBeenCalledTimes(2)
    expect(f.signals.commitFrame).toHaveBeenCalledTimes(2)
    expect(f.motion.commitFrame).toHaveBeenCalledTimes(2)
    expect(f.notify).toHaveBeenCalledTimes(2)
    expect(f.coordinator.snapshot()).toMatchObject({ phase: 'ready', error: null, frames: 3 })
    expect(f.coordinator.snapshot().firstRasterMs).toBeGreaterThanOrEqual(0)
  })

  it('detaches a receiver and releases the field once while cancelling an unloaded pending frame', async () => {
    const f = await fixture()
    f.coordinator.prepare()
    const probe = await f.load()
    f.coordinator.render(f.notify)
    f.coordinator.unload()
    expect(f.signals.setWorldGi).toHaveBeenLastCalledWith(null)
    expect(probe.api.dispose).toHaveBeenCalledTimes(1)
    await f.finishTick(probe)
    expect(f.signals.render).not.toHaveBeenCalled()
    expect(f.notify).not.toHaveBeenCalled()
    f.coordinator.dispose()
    f.coordinator.dispose()
    expect(probe.api.dispose).toHaveBeenCalledTimes(1)
    expect(f.signals.dispose).toHaveBeenCalledTimes(1)
    expect(f.clock.dispose).toHaveBeenCalledTimes(1)
    expect(f.motion.dispose).toHaveBeenCalledTimes(1)
    expect(f.renderer.dispose).not.toHaveBeenCalled()
    const snapshot = f.coordinator.snapshot()
    f.invalidate.mockClear()
    f.create.mock.calls[0]![0].onReadyChanged?.()
    f.create.mock.calls[0]![0].onError?.(new Error('disposed field callback'))
    expect(f.coordinator.snapshot()).toEqual(snapshot)
    expect(f.invalidate).not.toHaveBeenCalled()
  })
})

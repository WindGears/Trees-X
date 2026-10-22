import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Group, PerspectiveCamera, Scene, Texture, Vector2 } from 'three'
import { bool, texture } from 'three/tsl'
import type { WebGPURenderer } from 'three/webgpu'
import { withPreparationLease } from '../../preparationLease'
import type { createRealtimeSceneInputs } from '../sceneInputs'
import type { CarShadowBvh } from './bvh'
import { CarKeyAreaLight } from './light'

const factories = vi.hoisted(() => ({ bvh: vi.fn(), visibility: vi.fn() }))
vi.mock('./bvh', () => ({ createCarShadowBvh: factories.bvh }))
vi.mock('./visibility', () => ({ createCarShadowVisibility: factories.visibility }))
import { createCarKeyShadow } from './runtime'

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (cause: unknown) => void
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept
    reject = fail
  })
  return { promise, resolve, reject }
}

const cleanup: (() => void)[] = []
beforeEach(() => {
  vi.clearAllMocks()
})
afterEach(async () => {
  for (const close of cleanup.splice(0)) close()
  await vi.dynamicImportSettled()
})

function fixture(options: { requested?: boolean; source?: boolean; light?: boolean } = {}) {
  const scene = new Scene(),
    root = new Group(),
    light = new CarKeyAreaLight(),
    source = new Texture()
  root.userData.adapter = 'reventon-v1'
  root.userData.carStudioQuality = 'studio'
  if (options.source !== false) scene.add(root)
  if (options.light !== false) scene.add(light)
  const gate = deferred<CarShadowBvh>(),
    queue = vi.fn(() => Promise.resolve()),
    renderer = {
      backend: { device: { queue: { onSubmittedWorkDone: queue } } },
      getDrawingBufferSize: (size: Vector2) => size.set(1440, 1000),
    } as unknown as WebGPURenderer,
    bvh = {
      occluded: () => bool(false),
      sync: vi.fn(() => false),
      snapshot: () => ({ transformUpdates: 0 }),
      dispose: vi.fn(),
    } as unknown as CarShadowBvh,
    visibility = {
      node: texture(source),
      prepare: vi.fn(),
      prepareShaders: vi.fn(() => Promise.resolve()),
      cancelFrame: vi.fn(),
      commitFrame: vi.fn(),
      resetHistory: vi.fn(),
      dispose: vi.fn(),
      snapshot: () => ({ maxHistory: 8 }),
    },
    setKeyShadow = vi.fn(),
    prepare = vi.fn<(_renderer: WebGPURenderer, signal?: AbortSignal) => Promise<void>>(() =>
      Promise.resolve(),
    ),
    inputs = {
      depth: texture(source),
      normal: texture(source),
      velocity: texture(source),
      diffuseResponse: texture(source),
      setKeyShadow,
      prepare,
    } as unknown as ReturnType<typeof createRealtimeSceneInputs>
  factories.bvh.mockImplementation(() => gate.promise)
  factories.visibility.mockReturnValue(visibility)
  const owner = createCarKeyShadow(
    renderer,
    scene,
    new PerspectiveCamera(),
    inputs,
    options.requested !== false,
  )
  cleanup.push(() => {
    owner.dispose()
    gate.resolve(bvh)
    source.dispose()
  })
  return {
    owner,
    renderer,
    scene,
    root,
    light,
    bvh,
    visibility,
    inputs,
    gate,
    queue,
    prepare,
    setKeyShadow,
  }
}

async function built(f: ReturnType<typeof fixture>) {
  f.owner.start()
  await vi.dynamicImportSettled()
  f.gate.resolve(f.bvh)
  await Promise.resolve()
  await Promise.resolve()
}

describe('car key shadow asynchronous runtime ownership', () => {
  it('does not build at construction and waits for explicit post-raster start/prepare', async () => {
    const f = fixture()
    expect(f.owner.snapshot()).toMatchObject({ stage: 'idle', phase: 'loading', frames: 0 })
    expect(factories.bvh).not.toHaveBeenCalled()
    expect(factories.visibility).not.toHaveBeenCalled()
    f.owner.prepareFrame(1440, 1000)
    f.owner.commitFrame()
    expect(f.owner.snapshot().frames).toBe(0)
    await built(f)
    expect(factories.bvh).toHaveBeenCalledWith(f.root, expect.any(AbortSignal))
    expect(f.owner.needsPreparation()).toBe(true)
    expect(factories.visibility).not.toHaveBeenCalled()
    await f.owner.prepare()
    expect(f.owner.snapshot()).toMatchObject({ stage: 'prepared', phase: 'loading', frames: 0 })
    expect(f.queue).toHaveBeenCalledOnce()
    expect(f.setKeyShadow).toHaveBeenCalledWith({
      visibility: f.visibility.node,
      depth: f.inputs.depth,
    })
    expect(factories.visibility.mock.calls[0]![2]).toMatchObject({
      receiverMask: f.inputs.diffuseResponse,
    })
    f.owner.prepareFrame(1440, 1000)
    f.owner.commitFrame()
    expect(f.owner.snapshot()).toMatchObject({ stage: 'active', phase: 'ready', frames: 1 })
  })

  it('never touches materials, starts a worker or binds a light when disabled or source mismatched', () => {
    for (const options of [{ requested: false }, { source: false }, { light: false }]) {
      const f = fixture(options)
      f.owner.start()
      f.owner.dispose()
      expect(f.owner.snapshot().phase).toBe('disabled')
      expect(f.setKeyShadow).not.toHaveBeenCalled()
    }
    expect(factories.bvh).not.toHaveBeenCalled()
    expect(factories.visibility).not.toHaveBeenCalled()
  })

  it('aborts a hidden pending build and disposes its late result without readiness', async () => {
    const f = fixture()
    f.owner.start()
    await vi.dynamicImportSettled()
    const signal = factories.bvh.mock.calls[0]![1] as AbortSignal
    f.owner.setActive(false)
    expect(signal.aborted).toBe(true)
    f.gate.resolve(f.bvh)
    await Promise.resolve()
    await Promise.resolve()
    expect(f.bvh.dispose).toHaveBeenCalledOnce()
    expect(f.owner.snapshot()).toMatchObject({ stage: 'idle', frames: 0, blasBuilds: 0 })
    expect(f.owner.needsPreparation()).toBe(false)
    expect(factories.visibility).not.toHaveBeenCalled()
  })

  it('rejects a disposed generation and a successor only builds its own scene root', async () => {
    const old = fixture()
    old.owner.start()
    await vi.dynamicImportSettled()
    old.owner.dispose()
    const next = fixture()
    await built(next)
    old.gate.resolve(old.bvh)
    await Promise.resolve()
    await Promise.resolve()
    expect(old.bvh.dispose).toHaveBeenCalledOnce()
    expect(old.owner.snapshot()).toMatchObject({ stage: 'disposed', frames: 0, blasBuilds: 0 })
    expect(next.owner.snapshot()).toMatchObject({ stage: 'waiting', blasBuilds: 1 })
    expect(factories.bvh.mock.calls.map((call) => call[0])).toEqual([old.root, next.root])
  })

  it('invalidates stale pending builds even if a preparation lease delays physical retirement', async () => {
    const f = fixture(),
      lease = deferred<void>()
    f.owner.start()
    await vi.dynamicImportSettled()
    const pending = withPreparationLease(f.renderer, () => lease.promise)
    f.owner.fail(new Error('render failure'))
    f.gate.resolve(f.bvh)
    await Promise.resolve()
    await Promise.resolve()
    expect(f.owner.snapshot()).toMatchObject({ phase: 'error', stage: 'failed', blasBuilds: 0 })
    expect(f.bvh.dispose).toHaveBeenCalledOnce()
    lease.resolve()
    await pending
  })

  it('unwinds a scoped shader failure but retains owners until native compilation lease settles', async () => {
    const f = fixture(),
      nativeCompile = deferred<void>()
    await built(f)
    f.prepare.mockImplementationOnce(() => nativeCompile.promise)
    const pending = withPreparationLease(f.renderer, () => f.owner.prepare())
    expect(f.owner.isCompiling()).toBe(true)
    f.owner.compilationFailed('shader validation failed')
    nativeCompile.resolve()
    await pending
    expect(f.owner.snapshot()).toMatchObject({
      phase: 'error',
      stage: 'failed',
      error: 'shader validation failed',
    })
    expect(f.setKeyShadow).toHaveBeenLastCalledWith()
    expect(f.visibility.dispose).toHaveBeenCalledOnce()
    expect(f.bvh.dispose).toHaveBeenCalledOnce()
    expect(f.visibility.commitFrame).not.toHaveBeenCalled()
  })

  it('defers disposal during compile, unbinds immediately, and never advances a retired runtime', async () => {
    const f = fixture(),
      nativeCompile = deferred<void>()
    await built(f)
    f.prepare.mockImplementationOnce(() => nativeCompile.promise)
    const pending = withPreparationLease(f.renderer, () => f.owner.prepare())
    f.owner.dispose()
    expect(f.setKeyShadow).toHaveBeenLastCalledWith()
    expect(f.visibility.dispose).not.toHaveBeenCalled()
    expect(f.bvh.dispose).not.toHaveBeenCalled()
    nativeCompile.resolve()
    await pending
    expect(f.visibility.dispose).toHaveBeenCalledOnce()
    expect(f.bvh.dispose).toHaveBeenCalledOnce()
    expect(f.owner.snapshot()).toMatchObject({ stage: 'disposed', frames: 0 })
  })

  it('clears shadow history for moved off-screen casters while retaining ordinary camera history', async () => {
    const f = fixture()
    await built(f)
    await f.owner.prepare()
    f.owner.invalidate('camera')
    f.owner.invalidate('pose')
    expect(f.visibility.resetHistory).not.toHaveBeenCalled()
    vi.mocked(f.bvh.sync).mockReturnValueOnce(true)
    f.owner.prepareFrame(1440, 1000)
    expect(f.visibility.resetHistory).toHaveBeenCalledOnce()
    f.owner.invalidate('materials')
    expect(f.visibility.resetHistory).toHaveBeenCalledTimes(2)
    f.owner.setActive(false)
    expect(f.visibility.resetHistory).toHaveBeenCalledTimes(3)
    expect(f.owner.needsPreparation()).toBe(false)
  })
})

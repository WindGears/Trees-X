import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Group, PerspectiveCamera, Scene, Vector2 } from 'three'
import type { WebGPURenderer } from 'three/webgpu'
import { createRealtimeCoordinator } from './coordinator'
import type { RealtimeStatus } from './types'

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

function fixture() {
  const calls: string[] = [],
    scene = new Scene(),
    camera = new PerspectiveCamera(),
    root = new Group()
  scene.add(root)
  root.userData.workbenchProduct = 'typewriter-study'
  let clockActive = true
  const clock = {
    frame: vi.fn((draw: () => unknown) => {
      if (!clockActive) throw new Error('Clock is paused')
      calls.push('clock:begin')
      try {
        return draw()
      } finally {
        calls.push('clock:finish')
      }
    }),
    pause: vi.fn(() => {
      clockActive = false
    }),
    resume: vi.fn(() => {
      clockActive = true
    }),
    dispose: vi.fn(),
  }
  const motion = {
    node: { testMotionNode: true },
    reset: vi.fn(() => calls.push('motion:reset')),
    beginFrame: vi.fn(() => calls.push('motion:begin')),
    commitFrame: vi.fn(() => calls.push('motion:commit')),
    cancelFrame: vi.fn(() => calls.push('motion:cancel')),
    stats: vi.fn(() => ({ objects: 298, instances: 2257, historyBytes: 144448, frameOpen: false })),
    dispose: vi.fn(),
  }
  let enabled = { ssr: true, ssgi: true, denoise: true }
  const signals = {
    render: vi.fn(() => {
      calls.push('signals:render')
    }),
    commitFrame: vi.fn(() => calls.push('signals:commit')),
    cancelFrame: vi.fn(() => calls.push('signals:cancel')),
    resetHistory: vi.fn(() => calls.push('signals:reset')),
    environment: vi.fn(() => calls.push('signals:environment')),
    setWorldGi: vi.fn(),
    ddgiInputs: vi.fn(() => ({ camera })),
    setSignals: vi.fn((ssr: boolean, ssgi: boolean, denoise: boolean) => {
      enabled = { ssr, ssgi, denoise }
    }),
    snapshot: vi.fn(() => ({ ...enabled })),
    sampling: vi.fn(() => ({ mode: 'rotating' as const, frames: 0, phase: 0, prepared: false })),
    dispose: vi.fn(),
  }
  const materials = {
    install: vi.fn(() => calls.push('materials:install')),
    sync: vi.fn(() => calls.push('materials:sync')),
    restore: vi.fn(() => calls.push('materials:restore')),
    stats: vi.fn(() => ({ physical: 12, baseIsotropic: 4 })),
  }
  const originalError = vi.fn<(event: string) => void>()
  const renderer = {
    onError: originalError,
    getDrawingBufferSize: vi.fn((size: Vector2) => {
      calls.push('renderer:size')
      return size.set(1440, 1000)
    }),
    render: vi.fn(() => calls.push('renderer:fallback')),
    dispose: vi.fn(),
  }
  factories.clock.mockReturnValue(clock)
  factories.motion.mockReturnValue(motion)
  factories.signals.mockReturnValue(signals)
  factories.materials.mockReturnValue(materials)
  const beforeRaster = vi.fn(() => calls.push('beforeRaster')),
    invalidate = vi.fn(),
    report = vi.fn<(status: RealtimeStatus) => void>(),
    notify = vi.fn(() => calls.push('notify'))
  const coordinator = createRealtimeCoordinator({
    renderer: renderer as unknown as WebGPURenderer,
    scene,
    camera,
    beforeRaster,
    invalidate,
    report,
  })
  return {
    calls,
    scene,
    camera,
    root,
    clock,
    motion,
    signals,
    materials,
    renderer,
    originalError,
    beforeRaster,
    invalidate,
    report,
    notify,
    coordinator,
  }
}

beforeEach(() => vi.clearAllMocks())

describe('realtime complete-frame coordinator lifecycle', () => {
  it('exposes the scene-owned sampling snapshot separately from enabled signal flags', () => {
    const f = fixture()
    expect(f.coordinator.snapshot().reflectionKernel).toBeNull()
    f.coordinator.prepare()
    const kernel = { mode: 'rotating' as const, frames: 4, phase: 1.25, prepared: false }
    f.signals.sampling.mockReturnValue(kernel)
    expect(f.coordinator.snapshot()).toMatchObject({
      signals: { ssr: true, ssgi: true, denoise: true },
      reflectionKernel: kernel,
    })
    expect(f.signals.sampling).toHaveBeenCalledTimes(1)
    f.coordinator.dispose()
    expect(f.coordinator.snapshot().reflectionKernel).toBeNull()
  })

  it('does not commit lighting or motion when the renderer reports failure during final draw', () => {
    const f = fixture()
    f.coordinator.prepare()
    f.coordinator.ready('typewriter-study', 8)
    f.signals.render.mockImplementationOnce(() => f.renderer.onError('submission rejected'))
    f.coordinator.render(f.notify)
    expect(f.signals.commitFrame).not.toHaveBeenCalled()
    expect(f.motion.commitFrame).not.toHaveBeenCalled()
    expect(f.signals.cancelFrame).toHaveBeenCalledTimes(1)
    expect(f.motion.cancelFrame).toHaveBeenCalledTimes(1)
    expect(f.coordinator.snapshot()).toMatchObject({ frames: 0, error: 'submission rejected' })
    expect(f.notify).not.toHaveBeenCalled()
    f.coordinator.dispose()
  })

  it('does not claim a first raster until a successful complete frame was submitted', () => {
    const f = fixture()
    f.coordinator.prepare()
    f.coordinator.ready('typewriter-study', 8)
    expect(f.coordinator.snapshot().firstRasterMs).toBeNull()
    expect(f.coordinator.snapshot().frames).toBe(0)
    f.calls.length = 0
    f.invalidate.mockClear()
    f.coordinator.render(f.notify)
    expect(f.calls).toEqual([
      'clock:begin',
      'beforeRaster',
      'materials:sync',
      'renderer:size',
      'motion:begin',
      'signals:render',
      'signals:commit',
      'motion:commit',
      'clock:finish',
      'notify',
    ])
    expect(f.coordinator.snapshot()).toMatchObject({
      phase: 'ready',
      slug: 'typewriter-study',
      revision: 8,
      frames: 1,
      resolution: { width: 1440, height: 1000 },
      motion: { instances: 2257, historyBytes: 144448, frameOpen: false },
    })
    expect(f.coordinator.snapshot().firstRasterMs).toBeGreaterThanOrEqual(0)
    expect(f.invalidate).toHaveBeenCalledTimes(1)
    expect(f.renderer.render).not.toHaveBeenCalled()
    f.coordinator.dispose()
  })

  it('does not advance hidden frames or invoke scene animation callbacks on resume alone', () => {
    const f = fixture()
    f.coordinator.prepare()
    f.coordinator.ready('typewriter-study', 1)
    f.coordinator.render(f.notify)
    const pose = f.root.matrix.toArray(),
      snapshot = f.coordinator.snapshot()
    f.beforeRaster.mockClear()
    f.invalidate.mockClear()
    f.coordinator.setActive(false)
    f.coordinator.setActive(false)
    f.coordinator.render(f.notify)
    expect(f.clock.pause).toHaveBeenCalledTimes(1)
    expect(f.beforeRaster).not.toHaveBeenCalled()
    expect(f.invalidate).not.toHaveBeenCalled()
    expect(f.coordinator.snapshot()).toMatchObject({
      phase: 'paused',
      active: false,
      frames: snapshot.frames,
    })
    expect(f.root.matrix.toArray()).toEqual(pose)
    f.coordinator.setActive(true)
    expect(f.clock.resume).toHaveBeenCalledTimes(1)
    expect(f.beforeRaster).not.toHaveBeenCalled()
    expect(f.root.matrix.toArray()).toEqual(pose)
    f.coordinator.render(f.notify)
    expect(f.beforeRaster).toHaveBeenCalledTimes(1)
    expect(f.signals.resetHistory).toHaveBeenCalledTimes(1)
    expect(f.coordinator.snapshot().frames).toBe(snapshot.frames + 1)
    f.coordinator.dispose()
  })

  it('retains motion history for smooth camera and rigid poses but resets on material and size changes', () => {
    const f = fixture()
    f.coordinator.prepare()
    f.coordinator.ready('typewriter-study', 2)
    f.coordinator.render(f.notify)
    const initialResets = f.motion.reset.mock.calls.length
    for (const kind of ['camera', 'pose'] as const) {
      f.coordinator.invalidate(kind)
      f.coordinator.render(f.notify)
    }
    expect(f.signals.resetHistory).not.toHaveBeenCalled()
    expect(f.motion.reset).toHaveBeenCalledTimes(initialResets)
    for (const kind of ['materials', 'size'] as const) {
      f.coordinator.invalidate(kind)
      f.coordinator.render(f.notify)
    }
    expect(f.signals.resetHistory).toHaveBeenCalledTimes(2)
    expect(f.motion.reset).toHaveBeenCalledTimes(initialResets + 2)
    expect(f.coordinator.snapshot().historyResets).toBe(2)
    f.coordinator.dispose()
  })

  it('reuses the signal/MRT owner across reload while invalidating the old lighting history', () => {
    const f = fixture()
    f.coordinator.prepare()
    f.coordinator.ready('typewriter-study', 3)
    f.coordinator.render(f.notify)
    const resetCount = f.signals.resetHistory.mock.calls.length
    f.coordinator.unload()
    expect(f.materials.restore).toHaveBeenCalledTimes(1)
    expect(f.signals.dispose).not.toHaveBeenCalled()
    expect(f.coordinator.snapshot()).toMatchObject({ slug: null, revision: -1, phase: 'loading' })
    f.coordinator.prepare()
    f.coordinator.ready('typewriter-study', 4)
    f.coordinator.render(f.notify)
    expect(factories.signals).toHaveBeenCalledTimes(1)
    expect(f.signals.resetHistory).toHaveBeenCalledTimes(resetCount + 1)
    expect(f.materials.install).toHaveBeenCalledTimes(2)
    expect(f.coordinator.snapshot().revision).toBe(4)
    f.coordinator.dispose()
  })

  it('resets pose jumps and camera cuts before motion begins, including changes raised inside beforeRaster', () => {
    const f = fixture()
    f.coordinator.prepare()
    f.coordinator.ready('typewriter-study', 3)
    f.coordinator.render(f.notify)
    for (const kind of ['pose-jump', 'camera-cut'] as const) {
      f.calls.length = 0
      f.beforeRaster.mockImplementationOnce(() => {
        f.calls.push('beforeRaster:jump')
        f.coordinator.invalidate(kind)
        return f.calls.length
      })
      f.coordinator.render(f.notify)
      expect(f.calls.slice(0, 8)).toEqual([
        'clock:begin',
        'beforeRaster:jump',
        'materials:sync',
        'renderer:size',
        'signals:reset',
        'signals:environment',
        'motion:reset',
        'motion:begin',
      ])
    }
    expect(f.coordinator.snapshot().historyResets).toBe(2)
    f.coordinator.dispose()
  })

  it('retains a reentrant reset notification for the next frame rather than clearing it during history cleanup', () => {
    const f = fixture()
    f.coordinator.prepare()
    f.coordinator.ready('typewriter-study', 3)
    f.coordinator.render(f.notify)
    f.coordinator.invalidate('pose-jump')
    f.signals.resetHistory.mockImplementationOnce(() => {
      f.calls.push('signals:reset')
      f.coordinator.invalidate('camera-cut')
      return f.calls.length
    })
    f.coordinator.render(f.notify)
    expect(f.coordinator.snapshot().historyResets).toBe(1)
    f.coordinator.render(f.notify)
    expect(f.coordinator.snapshot().historyResets).toBe(2)
    f.coordinator.render(f.notify)
    expect(f.coordinator.snapshot().historyResets).toBe(2)
    expect(f.signals.resetHistory).toHaveBeenCalledTimes(2)
    f.coordinator.dispose()
  })

  it('preserves asynchronous GPU errors over ready and does not schedule a new erroneous frame', () => {
    const f = fixture()
    f.coordinator.prepare()
    f.renderer.onError('asynchronous GPU pipeline validation failed')
    expect(f.originalError).toHaveBeenCalledWith('asynchronous GPU pipeline validation failed')
    f.invalidate.mockClear()
    f.coordinator.ready('typewriter-study', 5)
    expect(f.coordinator.snapshot()).toMatchObject({
      phase: 'error',
      error: 'asynchronous GPU pipeline validation failed',
    })
    expect(f.invalidate).not.toHaveBeenCalled()
    f.coordinator.render(f.notify)
    expect(f.signals.render).not.toHaveBeenCalled()
    expect(f.notify).not.toHaveBeenCalled()
    expect(f.invalidate).not.toHaveBeenCalled()
    f.coordinator.dispose()
  })

  it('accepts actual structured backend errors and permits an explicit unload/prepare retry', () => {
    const f = fixture()
    f.coordinator.prepare()
    const emit = f.renderer.onError as unknown as (event: { message: string }) => void
    emit({ message: 'wgsl compilation rejected' })
    expect(f.coordinator.snapshot().error).toBe('wgsl compilation rejected')
    f.coordinator.unload()
    f.coordinator.prepare()
    f.coordinator.ready('typewriter-study', 6)
    f.coordinator.render(f.notify)
    expect(f.coordinator.snapshot()).toMatchObject({
      phase: 'ready',
      error: null,
      revision: 6,
      frames: 1,
    })
    expect(f.notify).toHaveBeenCalledTimes(1)
    f.coordinator.dispose()
  })

  it('cancels failed motion history and leaves signal-pass state cleanup to its owner', () => {
    const f = fixture()
    f.coordinator.prepare()
    f.coordinator.ready('typewriter-study', 7)
    let boundTarget = 'visitor-output'
    f.signals.render.mockImplementationOnce(() => {
      const previous = boundTarget
      boundTarget = 'gbuffer'
      try {
        throw new Error('shader submission failed')
      } finally {
        boundTarget = previous
      }
    })
    f.invalidate.mockClear()
    f.coordinator.render(f.notify)
    expect(boundTarget).toBe('visitor-output')
    expect(f.motion.cancelFrame).toHaveBeenCalledTimes(1)
    expect(f.motion.commitFrame).not.toHaveBeenCalled()
    expect(f.clock.frame).toHaveBeenCalledTimes(1)
    expect(f.calls.at(-1)).toBe('clock:finish')
    expect(f.notify).not.toHaveBeenCalled()
    expect(f.invalidate).not.toHaveBeenCalled()
    expect(f.coordinator.snapshot()).toMatchObject({
      phase: 'error',
      error: 'shader submission failed',
      frames: 0,
      firstRasterMs: null,
    })
    f.coordinator.dispose()
  })

  it('keeps the error while the scene report pauses its clock and prevents subsequent frame work', () => {
    const f = fixture()
    // WorkbenchScene responds to an error report with its effective active=false.
    // setActive reports again, so verify this path terminates without recursion.
    f.report.mockImplementation((status) => {
      if (status.error) f.coordinator.setActive(false)
    })
    f.coordinator.prepare()
    f.coordinator.ready('typewriter-study', 8)
    f.signals.render.mockImplementationOnce(() => {
      throw new Error('failed final submission')
    })
    f.invalidate.mockClear()
    f.coordinator.render(f.notify)
    expect(f.coordinator.snapshot()).toMatchObject({
      active: false,
      phase: 'error',
      error: 'failed final submission',
      frames: 0,
      firstRasterMs: null,
    })
    expect(f.clock.pause).toHaveBeenCalledTimes(1)
    expect(f.motion.cancelFrame).toHaveBeenCalledTimes(1)
    const reports = f.report.mock.calls.length
    for (let tick = 0; tick < 3; tick++) f.coordinator.render(f.notify)
    // Hiding then returning without retry remains inactive under the same
    // Scene-level error gate; it cannot restart work merely through visibility.
    f.coordinator.setActive(false)
    f.coordinator.setActive(!f.coordinator.snapshot().error)
    expect(f.clock.resume).not.toHaveBeenCalled()
    expect(f.clock.frame).toHaveBeenCalledTimes(1)
    expect(f.beforeRaster).toHaveBeenCalledTimes(1)
    expect(f.signals.render).toHaveBeenCalledTimes(1)
    expect(f.report).toHaveBeenCalledTimes(reports)
    expect(f.notify).not.toHaveBeenCalled()
    expect(f.invalidate).not.toHaveBeenCalled()
    f.coordinator.dispose()
  })

  it.each([true, false])(
    'retry explicitly restores current visible=%s clock and submits a fresh first frame only when active',
    (visible) => {
      const f = fixture()
      f.report.mockImplementation((status) => {
        if (status.error) f.coordinator.setActive(false)
      })
      f.coordinator.prepare()
      f.coordinator.ready('typewriter-study', 9)
      f.coordinator.render(f.notify)
      f.renderer.onError('late validation error')
      expect(f.coordinator.snapshot()).toMatchObject({ active: false, phase: 'error', frames: 1 })
      f.coordinator.unload()
      expect(f.coordinator.snapshot()).toMatchObject({
        active: false,
        error: null,
        phase: 'loading',
        firstRasterMs: null,
      })
      // This is the explicit activation performed by load() after unloading.
      f.coordinator.setActive(visible && !f.coordinator.snapshot().error)
      f.coordinator.prepare()
      f.beforeRaster.mockClear()
      f.notify.mockClear()
      f.coordinator.render(f.notify)
      if (!visible) {
        expect(f.coordinator.snapshot()).toMatchObject({
          active: false,
          frames: 1,
          firstRasterMs: null,
        })
        expect(f.clock.resume).not.toHaveBeenCalled()
        expect(f.beforeRaster).not.toHaveBeenCalled()
        expect(f.notify).not.toHaveBeenCalled()
        // The existing visibility watcher resumes a hidden retry when visible.
        f.coordinator.setActive(true)
        f.coordinator.render(f.notify)
      }
      expect(f.coordinator.snapshot().firstRasterMs).toBeGreaterThanOrEqual(0)
      f.coordinator.ready('typewriter-study', 10)
      expect(f.coordinator.snapshot()).toMatchObject({
        active: true,
        phase: 'ready',
        error: null,
        revision: 10,
        frames: 2,
      })
      expect(f.clock.resume).toHaveBeenCalledTimes(1)
      expect(f.beforeRaster).toHaveBeenCalledTimes(1)
      expect(f.notify).toHaveBeenCalledTimes(1)
      expect(factories.signals).toHaveBeenCalledTimes(1)
      expect(f.signals.dispose).not.toHaveBeenCalled()
      expect(f.renderer.dispose).not.toHaveBeenCalled()
      f.coordinator.dispose()
    },
  )

  it('restores sources and renderer error hooks once without disposing the Tres renderer', () => {
    const f = fixture()
    f.coordinator.prepare()
    expect(f.renderer.onError).not.toBe(f.originalError)
    f.coordinator.dispose()
    f.coordinator.dispose()
    expect(f.materials.restore).toHaveBeenCalledTimes(1)
    expect(f.signals.dispose).toHaveBeenCalledTimes(1)
    expect(f.motion.dispose).toHaveBeenCalledTimes(1)
    expect(f.clock.dispose).toHaveBeenCalledTimes(1)
    expect(f.renderer.dispose).not.toHaveBeenCalled()
    expect(f.renderer.onError).toBe(f.originalError)
    expect(f.coordinator.snapshot().disposed).toBe(true)
  })

  it('does not overwrite a newer error listener during its own disposal', () => {
    const f = fixture()
    const replacement = vi.fn<(event: string) => void>()
    f.renderer.onError = replacement
    f.coordinator.dispose()
    expect(f.renderer.onError).toBe(replacement)
  })

  it('ignores late operations after disposal rather than invoking disposed owners or scheduling frames', () => {
    const f = fixture()
    f.coordinator.prepare()
    f.coordinator.dispose()
    const snapshot = f.coordinator.snapshot(),
      resetCount = f.motion.reset.mock.calls.length
    f.invalidate.mockClear()
    f.coordinator.ready('late-product', 200)
    f.coordinator.prepare()
    f.coordinator.invalidate('materials')
    f.coordinator.setActive(true)
    f.coordinator.setSignals(false, false, false)
    f.coordinator.setInteracting(true)
    f.coordinator.unload()
    f.coordinator.render(f.notify)
    expect(f.coordinator.snapshot()).toEqual(snapshot)
    expect(f.motion.reset).toHaveBeenCalledTimes(resetCount)
    expect(f.invalidate).not.toHaveBeenCalled()
    expect(f.notify).not.toHaveBeenCalled()
  })
})

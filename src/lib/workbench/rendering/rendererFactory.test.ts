// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TresRendererSetupContext } from '@tresjs/core'
import type { WebGPURenderer } from 'three/webgpu'
import { gpuRendererFactory } from './rendererFactory'
import { isRealtimeRenderer } from './realtimeMode'
import {
  afterPreparation,
  withPreparationLease,
  waitForRetiredPreparations,
} from './preparationLease'

interface DeviceLoss {
  reason: 'destroyed' | 'unknown'
  message: string
}
const state = vi.hoisted(() => ({
  releases: 0,
  backendReleases: 0,
  gpu: true,
  releaseTriggersLoss: false,
  resolve: undefined as (() => void) | undefined,
  reject: undefined as ((cause: Error) => void) | undefined,
  nativeLoss: undefined as Promise<DeviceLoss> | undefined,
  resolveLoss: undefined as ((loss: DeviceLoss) => void) | undefined,
}))
vi.mock('three/webgpu', () => ({
  WebGPURenderer: class {
    backend = {
      isWebGPUBackend: state.gpu,
      device: { lost: state.nativeLoss },
      dispose() {
        state.backendReleases++
      },
    }
    onDeviceLost = () => {}
    init() {
      return new Promise<this>((resolve, reject) => {
        state.resolve = () => resolve(this)
        state.reject = reject
      })
    }
    dispose() {
      state.releases++
      if (state.releaseTriggersLoss)
        state.resolveLoss?.({ reason: 'destroyed', message: 'Renderer released its device' })
    }
  },
}))
const context = () => ({ canvas: document.createElement('canvas') }) as TresRendererSetupContext
beforeEach(() => {
  state.releases = 0
  state.backendReleases = 0
  state.gpu = true
  state.releaseTriggersLoss = false
  state.resolve = undefined
  state.reject = undefined
  state.nativeLoss = new Promise((resolve) => {
    state.resolveLoss = resolve
  })
})

describe('Tres-owned GPU host cancellation', () => {
  it.each(['resolve', 'reject'] as const)(
    'keeps an initialized renderer alive until native preparation settles by %s',
    async (outcome) => {
      const lost = vi.fn(),
        renderer = gpuRendererFactory(lost, true)(context()) as WebGPURenderer
      const init = renderer.init()
      state.resolve!()
      await init
      let finish!: () => void, fail!: (error: Error) => void
      const native = withPreparationLease(
        renderer,
        () =>
          new Promise<void>((resolve, reject) => {
            finish = resolve
            fail = reject
          }),
      )
      const failure = new Error('compile failed')
      const settled = outcome === 'reject' ? expect(native).rejects.toBe(failure) : native
      const cleanup = vi.fn(() => expect(state.releases).toBe(0))
      afterPreparation(renderer, cleanup)
      renderer.dispose()
      renderer.dispose()
      expect(state.releases).toBe(0)
      expect(isRealtimeRenderer(renderer)).toBe(false)
      state.resolveLoss!({ reason: 'destroyed', message: 'Retiring device loss' })
      await state.nativeLoss
      expect(lost).not.toHaveBeenCalled()
      if (outcome === 'reject') fail(failure)
      else finish()
      await settled
      await waitForRetiredPreparations()
      expect(cleanup).toHaveBeenCalledOnce()
      expect(state.releases).toBe(1)
      expect(isRealtimeRenderer(renderer)).toBe(false)
    },
  )
  it('marks only realtime hosts and clears the mark before a late initialization finishes', async () => {
    const realtime = gpuRendererFactory(vi.fn(), true)(context()) as WebGPURenderer
    const reference = gpuRendererFactory(vi.fn())(context()) as WebGPURenderer
    expect(isRealtimeRenderer(realtime)).toBe(true)
    expect(isRealtimeRenderer(reference)).toBe(false)
    const pending = realtime.init()
    realtime.dispose()
    expect(isRealtimeRenderer(realtime)).toBe(false)
    state.resolve!()
    await pending
    expect(isRealtimeRenderer(realtime)).toBe(false)
    expect(state.releases).toBe(1)
    reference.dispose()
  })

  it.each(['init-failure', 'fallback'] as const)(
    'clears realtime registration after %s',
    async (reason) => {
      state.gpu = reason !== 'fallback'
      const renderer = gpuRendererFactory(vi.fn(), true)(context()) as WebGPURenderer
      const pending = renderer.init()
      const rejection = expect(pending).rejects.toThrow()
      if (reason === 'init-failure') state.reject!(new Error('init failure'))
      else state.resolve!()
      await rejection
      expect(isRealtimeRenderer(renderer)).toBe(false)
      renderer.dispose()
    },
  )

  it('releases a device whose init finishes after the host was unmounted', async () => {
    const lost = vi.fn(),
      renderer = gpuRendererFactory(lost)(context()) as WebGPURenderer
    const pending = renderer.init()
    renderer.dispose()
    expect(state.releases).toBe(0)
    state.resolve!()
    await pending
    expect(state.releases).toBe(1)
    renderer.dispose()
    renderer.onDeviceLost({
      api: 'WebGPU',
      message: 'old device',
      reason: null,
      originalEvent: null,
    })
    expect(lost).not.toHaveBeenCalled()
    expect(state.releases).toBe(1)
  })
  it('rejects an implicit WebGL fallback and still releases the initialized host', async () => {
    state.gpu = false
    const renderer = gpuRendererFactory(vi.fn())(context()) as WebGPURenderer
    const pending = renderer.init()
    state.resolve!()
    await expect(pending).rejects.toThrow('WebGPU 设备不可用')
    renderer.dispose()
    expect(state.releases).toBe(1)
  })
  it('reports a live device loss but ignores disposal-induced notifications', async () => {
    const lost = vi.fn(),
      renderer = gpuRendererFactory(lost)(context()) as WebGPURenderer
    const pending = renderer.init()
    state.resolve!()
    await pending
    renderer.onDeviceLost({ api: 'WebGPU', message: 'lost', reason: null, originalEvent: null })
    expect(lost).toHaveBeenCalledOnce()
    renderer.dispose()
    renderer.onDeviceLost({
      api: 'WebGPU',
      message: 'destroyed',
      reason: null,
      originalEvent: null,
    })
    expect(lost).toHaveBeenCalledOnce()
  })
  it('reports the native destroyed reason even when Three omits its notification', async () => {
    const lost = vi.fn(),
      renderer = gpuRendererFactory(lost)(context()) as WebGPURenderer
    const pending = renderer.init()
    state.resolve!()
    await pending
    state.resolveLoss!({ reason: 'destroyed', message: 'Externally destroyed live GPUDevice' })
    await state.nativeLoss
    expect(lost).toHaveBeenCalledOnce()
    renderer.dispose()
    expect(state.releases).toBe(1)
  })
  it.each(['native-first', 'three-first'] as const)(
    'deduplicates native and Three device-loss signals in %s order',
    async (order) => {
      const lost = vi.fn(),
        renderer = gpuRendererFactory(lost)(context()) as WebGPURenderer
      const pending = renderer.init()
      state.resolve!()
      await pending
      const notifyThree = () =>
        renderer.onDeviceLost({
          api: 'WebGPU',
          message: 'device lost',
          reason: null,
          originalEvent: null,
        })
      if (order === 'three-first') notifyThree()
      state.resolveLoss!({ reason: 'unknown', message: 'Native loss notification' })
      await state.nativeLoss
      if (order === 'native-first') notifyThree()
      expect(lost).toHaveBeenCalledOnce()
      renderer.dispose()
      expect(state.releases).toBe(1)
    },
  )
  it('ignores native loss caused by disposing an initialized host', async () => {
    const lost = vi.fn(),
      renderer = gpuRendererFactory(lost)(context()) as WebGPURenderer
    const pending = renderer.init()
    state.resolve!()
    await pending
    state.releaseTriggersLoss = true
    renderer.dispose()
    await state.nativeLoss
    renderer.dispose()
    expect(lost).not.toHaveBeenCalled()
    expect(state.releases).toBe(1)
    expect(state.backendReleases).toBe(0)
  })
  it.each([false, true])(
    'releases a partial backend exactly once after init rejects (unmounted before failure: %s)',
    async (unmounted) => {
      const lost = vi.fn(),
        renderer = gpuRendererFactory(lost)(context()) as WebGPURenderer,
        cause = new Error('GPU initialization failed after partial allocation')
      const pending = renderer.init(),
        rejection = expect(pending).rejects.toBe(cause)
      if (unmounted) renderer.dispose()
      state.reject!(cause)
      await rejection
      renderer.dispose()
      renderer.dispose()
      state.resolveLoss!({ reason: 'destroyed', message: 'Partial device cleanup' })
      await state.nativeLoss
      renderer.onDeviceLost({
        api: 'WebGPU',
        message: 'partial device lost',
        reason: null,
        originalEvent: null,
      })
      expect(state.backendReleases).toBe(1)
      expect(state.releases).toBe(0)
      expect(lost).not.toHaveBeenCalled()
    },
  )
})

import { unref } from 'vue'
import type { RendererOptions } from '@tresjs/core'
import { WebGPURenderer } from 'three/webgpu'
import { registerRealtimeRenderer } from './realtimeMode'
import { retirePreparedRenderer, withPreparationLease } from './preparationLease'

/** Tres owns construction/init/disposal. Never create a second renderer probe. */
export function gpuRendererFactory(
  onLost: () => void,
  realtime = false,
): NonNullable<RendererOptions['renderer']> {
  return ({ canvas }) => {
    const renderer = new WebGPURenderer({
      canvas: unref(canvas),
      antialias: true,
      powerPreference: 'high-performance',
      // Explicit diagnostics only. Ordinary visitor rendering has no query readback.
      trackTimestamp: new URLSearchParams(location.search).get('renderDiagnostics') === '1',
      // WebGPU charges aligned attachment costs, not texture storage bytes.
      // The six-signal G-buffer costs 44; unsupported adapters fail explicitly.
      requiredLimits: realtime ? { maxColorAttachmentBytesPerSample: 64 } : undefined,
    })
    const releaseRealtimeMode = realtime ? registerRealtimeRenderer(renderer) : undefined
    const init = renderer.init.bind(renderer),
      dispose = renderer.dispose.bind(renderer)
    let disposed = false,
      initialized = false,
      released = false,
      reportedLoss = false
    const reportLoss = () => {
      if (!disposed && !reportedLoss) {
        reportedLoss = true
        onLost()
      }
    }
    const release = () => {
      if (!released && initialized) {
        released = true
        dispose()
      }
    }
    renderer.dispose = () => {
      disposed = true
      releaseRealtimeMode?.()
      retirePreparedRenderer(renderer, release)
    }
    renderer.init = () =>
      withPreparationLease(renderer, async () => {
        try {
          await init()
        } catch (cause) {
          disposed = true
          releaseRealtimeMode?.()
          if (!released) {
            released = true
            if ('dispose' in renderer.backend && typeof renderer.backend.dispose === 'function')
              renderer.backend.dispose()
          }
          throw cause
        }
        initialized = true
        if (disposed) {
          // The registered retirement finalizer runs after this init lease settles.
          return renderer
        }
        if (!('isWebGPUBackend' in renderer.backend) || !renderer.backend.isWebGPUBackend) {
          releaseRealtimeMode?.()
          throw new Error('WebGPU 设备不可用，请使用兼容模式。')
        }
        // Three intentionally ignores reason="destroyed". Observe the native loss
        // too: a live device destroyed externally still needs host recovery.
        const device: unknown = Reflect.get(renderer.backend, 'device')
        if (
          device &&
          typeof device === 'object' &&
          'lost' in device &&
          device.lost instanceof Promise
        )
          void device.lost.then(reportLoss)
        renderer.onDeviceLost = reportLoss
        return renderer
      })
    return renderer
  }
}

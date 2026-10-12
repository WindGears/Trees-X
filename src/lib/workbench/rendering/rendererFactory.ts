import { unref } from 'vue'
import type { RendererOptions } from '@tresjs/core'
import { WebGPURenderer } from 'three/webgpu'

/** Tres owns construction/init/disposal. Never create a second renderer probe. */
export function gpuRendererFactory(onLost: () => void): NonNullable<RendererOptions['renderer']> {
  return ({ canvas }) => {
    const renderer = new WebGPURenderer({ canvas: unref(canvas), antialias: true })
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
      release()
    }
    renderer.init = async () => {
      try {
        await init()
      } catch (cause) {
        disposed = true
        if (!released) {
          released = true
          if ('dispose' in renderer.backend && typeof renderer.backend.dispose === 'function')
            renderer.backend.dispose()
        }
        throw cause
      }
      initialized = true
      if (disposed) {
        release()
        return renderer
      }
      if (!('isWebGPUBackend' in renderer.backend) || !renderer.backend.isWebGPUBackend)
        throw new Error('WebGPU 设备不可用，请使用兼容模式。')
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
      return renderer
    }
    renderer.onDeviceLost = reportLoss
    return renderer
  }
}

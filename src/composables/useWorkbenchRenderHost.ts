import { nextTick, onMounted, onScopeDispose, ref, shallowRef, watch } from 'vue'
import type { RendererOptions } from '@tresjs/core'
import type { CameraSnapshot } from '@/lib/workbench/cameraCapture'
import { requestedBackend, recoveryBackend } from '@/lib/workbench/rendering/hostPolicy'
import { supportsWebGL2 } from '@/lib/workbench/renderSupport'
import { useWorkbenchStore } from '@/stores/workbench'
import { realtimeProductProfile } from '@/lib/workbench/rendering/realtime/productProfile'
import { waitForRetiredPreparations } from '@/lib/workbench/rendering/preparationLease'

/** Replacement always unmounts the old Tres host before preparing its successor. */
export function useWorkbenchRenderHost(capture: () => CameraSnapshot | undefined) {
  const store = useWorkbenchStore(),
    realtimeRequest = new URLSearchParams(location.search).get('renderPipeline') === 'realtime',
    eligible = 'gpu' in navigator && matchMedia('(pointer: fine)').matches && innerWidth >= 1024,
    backend = ref(requestedBackend(location.search, 'gpu' in navigator, eligible)),
    rendererFactory = shallowRef<RendererOptions['renderer']>(),
    hostPrepared = ref(backend.value === 'webgl'),
    hostRevision = ref(0),
    checkpoint = shallowRef<CameraSnapshot>(),
    notice = ref('')
  let deviceRetries = 0,
    replacing = false,
    hostGeneration = 0,
    disposed = false,
    failedGpu = false
  const isRealtimeProduct = () => {
    const source = store.presentation?.source
    return source?.kind === 'glb' && Boolean(realtimeProductProfile(source.adapter))
  }
  // Management previews install their configuration before mounting the host.
  // Do not briefly construct a GPU rigid-motion host for a morphing piano.
  if (realtimeRequest && store.presentation && !isRealtimeProduct()) {
    backend.value = 'webgl'
    hostPrepared.value = true
    notice.value = 'WebGL · 当前展品沿用原有管线'
  }
  if (backend.value === 'webgl' && !supportsWebGL2())
    store.useContent('此设备暂时无法启用三维显示。')
  if (
    ['hybrid', 'realtime'].includes(
      new URLSearchParams(location.search).get('renderPipeline') ?? '',
    ) &&
    backend.value === 'webgl' &&
    !notice.value
  )
    notice.value = 'WebGL 兼容模式 · 此设备未启用 WebGPU'
  async function prepareHost(token = hostGeneration) {
    if (disposed || token !== hostGeneration) return
    if (backend.value === 'webgpu') {
      const { gpuRendererFactory } = await import('@/lib/workbench/rendering/rendererFactory')
      if (disposed || token !== hostGeneration) return
      rendererFactory.value = gpuRendererFactory(() => {
        if (!disposed && token === hostGeneration) void recoverDevice()
      }, realtimeRequest)
    } else rendererFactory.value = undefined
    hostPrepared.value = true
  }
  async function replaceHost(next: 'webgpu' | 'webgl') {
    if (replacing || disposed) return
    replacing = true
    const token = ++hostGeneration
    hostPrepared.value = false
    await nextTick()
    await waitForRetiredPreparations()
    if (disposed || token !== hostGeneration) return
    backend.value = next
    hostRevision.value++
    if (store.product) {
      store.status = 'loading'
      store.error = ''
    }
    let failed = false
    try {
      await prepareHost(token)
    } catch {
      failed = true
    } finally {
      replacing = false
      // A quick selection during replacement is reconciled only after teardown.
      if (failed) rendererFailed()
      else reconcile()
    }
  }
  async function recoverDevice() {
    checkpoint.value = capture()
    const next = recoveryBackend(backend.value, deviceRetries++)
    if (next === 'webgl') {
      failedGpu = true
      notice.value = 'WebGL 兼容模式 · WebGPU 设备未能恢复'
    }
    await replaceHost(next)
  }
  function rendererFailed() {
    if (disposed) return
    if (backend.value === 'webgpu') {
      failedGpu = true
      notice.value = 'WebGL 兼容模式 · WebGPU 启动失败'
      void replaceHost('webgl')
    } else store.useContent('三维显示启动失败，已保留商品图文。')
  }
  function reconcile() {
    if (!realtimeRequest || !store.presentation || disposed || replacing || failedGpu || !eligible)
      return
    const next = isRealtimeProduct() ? 'webgpu' : 'webgl'
    notice.value = next === 'webgl' ? 'WebGL · 当前展品沿用原有管线' : ''
    if (backend.value !== next) void replaceHost(next)
  }
  watch(() => store.presentation, reconcile, { flush: 'sync' })
  onMounted(() => {
    void prepareHost().catch(rendererFailed)
  })
  onScopeDispose(() => {
    disposed = true
    hostGeneration++
  })
  return {
    backend,
    rendererFactory,
    hostPrepared,
    hostRevision,
    checkpoint,
    notice,
    rendererFailed,
    realtimeRequest,
  }
}

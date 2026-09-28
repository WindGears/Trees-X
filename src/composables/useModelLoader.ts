import { onScopeDispose, ref, shallowRef, watch } from 'vue'
import type { Ref } from 'vue'
import type { Group } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'
import { disposeModel, inspectModel, MODEL_BUDGET, normalizeModel } from '@/lib/three/model'
import type { ModelStatus } from '@/stores/product'

export function useModelLoader(url: Ref<string>, prepare?: (model: Group) => () => void) {
  const model = shallowRef<Group | null>(null)
  const status = ref<ModelStatus>('loading')
  const error = ref('')
  let controller: AbortController | undefined
  let generation = 0
  let cleanup: (() => void) | undefined

  function release() {
    cleanup?.()
    cleanup = undefined
    if (model.value) disposeModel(model.value)
    model.value = null
  }

  async function load() {
    const current = ++generation
    controller?.abort()
    controller = new AbortController()
    const signal = controller.signal
    release()
    status.value = 'loading'
    error.value = ''
    const timeout = window.setTimeout(
      () => controller?.signal === signal && controller.abort(),
      20_000,
    )
    let loaded: Group | undefined
    let decoder: DRACOLoader | undefined
    try {
      const response = await fetch(url.value, { signal })
      if (!response.ok) throw new Error(`模型请求失败（${response.status}）。`)
      if (Number(response.headers.get('content-length')) > MODEL_BUDGET.bytes) {
        throw new Error('模型文件超过 5 MB，请优化后重试。')
      }
      const buffer = await response.arrayBuffer()
      if (current !== generation) return
      if (signal.aborted) throw new Error('加载超时，请重试。')
      if (buffer.byteLength > MODEL_BUDGET.bytes)
        throw new Error('模型文件超过 5 MB，请优化后重试。')
      if (buffer.byteLength < 12 || new DataView(buffer).getUint32(0, true) !== 0x46546c67) {
        throw new Error('文件不是有效的 GLB 模型。')
      }
      const base = new URL('.', new URL(url.value, window.location.href)).href
      decoder = new DRACOLoader()
        .setDecoderPath(`${import.meta.env.BASE_URL}draco/`)
        .setDecoderConfig({ type: 'wasm' })
        .setWorkerLimit(1)
      loaded = (await new GLTFLoader().setDRACOLoader(decoder).parseAsync(buffer, base)).scene
      if (current !== generation || signal.aborted) {
        disposeModel(loaded)
        loaded = undefined
        if (current === generation) throw new Error('加载超时，请重试。')
        return
      }
      inspectModel(loaded)
      normalizeModel(loaded)
      cleanup = prepare?.(loaded)
      model.value = loaded
      status.value = 'ready'
    } catch (cause) {
      if (current === generation) {
        cleanup?.()
        cleanup = undefined
      }
      if (loaded) disposeModel(loaded)
      if (current !== generation) return
      error.value = signal.aborted
        ? '加载超时，请检查连接后重试。'
        : cause instanceof Error
          ? cause.message
          : '模型暂时无法加载。'
      status.value = 'error'
    } finally {
      decoder?.dispose()
      window.clearTimeout(timeout)
    }
  }

  watch(url, load, { immediate: true })
  onScopeDispose(() => {
    generation += 1
    controller?.abort()
    release()
  })
  return { model, status, error, retry: load }
}

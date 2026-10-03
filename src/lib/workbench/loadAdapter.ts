import type { WebGLRenderer, WebGLRenderTarget } from 'three'
import { createSampleAdapter, type SceneAdapter } from './adapter'
import { loadBundle, type LoadPhase } from './assetBundle'
import type { WorkbenchProduct } from './types'

export async function loadAdapter(
  product: WorkbenchProduct,
  renderer: WebGLRenderer,
  signal: AbortSignal,
  phase: (p: LoadPhase) => void,
): Promise<SceneAdapter> {
  signal.throwIfAborted()
  if (product.presentation.source.kind === 'procedural') {
    phase('parse')
    return createSampleAdapter(product)
  }
  const source = product.presentation.source
  const { bundle, bytes } = await loadBundle(source.bundle, signal, phase)
  let decoded: Awaited<ReturnType<(typeof import('./glbLoader'))['decodeGlb']>> | undefined
  let adapter: SceneAdapter | undefined, environment: WebGLRenderTarget | undefined
  try {
    phase('parse')
    const [{ decodeGlb }, { bindGlb }] = await Promise.all([
      import('./glbLoader'),
      import('./glbAdapter'),
    ])
    signal.throwIfAborted()
    decoded = await decodeGlb(bundle, bytes, renderer, signal)
    phase('materials')
    adapter = bindGlb(product, source, decoded.root, decoded.dispose)
    if (
      !adapter.root.userData.triangles ||
      adapter.root.userData.triangles > bundle.budget.maxTriangles
    )
      throw new Error('模型几何超出该资源包登记的预算')
    const envFile = product.presentation.stage?.environmentFile
    if (envFile) {
      const envBytes = bytes.get(envFile)
      if (
        !envBytes ||
        !bundle.files.some((f) => f.path === envFile && f.role === 'environment') ||
        !/\.(hdr|exr)$/.test(envFile)
      )
        throw new Error('商品光照资源未正确登记')
      const { createAssetEnvironment } = await import('./assetEnvironment')
      signal.throwIfAborted()
      environment = createAssetEnvironment(envFile, envBytes, renderer)
    }
    signal.throwIfAborted()
    const current = adapter
    let disposed = false
    return {
      ...current,
      environment: environment?.texture,
      dispose() {
        if (disposed) return
        disposed = true
        current.dispose()
        environment?.dispose()
      },
    }
  } catch (error) {
    if (adapter) adapter.dispose()
    else decoded?.dispose()
    environment?.dispose()
    throw error
  } finally {
    bytes.clear()
  }
}

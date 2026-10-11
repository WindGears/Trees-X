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
    if (source.adapter === 'typewriter-v1') {
      const program = product.presentation.actions.find((a) => a.motion?.program)?.motion?.program
      if (!program || !bundle.files.some((f) => f.path === program.file && f.role === 'motion'))
        throw new Error('打字机缺少登记的部件动作资源')
      const data = bytes.get(program.file)
      if (!data) throw new Error('打字机动作资源读取失败')
      const { bindTypewriter } = await import('./typewriterAdapter')
      signal.throwIfAborted()
      adapter = bindTypewriter(
        product,
        source,
        decoded.root,
        JSON.parse(new TextDecoder().decode(data)) as unknown,
        decoded.dispose,
      )
    } else if (source.adapter === 'piano-v1') {
      const program = product.presentation.actions.find(
        (a) => a.motion?.program?.type === 'piano-sound-path-v1',
      )?.motion?.program
      if (!program || !bundle.files.some((f) => f.path === program.file && f.role === 'motion'))
        throw new Error('钢琴缺少登记的结构动作资源')
      const data = bytes.get(program.file)
      if (!data) throw new Error('钢琴动作资源读取失败')
      const { bindPiano } = await import('./pianoAdapter')
      signal.throwIfAborted()
      adapter = bindPiano(
        product,
        source,
        decoded.root,
        decoded.animations,
        JSON.parse(new TextDecoder().decode(data)) as unknown,
        decoded.dispose,
      )
    } else if (source.adapter === 'reventon-v1') {
      const { bindReventon } = await import('./reventonAdapter')
      signal.throwIfAborted()
      adapter = bindReventon(product, source, decoded.root, decoded.dispose)
    } else adapter = bindGlb(product, source, decoded.root, decoded.dispose)
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
    } else if (source.adapter === 'typewriter-v1') {
      const { createStudioEnvironment } = await import('./studio/geometry')
      signal.throwIfAborted()
      environment = createStudioEnvironment(renderer, product.presentation.stage?.groundY)
    } else if (source.adapter === 'piano-v1') {
      const { createPianoEnvironment } = await import('./pianoEnvironment')
      signal.throwIfAborted()
      environment = createPianoEnvironment(renderer)
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

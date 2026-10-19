import { createSampleAdapter, type SceneAdapter } from './adapter'
import type { LoadPhase } from './assetBundle'
import { openAssetSession, openLegacyAssetSession, useStreamingAssets } from './assetSession'
import type { WorkbenchProduct } from './types'
import { isWebGpuRenderer, type WorkbenchRenderer } from './rendering/rendererTypes'
import { createProductEnvironment, type OwnedEnvironment } from './rendering/environment'
import { typewriterCandidate } from './typewriterCandidate'

export async function loadAdapter(
  product: WorkbenchProduct,
  renderer: WorkbenchRenderer,
  signal: AbortSignal,
  phase: (p: LoadPhase) => void,
): Promise<SceneAdapter> {
  signal.throwIfAborted()
  if (product.presentation.source.kind === 'procedural') {
    phase('parse')
    return createSampleAdapter(product)
  }
  const source = typewriterCandidate(product.presentation.source, location.search)
  const session = await (
    useStreamingAssets(source, location.search) ? openAssetSession : openLegacyAssetSession
  )(source.bundle, signal, phase)
  const { bundle, signal: sessionSignal } = session
  let decoded: Awaited<ReturnType<(typeof import('./glbLoader'))['decodeGlb']>> | undefined
  let adapter: SceneAdapter | undefined, environment: OwnedEnvironment | undefined
  try {
    phase('parse')
    const [{ decodeGlb }, { bindGlb }] = await Promise.all([
      import('./glbLoader'),
      import('./glbAdapter'),
    ])
    signal.throwIfAborted()
    decoded = await decodeGlb(bundle, session, renderer, sessionSignal)
    phase('materials')
    if (source.adapter === 'typewriter-v1') {
      const program = product.presentation.actions.find((a) => a.motion?.program)?.motion?.program
      if (!program || !bundle.files.some((f) => f.path === program.file && f.role === 'motion'))
        throw new Error('打字机缺少登记的部件动作资源')
      const data = await session.read(program.file)
      let motion: unknown
      try {
        motion = JSON.parse(new TextDecoder().decode(data)) as unknown
      } finally {
        session.release(program.file)
      }
      const { bindTypewriter } = await import('./typewriterAdapter')
      const studio = isWebGpuRenderer(renderer)
        ? (await import('./rendering/studio')).createWorkbenchStudio
        : undefined
      signal.throwIfAborted()
      adapter = bindTypewriter(product, source, decoded.root, motion, decoded.dispose, studio)
    } else if (source.adapter === 'piano-v1') {
      const program = product.presentation.actions.find(
        (a) => a.motion?.program?.type === 'piano-sound-path-v1',
      )?.motion?.program
      if (!program || !bundle.files.some((f) => f.path === program.file && f.role === 'motion'))
        throw new Error('钢琴缺少登记的结构动作资源')
      const data = await session.read(program.file)
      let motion: unknown
      try {
        motion = JSON.parse(new TextDecoder().decode(data)) as unknown
      } finally {
        session.release(program.file)
      }
      const { bindPiano } = await import('./pianoAdapter')
      signal.throwIfAborted()
      adapter = bindPiano(
        product,
        source,
        decoded.root,
        decoded.animations,
        motion,
        decoded.dispose,
      )
    } else if (source.adapter === 'reventon-v1') {
      const { bindReventon } = await import('./reventonAdapter')
      const gpu = isWebGpuRenderer(renderer)
        ? (await import('./rendering/reventon')).reventonGpuDependencies
        : undefined
      signal.throwIfAborted()
      adapter = bindReventon(product, source, decoded.root, decoded.dispose, gpu)
    } else adapter = bindGlb(product, source, decoded.root, decoded.dispose)
    if (
      !adapter.root.userData.triangles ||
      adapter.root.userData.triangles > bundle.budget.maxTriangles
    )
      throw new Error('模型几何超出该资源包登记的预算')
    const envFile = product.presentation.stage?.environmentFile
    if (envFile) {
      if (
        !bundle.files.some((f) => f.path === envFile && f.role === 'environment') ||
        !/\.(hdr|exr)$/.test(envFile)
      )
        throw new Error('商品光照资源未正确登记')
      signal.throwIfAborted()
      const envBytes = await session.read(envFile)
      try {
        environment = await createProductEnvironment(
          renderer,
          source.adapter,
          product.presentation.stage?.groundY,
          envFile,
          envBytes,
          sessionSignal,
        )
      } finally {
        session.release(envFile)
      }
    } else
      environment = await createProductEnvironment(
        renderer,
        source.adapter,
        product.presentation.stage?.groundY,
        undefined,
        undefined,
        signal,
      )
    signal.throwIfAborted()
    const current = adapter
    current.root.userData.bundleVersion = bundle.version
    current.root.userData.bundleSha256 = source.bundle.sha256
    let disposed = false
    return {
      ...current,
      environment: environment?.texture,
      traceBackground: environment?.background,
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
    session.dispose()
  }
}

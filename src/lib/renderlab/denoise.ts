import { NoToneMapping, UnsignedByteType, NearestFilter, type Texture } from 'three'
import { QuadMesh, RenderTarget, type WebGPURenderer } from 'three/webgpu'
import { diffuseColor, mrt, normalView, vec4 } from 'three/tsl'
import type { LabScene } from './scene'
import type { initUNetFromBuffer } from 'oidn-web'

/** Independent comparison only: shares the lab renderer and GPUDevice. */
export async function createLabDenoise(renderer: WebGPURenderer, shared: LabScene) {
  const [{ OIDNDenoiser, RenderToScreenNodeMaterial }, { UNet, parseTZA }] = await Promise.all([
    import('three-gpu-pathtracer/webgpu'),
    import('oidn-web'),
  ])
  const abort = new AbortController()
  let disposed = false,
    failure: unknown,
    runtimeInfo: (() => unknown) | undefined
  const denoiser = new OIDNDenoiser({
    auxWeightsUrl: '/models/denoise/rt_hdr_alb_nrm.tza',
    useAuxiliaryBuffers: true,
    initUNetFromURL: async () => {
      try {
        const response = await fetch('/models/denoise/rt_hdr_alb_nrm.tza', { signal: abort.signal })
        if (!response.ok) throw new Error(`OIDN weights HTTP ${response.status}`)
        const buffer = await response.arrayBuffer()
        const sha = Array.from(
          new Uint8Array(await crypto.subtle.digest('SHA-256', buffer)),
          (byte) => byte.toString(16).padStart(2, '0'),
        ).join('')
        if (
          buffer.byteLength !== 1841160 ||
          sha !== 'e586ef2ff48d7fbb7611986405220ed8fc5c13ca79bfc40be4dc742fbf959e1a'
        )
          throw new Error('OIDN weights digest mismatch')
        const backend = renderer.backend as unknown as NonNullable<
          Parameters<typeof initUNetFromBuffer>[1]
        >
        const unet = new UNet(parseTZA(buffer), backend.device, {
          aux: true,
          hdr: true,
          engine: 'wgsl',
        })
        try {
          await unet.prepare()
        } catch (error) {
          unet.dispose()
          throw error
        }
        if (disposed || abort.signal.aborted) {
          unet.dispose()
          throw new DOMException('Comparison disposed', 'AbortError')
        }
        let released = false
        runtimeInfo = () => unet.getRuntimeInfo()
        return {
          tileExecute(inputs: Record<string, unknown>) {
            return unet.tileExecute({
              ...inputs,
              error: (reason: unknown) => {
                failure = reason
              },
            } as Parameters<typeof unet.tileExecute>[0])
          },
          dispose() {
            if (!released) {
              released = true
              unet.dispose()
            }
          },
        }
      } catch (error) {
        failure = error
        // The third-party adapter disposes a cached promise without a rejection
        // handler. Failed/cancelled initialization owns no network or GPU buffers.
        return { tileExecute: () => () => {}, dispose() {} }
      }
    },
  })
  denoiser.init(renderer)
  denoiser.setScene(shared.scene, shared.camera)
  const material = new RenderToScreenNodeMaterial(),
    quad = new QuadMesh(material),
    guides = new RenderTarget(renderer.domElement.width, renderer.domElement.height, {
      count: 2,
      type: UnsignedByteType,
      minFilter: NearestFilter,
      magFilter: NearestFilter,
    })
  material.toneMapping = renderer.toneMapping
  material.exposure = renderer.toneMappingExposure
  // This adapter expects the legacy FullScreenQuad UV orientation. Flip only
  // its presentation quad; render targets and guide buffers keep their own UVs.
  quad.scale.y = -1
  return {
    async execute(color: Texture) {
      if (disposed) throw new Error('Denoising comparison disposed')
      denoiser.reset()
      failure = undefined
      const started = performance.now(),
        originalTarget = renderer.getRenderTarget(),
        originalMRT = renderer.getMRT(),
        originalToneMapping = renderer.toneMapping
      try {
        renderer.setRenderTarget(guides)
        renderer.setMRT(
          mrt({ output: diffuseColor, normal: vec4(normalView.mul(0.5).add(0.5), 1) }),
        )
        renderer.toneMapping = NoToneMapping
        renderer.render(shared.scene, shared.camera)
      } finally {
        renderer.setRenderTarget(originalTarget)
        renderer.setMRT(originalMRT)
        renderer.toneMapping = originalToneMapping
      }
      await denoiser.denoise(color, guides.textures[0]!, guides.textures[1]!)
      const deadline = performance.now() + 180000
      while (!denoiser.complete) {
        if (disposed) throw new Error('Comparison disposed')
        if (failure) throw failure
        if (performance.now() > deadline) throw new Error('OIDN comparison timed out')
        await new Promise<void>((resolve) => setTimeout(resolve, 16))
      }
      if (!denoiser.texture) throw new Error('Completed OIDN texture absent')
      material.texture = denoiser.texture
      material.fromTexture = denoiser.texture
      material.transition = 1
      return {
        elapsedMs: performance.now() - started,
        runtime: runtimeInfo?.(),
        complete: true,
        hdr: true,
        auxiliary: ['albedo', 'normal'],
        precision: 'auto; native WGSL',
        weights: '/models/denoise/rt_hdr_alb_nrm.tza',
      }
    },
    present() {
      if (disposed || !denoiser.complete) throw new Error('Complete OIDN output unavailable')
      const original = renderer.toneMapping
      try {
        renderer.toneMapping = NoToneMapping
        quad.render(renderer)
      } finally {
        renderer.toneMapping = original
      }
    },
    dispose() {
      if (disposed) return
      disposed = true
      abort.abort()
      denoiser.dispose()
      guides.dispose()
      material.dispose()
      // QuadMesh geometry is Three's library-shared object, not a lab-owned copy.
    },
  }
}

export type LabDenoise = Awaited<ReturnType<typeof createLabDenoise>>

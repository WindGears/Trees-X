declare module 'three-gpu-pathtracer/webgpu' {
  import type { Camera, Scene, Texture, WebGPURenderer, MeshBasicNodeMaterial } from 'three/webgpu'
  export interface SampleCounts {
    min: number
    max: number
    avg: number
    samplesPerSecond: number
  }
  // Verified against installed 0.0.27 src/webgpu/WebGPUPathTracer.js.
  // Its package only ships declarations for the older WebGL entry.
  export class WebGPUPathTracer {
    constructor(renderer: WebGPURenderer)
    maxBounces: number
    maxTransparentBounces: number
    maxSamples: number
    minSamples: number
    frameBudget: number
    renderScale: number
    dynamicLowRes: boolean
    renderDelay: number
    fadeDuration: number
    filterGlossyFactor: number
    stableNoise: boolean
    multipleImportanceSampling: boolean
    generateMissingAttributes: boolean
    clampDirect: number
    clampIndirect: number
    pause: boolean
    readonly target: Texture | null
    setScene(scene: Scene, camera: Camera): void
    updateCamera(): void
    updateTransforms(): void
    updateMaterials(): void
    updateEnvironment(): void
    updateLights(): void
    reset(): void
    renderSample(): void
    getSampleCountsAsync(): Promise<SampleCounts>
    dispose(): void
  }
  export class RenderToScreenNodeMaterial extends MeshBasicNodeMaterial {
    texture: Texture | null
    fromTexture: Texture | null
    toneMapping: number
    transition: number
    exposure: number
  }
  export class OIDNDenoiser {
    constructor(options: {
      initUNetFromURL: (
        url: string,
        backend: unknown,
        options: unknown,
      ) => Promise<{
        tileExecute(inputs: Record<string, unknown>): () => void
        dispose(): void
      }>
      auxWeightsUrl: string
      useAuxiliaryBuffers?: boolean
      maxTileSize?: number | null
    })
    readonly texture: Texture | null
    readonly complete: boolean
    readonly running: boolean
    init(renderer: WebGPURenderer): void
    setScene(scene: Scene, camera: Camera): void
    denoise(color: Texture, albedo?: Texture | null, normal?: Texture | null): Promise<void>
    reset(): void
    dispose(): void
  }
}

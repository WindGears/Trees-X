declare module 'three-gpu-pathtracer/webgpu' {
  import type { Camera, Scene, WebGPURenderer } from 'three/webgpu'
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
    frameBudget: number
    renderScale: number
    dynamicLowRes: boolean
    filterGlossyFactor: number
    stableNoise: boolean
    multipleImportanceSampling: boolean
    generateMissingAttributes: boolean
    clampDirect: number
    clampIndirect: number
    pause: boolean
    setScene(scene: Scene, camera: Camera): void
    renderSample(): void
    getSampleCountsAsync(): Promise<SampleCounts>
    dispose(): void
  }
}

import type { PerspectiveCamera, Scene, Texture } from 'three'
import type { WebGPURenderer } from 'three/webgpu'

export type RefinementPhase =
  | 'raster'
  | 'waiting'
  | 'preparing'
  | 'sampling'
  | 'denoising'
  | 'blending'
  | 'ready'
  | 'realtime'
  | 'paused'
  | 'error'

export type RefinementChange =
  | 'camera'
  | 'camera-cut'
  | 'pose'
  | 'pose-jump'
  | 'materials'
  | 'lights'
  | 'environment'
  | 'size'
  | 'all'

export interface RefinementStatus {
  phase: RefinementPhase
  slug: string | null
  revision: number
  generation: number
  samples: { min: number; max: number; avg: number } | null
  target: 128 | 1024
  realtime: boolean
  error: string | null
}

/** Owns derived objects only; original loader resources remain with the adapter. */
export interface TracingScene {
  scene: Scene
  sync(): void
  dispose(): void
}

export interface HybridCoordinatorOptions {
  renderer: WebGPURenderer
  scene: Scene
  camera: PerspectiveCamera
  invalidate(): void
  beforeRaster(): void
  report(status: RefinementStatus): void
  prepareTracing?(scene: Scene): TracingScene | Promise<TracingScene>
  reducedMotion?: () => boolean
}

export interface HybridSnapshot extends RefinementStatus {
  rasterFrames: number
  sampleFrames: number
  presentations: number
  sampleReads: number
  tracingMeshes: number
  firstRasterMs: number | null
  firstRefinedMs: number | null
  denoiseMs: number | null
  active: boolean
  interacting: boolean
  disposed: boolean
}

export interface TracingDriver {
  maxBounces: number
  maxTransparentBounces: number
  maxSamples: number
  minSamples: number
  frameBudget: number
  renderScale: number
  dynamicLowRes: boolean
  renderDelay: number
  fadeDuration: number
  stableNoise: boolean
  multipleImportanceSampling: boolean
  generateMissingAttributes: boolean
  clampDirect: number
  clampIndirect: number
  pause: boolean
  readonly target: Texture | null
  setScene(scene: Scene, camera: PerspectiveCamera): void
  updateTransforms(): void
  updateMaterials(): void
  updateCamera(): void
  updateLights(): void
  updateEnvironment(): void
  reset(): void
  renderSample(): void
  getSampleCountsAsync(): Promise<{ min: number; max: number; avg: number }>
  dispose(): void
}

export interface DenoisingDriver {
  readonly texture: Texture | null
  readonly complete: boolean
  readonly running: boolean
  init(renderer: WebGPURenderer): void
  setScene(scene: Scene, camera: PerspectiveCamera): void
  denoise(color: Texture, albedo: Texture, normal: Texture): Promise<void>
  reset(): void
  dispose(): void
}

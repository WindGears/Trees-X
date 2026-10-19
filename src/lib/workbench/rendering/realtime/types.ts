import type { PerspectiveCamera, Scene } from 'three'
import type { WebGPURenderer } from 'three/webgpu'
import type { RefinementChange } from '../refinementTypes'
import type { ReflectionSamplingSnapshot } from './reflectionSampling'
import type { RealtimeProductProfile } from './productProfile'

export interface RealtimeStatus {
  phase: 'loading' | 'ready' | 'paused' | 'error'
  slug: string | null
  revision: number
  generation: number
  error: string | null
  indirectLighting?: {
    requested: 'ssgi' | 'ddgi'
    actual: 'ssgi' | 'ddgi'
    preparing: boolean
    error: string | null
  }
}

export interface RealtimeSnapshot extends RealtimeStatus {
  frames: number
  firstRasterMs: number | null
  active: boolean
  disposed: boolean
  historyResets: number
  motion: { objects: number; instances: number; historyBytes: number; frameOpen: boolean }
  signals: { ssr: boolean; ssgi: boolean; denoise: boolean }
  reflectionKernel?: ReflectionSamplingSnapshot | null
  resolution: { width: number; height: number }
  materialBranches: Record<string, number>
  productProfile?: RealtimeProductProfile['adapterId']
  indirectLighting?: {
    requested: 'ssgi' | 'ddgi'
    actual: 'ssgi' | 'ddgi'
    preparing: boolean
    error: string | null
    details: unknown
  }
}

export interface RealtimeOptions {
  renderer: WebGPURenderer
  scene: Scene
  camera: PerspectiveCamera
  profile?: RealtimeProductProfile
  beforeRaster(): void
  invalidate(): void
  report(status: RealtimeStatus): void
}

export type RealtimeChange = RefinementChange

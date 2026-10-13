import type { PerspectiveCamera, Scene } from 'three'
import type { WebGPURenderer } from 'three/webgpu'
import type { RefinementChange } from '../refinementTypes'

export interface RealtimeStatus {
  phase: 'loading' | 'ready' | 'paused' | 'error'
  slug: string | null
  revision: number
  generation: number
  error: string | null
}

export interface RealtimeSnapshot extends RealtimeStatus {
  frames: number
  firstRasterMs: number | null
  active: boolean
  disposed: boolean
  historyResets: number
  motion: { objects: number; instances: number; historyBytes: number; frameOpen: boolean }
  signals: { ssr: boolean; ssgi: boolean; denoise: boolean }
  resolution: { width: number; height: number }
  materialBranches: Record<string, number>
}

export interface RealtimeOptions {
  renderer: WebGPURenderer
  scene: Scene
  camera: PerspectiveCamera
  beforeRaster(): void
  invalidate(): void
  report(status: RealtimeStatus): void
}

export type RealtimeChange = RefinementChange

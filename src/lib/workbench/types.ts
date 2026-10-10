export type Vec3 = [number, number, number]
export type SampleKey = 'speaker' | 'typewriter' | 'car'
export type Panel = 'catalog' | 'appearance' | 'details' | 'actions' | 'guide'
export interface View {
  id: string
  label: string
  position: Vec3
  target: Vec3
}
export interface Hotspot {
  id: string
  node: string
  name: string
  description: string
  cameraOffset: Vec3
  anchor?: Vec3
  group?: string
  marker?: boolean
}
export interface Finish {
  id: string
  name: string
  color: string
}
export interface Action {
  id: string
  label: string
  kind: 'toggle' | 'pulse' | 'progress'
  node: string
  behavior?:
    | { type: 'rotate' | 'translate'; axis: Vec3; amount: number }
    | { type: 'typewriter-strike'; index: number }
  motion?: ProgressMotion
}
export type MotionTrack = { node: string; range: [number, number] } & (
  { type: 'translate'; offset: Vec3 } | { type: 'rotate'; axis: Vec3; angle: number }
)
interface MotionTiming {
  duration: number
  openLabel: string
  closeLabel: string
}
export type ProgressMotion = MotionTiming &
  (
    | { tracks: MotionTrack[]; program?: never }
    | {
        program: { type: 'typewriter-layout-v1' | 'piano-sound-path-v1'; file: string }
        tracks?: never
      }
  )
export type ProgressAction = Action & { kind: 'progress'; motion: ProgressMotion }
export interface MotionStatus {
  progress: number
  target: number
  playing: boolean
}
export interface MotionCommand {
  revision: number
  operation: 'seek' | 'play' | 'pause' | 'resume' | 'reset'
  id: string
  value?: number
}
export interface GuideStep {
  id: string
  title: string
  description: string
  view?: string
  hotspotId?: string
  actionId?: string
  explode?: boolean
  overview?: boolean
  progress?: { actionId: string; value: number }
}
export interface StageConfig {
  background: string
  ground: string
  groundY: number
  exposure: number
  environmentIntensity: number
  environmentFile?: string
  ambient: number
  key: { position: Vec3; color: string; intensity: number }
  rim: { position: Vec3; color: string; intensity: number }
}
export interface BundleReference {
  manifest: string
  id: string
  version: number
  sha256: string
}
export interface GlbSource {
  kind: 'glb'
  adapter: 'pbr-v1' | 'typewriter-v1' | 'piano-v1' | 'reventon-v1'
  bundle: BundleReference
  transform: { position: Vec3; rotation: Vec3; scale: number }
  finishMaterials: string[]
  explode: { node: string; offset: Vec3 }[]
}
interface PresentationFields {
  camera: { position: Vec3; target: Vec3; minDistance: number; maxDistance: number }
  views: View[]
  hotspots: Hotspot[]
  finishes: Finish[]
  actions: Action[]
  structure: boolean
  structureActionId?: string
  guide: GuideStep[]
}
export type ProductPresentation = PresentationFields &
  (
    | { version: 1; source: { kind: 'procedural'; key: SampleKey }; stage?: never }
    | {
        version: 2 | 3
        source: { kind: 'procedural'; key: SampleKey } | GlbSource
        stage: StageConfig
      }
  )
export interface ProductSummary {
  slug: string
  name: string
  category: string
  description: string
  cover?: string
  displayStatus?: 'prototype' | 'formal'
}
export interface WorkbenchProduct extends ProductSummary {
  presentation: ProductPresentation
}
export interface SceneCommand {
  revision: number
  kind: 'view' | 'focus' | 'zoom' | 'orbit'
  id?: string
  direction?: 1 | -1
  axis?: 'horizontal' | 'vertical'
}

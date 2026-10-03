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
}
export interface Finish {
  id: string
  name: string
  color: string
}
export interface Action {
  id: string
  label: string
  kind: 'toggle' | 'pulse'
  node: string
  behavior?: { type: 'rotate' | 'translate'; axis: Vec3; amount: number }
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
  adapter: 'pbr-v1'
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
  guide: GuideStep[]
}
export type ProductPresentation = PresentationFields &
  (
    | { version: 1; source: { kind: 'procedural'; key: SampleKey }; stage?: never }
    | { version: 2; source: { kind: 'procedural'; key: SampleKey } | GlbSource; stage: StageConfig }
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
  kind: 'view' | 'focus' | 'zoom'
  id?: string
  direction?: 1 | -1
}

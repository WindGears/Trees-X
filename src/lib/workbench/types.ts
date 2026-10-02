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
export interface ProductPresentation {
  version: 1
  source: { kind: 'procedural'; key: SampleKey }
  camera: { position: Vec3; target: Vec3; minDistance: number; maxDistance: number }
  views: View[]
  hotspots: Hotspot[]
  finishes: Finish[]
  actions: Action[]
  structure: boolean
  guide: GuideStep[]
}
export interface ProductSummary {
  slug: string
  name: string
  category: string
  description: string
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

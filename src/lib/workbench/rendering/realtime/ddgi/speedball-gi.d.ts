// Deliberately limited declaration of the audited 0.8.0 low-level surface.
// Upstream ships JS without declarations. No installer/material API is exposed here.
declare module 'speedball-gi' {
  import type { Box3, Object3D, Material, SphericalHarmonics3, Vector3 } from 'three'
  import type { Node, Scene, WebGPURenderer } from 'three/webgpu'

  export interface SpeedballProbeNode {
    readonly active: boolean
    readonly cacheToken: string
    normalBiasNode: { value: number }[]
    sampleBiasScaleNode: { value: number }
    intensityNode: Node<'float'>
    enabledNode: Node<'float'>
    sampleIrradiance(
      position: Node<'vec3'>,
      visibilityNormal: Node<'vec3'>,
      directionNormal: Node<'vec3'>,
      dualDetail?: boolean,
    ): Node<'vec3'>
  }
  export interface SpeedballStats {
    probes: number
    res: Vector3
    atlas: [number, number]
    rays: number
    active: boolean
    reflectionQuality: string
    cascades: number
    budgetRays: number
  }
  export interface SpeedballState {
    dirty: boolean
    buildDirty: boolean
    buildStage: number
    rebuildBackoff: number
    inFlight: boolean
    tickBudgetRays: number
    lastTransformInstanceCount: number
    lastTlasRefitCount: number
    sceneStorageRebinds: number
    sceneStorageRewrites: number
    mapsArenaRebinds: number
    mapsArenaRewrites: number
    updatedCount: number
    cascadeState: { needsClear: boolean }[]
  }
  export interface SpeedballField {
    node: SpeedballProbeNode
    tick(options?: { idleMs?: number; playing?: boolean }): Promise<void>
    resetFramePacing(): void
    setEnabled(enabled: boolean): void
    setRayBudget(rays: number): void
    setVolumes(volumes: { box: Box3; res: Vector3 }[]): void
    setSky(sky: SphericalHarmonics3 | null): void
    setSkyIntensity(intensity: number): void
    markTransformsDirty(targets?: Object3D | Object3D[]): void
    markMaterialValuesDirty(targets?: Material | Material[]): void
    markTopologyDirty(): void
    forceLightingRefresh(): void
    isSupported(): boolean
    hasData(): boolean
    getStats(): SpeedballStats
    _debugState(): SpeedballState
    dispose(): void
  }
  export function createProbeField(options: {
    renderer: WebGPURenderer
    scene: Scene
    intensity: number
    hysteresis: number
    jitterMode: 'gated'
    onRebuilt: () => void
    divisions: number
    autoPadding: number
    rays: number
    cascades: 1
    continuous: true
    roughReflections: false
    reflectionQuality: 'off'
    reflectionIntensity: 0
    reflectionSkyFallback: false
    clusteredLighting: false
    autoDetectChanges: false
  }): SpeedballField
}

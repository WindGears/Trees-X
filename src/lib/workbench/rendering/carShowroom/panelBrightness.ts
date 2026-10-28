import { Color, type Light, type Mesh, type Object3D, type Scene } from 'three'

type PanelControl = {
  set(value: number): number | undefined
  setLighting(value: number): number | undefined
}
const controls = new WeakMap<Object3D, PanelControl>()

/** Scene-local debug bridge. No events, renderer, capture or global UI state. */
export function setShowroomPanelBrightness(scene: Object3D, value: number) {
  return controls.get(scene)?.set(value)
}

export function setShowroomLighting(scene: Object3D, value: number) {
  return controls.get(scene)?.setLighting(value)
}

export function ownShowroomPanelBrightness(
  scene: Object3D,
  panels: readonly Mesh[],
  ready: () => boolean,
  report: (value: number) => void,
  lighting?: {
    scene: Scene
    lights: () => readonly Light[]
    baseline: number
    report: (value: number) => void
  },
) {
  const entries = panels.flatMap((panel) => {
    const materials = Array.isArray(panel.material) ? panel.material : [panel.material]
    return materials.flatMap((material) =>
      'color' in material && material.color instanceof Color
        ? [{ color: material.color, original: material.color.clone() }]
        : [],
    )
  })
  const lightValues = new Map<Light, number>()
  let disposed = false,
    panelGain = 1,
    lightingGain = 1
  const applyPanels = () => {
    for (const entry of entries)
      entry.color.copy(entry.original).multiplyScalar(panelGain * lightingGain)
  }
  const control: PanelControl = {
    set(value) {
      if (disposed || !ready() || !Number.isFinite(value)) return
      const multiplier = Math.min(3, Math.max(0, value))
      // Cutaway materials are visible-camera clones. Their opaque trace source,
      // area lights and captured environment deliberately retain baseline energy.
      panelGain = multiplier
      applyPanels()
      report(multiplier)
      return multiplier
    },
    setLighting(value) {
      if (disposed || !ready() || !lighting || !Number.isFinite(value)) return
      lightingGain = Math.min(2, Math.max(0.25, value))
      // Fixed geometry/materials: radiance is linear in a common source gain.
      // This scales the baked room too; it does not pretend to relight one lamp.
      for (const light of lighting.lights()) {
        if (!lightValues.has(light)) lightValues.set(light, light.intensity)
        light.intensity = lightValues.get(light)! * lightingGain
      }
      lighting.scene.environmentIntensity = lighting.baseline * lightingGain
      applyPanels()
      lighting.report(lightingGain)
      return lightingGain
    },
  }
  controls.set(scene, control)
  return {
    dispose() {
      if (disposed) return
      disposed = true
      if (controls.get(scene) === control) {
        controls.delete(scene)
        for (const [light, intensity] of lightValues) light.intensity = intensity
        if (lighting) lighting.scene.environmentIntensity = lighting.baseline
      }
      lightValues.clear()
      for (const entry of entries) entry.color.copy(entry.original)
    },
  }
}

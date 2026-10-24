import { Color, type Mesh, type Object3D } from 'three'

type PanelControl = { set(value: number): number | undefined }
const controls = new WeakMap<Object3D, PanelControl>()

/** Scene-local debug bridge. No events, renderer, capture or global UI state. */
export function setShowroomPanelBrightness(scene: Object3D, value: number) {
  return controls.get(scene)?.set(value)
}

export function ownShowroomPanelBrightness(
  scene: Object3D,
  panels: readonly Mesh[],
  ready: () => boolean,
  report: (value: number) => void,
) {
  const entries = panels.flatMap((panel) => {
    const materials = Array.isArray(panel.material) ? panel.material : [panel.material]
    return materials.flatMap((material) =>
      'color' in material && material.color instanceof Color
        ? [{ color: material.color, original: material.color.clone() }]
        : [],
    )
  })
  let disposed = false
  const control: PanelControl = {
    set(value) {
      if (disposed || !ready() || !Number.isFinite(value)) return
      const multiplier = Math.min(3, Math.max(0, value))
      // Cutaway materials are visible-camera clones. Their opaque trace source,
      // area lights and captured environment deliberately retain baseline energy.
      for (const entry of entries) entry.color.copy(entry.original).multiplyScalar(multiplier)
      report(multiplier)
      return multiplier
    },
  }
  controls.set(scene, control)
  return {
    dispose() {
      if (disposed) return
      disposed = true
      if (controls.get(scene) === control) controls.delete(scene)
      for (const entry of entries) entry.color.copy(entry.original)
    },
  }
}

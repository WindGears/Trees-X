import { RectAreaLight, Vector3 } from 'three'
import { acquireRectAreaUniforms } from '@/lib/three/rectAreaUniforms'

export const studioDesign = {
  groundY: -0.0192,
  width: 3.8,
  depth: 3,
  height: 0.22,
  radius: 0.065,
  background: '#dfe4df',
  captureFill: 0.35,
  backdrop: { top: '#f0f3ef', middle: '#e7e9e5', bottom: '#cbd4c8' },
  floor: '#bfc8bd',
  pedestal: '#d7dcd5',
  panels: [
    {
      name: 'window',
      position: [-4.7, 4.2, -9.86],
      target: [0, 0.5, 0],
      width: 4.2,
      height: 5.4,
      power: 5.8,
    },
    {
      name: 'key',
      position: [-3.2, 4.8, 2.5],
      target: [0, 0.5, 0],
      width: 3.6,
      height: 2.6,
      power: 4.6,
    },
    {
      name: 'rim',
      position: [4.8, 3.4, -2.5],
      target: [0, 0.5, 0],
      width: 1.25,
      height: 4.4,
      power: 3.4,
    },
  ],
} as const

/** Visible area lights and capture-only softboxes use one authored layout. */
export function createStudioLights() {
  const releaseUniforms = acquireRectAreaUniforms()
  const lights = studioDesign.panels.map((panel) => {
    const light = new RectAreaLight('#fffaf1', panel.power, panel.width, panel.height)
    light.name = `Trees X / studio ${panel.name} light`
    light.position.fromArray(panel.position)
    light.lookAt(new Vector3().fromArray(panel.target))
    return light
  })
  let disposed = false
  return {
    lights,
    dispose() {
      if (disposed) return
      disposed = true
      for (const light of lights) {
        light.removeFromParent()
        light.dispose()
      }
      releaseUniforms()
    },
  }
}

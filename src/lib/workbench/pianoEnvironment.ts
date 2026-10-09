import {
  Color,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  PMREMGenerator,
  type WebGLRenderer,
} from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
export function createPianoEnvironment(renderer: WebGLRenderer) {
  const scene = new RoomEnvironment(),
    generator = new PMREMGenerator(renderer)
  const panels: [number, number, number, number, number, number][] = [
    [-4, 2.6, -3.5, 1.5, 4.8, 2.4],
    [3.5, 2.4, 4, 1.2, 4.5, 1.6],
  ]
  try {
    for (const [x, y, z, w, h, power] of panels) {
      const panel = new Mesh(
        new PlaneGeometry(w, h),
        new MeshBasicMaterial({ color: new Color(power, power, power), side: DoubleSide }),
      )
      panel.position.set(x, y, z)
      panel.lookAt(0, 1, 0)
      scene.add(panel)
    }
    scene.rotation.set(Math.PI / 2, 0, 0.25)
    scene.updateMatrixWorld(true)
    return generator.fromScene(scene, 0.03)
  } finally {
    generator.dispose()
    scene.dispose()
  }
}

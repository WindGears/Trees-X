import {
  Color,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  type WebGLRenderer,
} from 'three'

export function createTypewriterEnvironment(renderer: WebGLRenderer) {
  const scene = new Scene()
  scene.background = new Color(0x4a4b49)
  const panels: number[][] = [
    [12, 6, -7, 10, -2, 4.2],
    [4, 11, 7, 7, -5, 2],
    [10, 2, 0, 6, 9, 1.2],
  ]
  const resources: Mesh<PlaneGeometry, MeshBasicMaterial>[] = []
  const generator = new PMREMGenerator(renderer)
  try {
    for (const values of panels) {
      const [w, h, x, y, z, power] = values as [number, number, number, number, number, number]
      const mesh = new Mesh(
        new PlaneGeometry(w, h),
        new MeshBasicMaterial({
          color: new Color().setRGB(power, power, power * 0.985),
          side: DoubleSide,
        }),
      )
      mesh.position.set(x, y, z)
      mesh.lookAt(0, 0, 0)
      scene.add(mesh)
      resources.push(mesh)
    }
    return generator.fromScene(scene, 0.035)
  } finally {
    generator.dispose()
    resources.forEach((mesh) => {
      mesh.geometry.dispose()
      mesh.material.dispose()
    })
  }
}

import {
  BoxGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  Vector3,
  type BufferGeometry,
  type Material,
  type WebGLRenderer,
} from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { createStudioLights, studioDesign } from './design'

/** Only authored studio resources are owned here; product geometry is never traversed. */
export function createStudioGeometry(groundY: number = studioDesign.groundY) {
  const group = new Group()
  group.name = 'Trees X / product studio'
  group.userData.studio = true
  const geometries = new Set<BufferGeometry>()
  const materials = new Set<Material>()
  function add(
    name: string,
    geometry: BufferGeometry,
    material: Material,
    position: readonly number[],
  ) {
    geometries.add(geometry)
    materials.add(material)
    const mesh = new Mesh(geometry, material)
    mesh.name = `Trees X / studio ${name}`
    mesh.position.fromArray(position)
    mesh.receiveShadow = true
    group.add(mesh)
    return mesh
  }
  const surface = new MeshPhysicalMaterial({
    color: studioDesign.pedestal,
    roughness: 0.32,
    metalness: 0.055,
    clearcoat: 0.2,
    clearcoatRoughness: 0.3,
  })
  add(
    'pedestal',
    new RoundedBoxGeometry(
      studioDesign.width,
      studioDesign.height,
      studioDesign.depth,
      5,
      studioDesign.radius,
    ),
    surface,
    [0, groundY - studioDesign.height / 2, 0],
  )
  const floor = add(
    'floor',
    new PlaneGeometry(50, 50),
    new MeshStandardMaterial({ color: studioDesign.floor, roughness: 0.74 }),
    [0, groundY - studioDesign.height - 0.005, 0],
  )
  floor.rotation.x = -Math.PI / 2
  add(
    'back wall',
    new BoxGeometry(38, 15, 0.18),
    new MeshStandardMaterial({ color: studioDesign.wall, roughness: 0.9 }),
    [0, 7.25, -10],
  )
  const frame = new MeshStandardMaterial({
    color: studioDesign.frame,
    roughness: 0.42,
    metalness: 0.25,
  })
  const window = studioDesign.panels[0]
  const [x, y, z] = window.position
  for (const dx of [-window.width / 2, 0, window.width / 2])
    add('window mullion', new BoxGeometry(0.07, window.height + 0.12, 0.1), frame, [
      x + dx,
      y,
      z + 0.022,
    ])
  for (const dy of [-window.height / 2, 0, window.height / 2])
    add('window transom', new BoxGeometry(window.width + 0.12, 0.07, 0.1), frame, [
      x,
      y + dy,
      z + 0.022,
    ])
  for (const panel of studioDesign.panels) {
    const emissive = new MeshBasicMaterial({
      color: new Color().setRGB(panel.power, panel.power * 0.985, panel.power * 0.95),
      side: DoubleSide,
    })
    const board = add(
      `${panel.name} lightboard`,
      new PlaneGeometry(panel.width, panel.height),
      emissive,
      panel.position,
    )
    if (panel.name !== 'window') board.lookAt(new Vector3().fromArray(panel.target))
  }
  group.updateMatrixWorld(true)
  let disposed = false
  return {
    group,
    dispose() {
      if (disposed) return
      disposed = true
      group.removeFromParent()
      for (const resource of geometries) resource.dispose()
      for (const resource of materials) resource.dispose()
      group.clear()
    },
  }
}

/** Caller owns the returned PMREM target; temporary authored scene is released here. */
export function createStudioEnvironment(
  renderer: WebGLRenderer,
  groundY: number = studioDesign.groundY,
) {
  const environment = new Scene()
  environment.background = new Color(studioDesign.background)
  const geometry = createStudioGeometry(groundY)
  const lighting = createStudioLights()
  environment.add(geometry.group, ...lighting.lights)
  const generator = new PMREMGenerator(renderer)
  try {
    return generator.fromScene(environment, 0.025, 0.05, 60, {
      size: 512,
      position: new Vector3(0, 0.55, 0),
    })
  } finally {
    generator.dispose()
    lighting.dispose()
    geometry.dispose()
  }
}

import {
  BoxGeometry,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  Material,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Vector2,
  Vector3,
  type Texture,
} from 'three'
import { MeshPhysicalNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu'
import { coldStudioConfig, type CarShowroomConfig } from './config'
import { createStudioShell } from './shell'
import { createStoneTiles } from './tiles'
import { createWallPanels } from './wallPanels'

export interface ShowroomSurfaceMaps {
  readonly map: Texture
  readonly normalMap: Texture
  readonly roughnessMap: Texture
}

/** Owns authored geometry/materials; texture packs are borrowed from the stage asset owner. */
export function createColdStudioGeometry(config: CarShowroomConfig = coldStudioConfig) {
  const root = new Group(),
    fadeMeshes: Mesh[] = [],
    panels: Mesh[] = [],
    geometries = new Set<BufferGeometry>(),
    materials = new Set<Material>(),
    target = new Vector3(),
    shell = createStudioShell(config)
  root.name = 'Trees X / cold studio'
  root.userData.carShowroom = config.id
  function add(
    id: string,
    geometry: BufferGeometry,
    material: Material,
    x: number,
    y: number,
    z: number,
    fade = false,
  ) {
    geometries.add(geometry)
    materials.add(material)
    const mesh = new Mesh(geometry, material)
    mesh.name = `Trees X / cold studio ${id}`
    mesh.userData.carShowroom = true
    mesh.userData.showroomId = id
    mesh.userData.traceSupport = true
    mesh.receiveShadow = false
    mesh.position.set(x, y, z)
    root.add(mesh)
    if (fade) fadeMeshes.push(mesh)
    return mesh
  }
  const floorMaterial = new MeshPhysicalMaterial({
      color: config.floor.color,
      roughness: config.floor.roughness,
      metalness: config.floor.metalness,
      normalScale: new Vector2(0.22, 0.22),
      clearcoat: 0.03,
      clearcoatRoughness: 0.5,
      side: DoubleSide,
    }),
    wall = new MeshStandardMaterial({
      color: config.wallColor,
      roughness: 1,
      metalness: 0,
      normalScale: new Vector2(0.16, 0.16),
      side: DoubleSide,
    }),
    ceiling = new MeshStandardMaterial({
      color: config.ceilingColor,
      roughness: 0.85,
      side: DoubleSide,
    }),
    floor = add(
      'floor',
      createStoneTiles(shell.floor, config.floor.tileSize),
      floorMaterial,
      0,
      config.groundY,
      0,
    )
  add(
    'recessed tile joints',
    shell.floor,
    new MeshStandardMaterial({ color: '#28292b', roughness: 0.92 }),
    0,
    config.groundY - 0.003,
    0,
  )
  floor.userData.showroomSurface = 'floor'
  for (const part of [...shell.walls, ...shell.coves]) {
    const mesh = add(part.id, part.geometry, wall, 0, 0, 0, true)
    mesh.userData.showroomSurface = 'wall'
  }
  add('ceiling', shell.ceiling, ceiling, 0, config.roomBox.max[1], 0, true)
  const rim = new MeshStandardMaterial({ color: '#16181c', roughness: 0.55, metalness: 0.65 })
  for (const part of createWallPanels(config)) {
    const mesh = add(part.id, part.geometry, part.surface === 'wall' ? wall : rim, 0, 0, 0, true)
    if (part.surface === 'wall') mesh.userData.showroomSurface = 'wall'
  }
  for (const light of Object.values(config.lights)) {
    const material = new MeshBasicMaterial({
      color: new Color(light.color).multiplyScalar(light.radiance),
      toneMapped: false,
      side: DoubleSide,
    })
    const panel = add(
      `${light.id} softbox`,
      new PlaneGeometry(light.width, light.height),
      material,
      light.position[0],
      light.position[1],
      light.position[2],
      true,
    )
    panel.lookAt(target.fromArray(light.target))
    panel.userData.traceExclude = true
    panel.userData.traceSupport = false
    panel.userData.showroomLightId = light.id
    panels.push(panel)
    const frame = add(
      `${light.id} softbox housing`,
      new BoxGeometry(light.width + 0.12, light.height + 0.12, 0.09),
      rim,
      light.position[0],
      light.position[1],
      light.position[2],
      true,
    )
    frame.quaternion.copy(panel.quaternion)
    // The diffuser is on the illuminated front of its real, dark housing.
    frame.position.addScaledVector(target.set(0, 0, -1).applyQuaternion(panel.quaternion), 0.052)
  }
  root.updateMatrixWorld(true)
  let disposed = false
  function applyMaps(material: Material, maps: ShowroomSurfaceMaps) {
    if (!(
      material instanceof MeshStandardMaterial ||
      material instanceof MeshStandardNodeMaterial ||
      material instanceof MeshPhysicalNodeMaterial
    ))
      return
    material.map = maps.map
    material.normalMap = maps.normalMap
    material.roughnessMap = maps.roughnessMap
    material.needsUpdate = true
  }
  return {
    root,
    fadeMeshes,
    panels,
    floor,
    applySurfaces(pack: {
      readonly floor: ShowroomSurfaceMaps
      readonly wall: ShowroomSurfaceMaps
    }) {
      if (disposed) return
      applyMaps(floorMaterial, pack.floor)
      applyMaps(wall, pack.wall)
      for (const mesh of [floor, ...fadeMeshes]) {
        const maps =
          mesh.userData.showroomSurface === 'floor'
            ? pack.floor
            : mesh.userData.showroomSurface === 'wall'
              ? pack.wall
              : null
        if (!maps) continue
        if (!Array.isArray(mesh.material)) applyMaps(mesh.material, maps)
        const traceMaterial: unknown = mesh.userData.traceMaterial
        if (traceMaterial instanceof Material) applyMaps(traceMaterial, maps)
      }
    },
    dispose() {
      if (disposed) return
      disposed = true
      root.removeFromParent()
      root.clear()
      for (const geometry of geometries) geometry.dispose()
      for (const material of materials) material.dispose()
    },
  }
}

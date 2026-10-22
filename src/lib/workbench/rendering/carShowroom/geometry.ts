import {
  BoxGeometry,
  BufferGeometry,
  Color,
  DataTexture,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LinearMipmapLinearFilter,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  NoColorSpace,
  PlaneGeometry,
  RepeatWrapping,
  RGBAFormat,
  UnsignedByteType,
  Vector2,
  Vector3,
  type Material,
  type Texture,
} from 'three'
import { coldStudioConfig, type CarShowroomConfig } from './config'

/** Deterministic numerical stone microstructure; not a measured or generated PBR scan. */
function stoneMaps() {
  const size = 256,
    normal = new Uint8Array(size * size * 4),
    rough = new Uint8Array(size * size * 4)
  const height = (x: number, y: number) => {
    const px = (x + size) % size,
      py = (y + size) % size,
      hash = Math.sin(px * 127.1 + py * 311.7) * 43758.5453
    return (hash - Math.floor(hash) - 0.5) * 0.008
  }
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const offset = (y * size + x) * 4,
        seam = Math.min(x, y, size - 1 - x, size - 1 - y) < 1,
        dx = (height(x + 1, y) - height(x - 1, y)) * 0.5,
        dy = (height(x, y + 1) - height(x, y - 1)) * 0.5,
        inverseLength = 1 / Math.sqrt(1 + dx * dx + dy * dy),
        grain = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453,
        value = Math.round((0.89 + height(x, y) * 0.25 + (grain % 1) * 0.025) * 255)
      normal[offset] = Math.round((-dx * inverseLength * 0.5 + 0.5) * 255)
      normal[offset + 1] = Math.round((-dy * inverseLength * 0.5 + 0.5) * 255)
      normal[offset + 2] = Math.round((inverseLength * 0.5 + 0.5) * 255)
      normal[offset + 3] = 255
      rough[offset] = rough[offset + 1] = rough[offset + 2] = seam ? 255 : value
      rough[offset + 3] = 255
    }
  return [normal, rough].map((bytes, index) => {
    const map = new DataTexture(bytes, size, size, RGBAFormat, UnsignedByteType)
    map.name = `Trees X / cold studio stone ${index === 0 ? 'normal' : 'roughness'}`
    map.colorSpace = NoColorSpace
    map.wrapS = map.wrapT = RepeatWrapping
    map.minFilter = LinearMipmapLinearFilter
    map.generateMipmaps = true
    map.needsUpdate = true
    return map
  }) as [DataTexture, DataTexture]
}

/** Quarter-circle geometry connects the horizontal floor to each vertical wall. */
function coveGeometry(
  axis: 'x' | 'z',
  wall: number,
  inward: number,
  from: number,
  to: number,
  ground: number,
  radius: number,
) {
  const positions: number[] = [],
    normals: number[] = [],
    uvs: number[] = [],
    indices: number[] = [],
    segments = 24
  for (let step = 0; step <= segments; step++) {
    const angle = (step / segments) * Math.PI * 0.5,
      horizontal = wall + inward * radius * (1 - Math.sin(angle)),
      y = ground + radius * (1 - Math.cos(angle))
    for (const along of [from, to]) {
      positions.push(axis === 'x' ? horizontal : along, y, axis === 'z' ? horizontal : along)
      normals.push(
        axis === 'x' ? inward * Math.sin(angle) : 0,
        Math.cos(angle),
        axis === 'z' ? inward * Math.sin(angle) : 0,
      )
      uvs.push((along - from) / (to - from), step / segments)
    }
    if (step < segments) {
      const start = step * 2
      indices.push(start, start + 1, start + 2, start + 1, start + 3, start + 2)
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

/** Owns only authored showroom resources. No product, renderer, clock or capture target. */
export function createColdStudioGeometry(config: CarShowroomConfig = coldStudioConfig) {
  const root = new Group(),
    fadeMeshes: Mesh[] = [],
    panels: Mesh[] = [],
    geometries = new Set<BufferGeometry>(),
    materials = new Set<Material>(),
    textures = new Set<Texture>(),
    [normal, roughness] = stoneMaps(),
    min = config.roomBox.min,
    max = config.roomBox.max,
    centerX = (min[0] + max[0]) * 0.5,
    centerZ = (min[2] + max[2]) * 0.5,
    height = max[1] - config.groundY,
    target = new Vector3()
  root.name = 'Trees X / cold studio'
  root.userData.carShowroom = config.id
  textures.add(normal).add(roughness)
  normal.repeat.set(
    config.floor.width / config.floor.tileSize,
    config.floor.depth / config.floor.tileSize,
  )
  roughness.repeat.copy(normal.repeat)
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
    mesh.receiveShadow = true
    mesh.position.set(x, y, z)
    root.add(mesh)
    if (fade) fadeMeshes.push(mesh)
    return mesh
  }
  const floorMaterial = new MeshPhysicalMaterial({
    color: config.floor.color,
    roughness: config.floor.roughness,
    metalness: config.floor.metalness,
    normalMap: normal,
    normalScale: new Vector2(0.17, 0.17),
    roughnessMap: roughness,
    clearcoat: 0.03,
    clearcoatRoughness: 0.5,
    side: DoubleSide,
  })
  const floor = add(
    'floor',
    new PlaneGeometry(config.floor.width, config.floor.depth),
    floorMaterial,
    centerX,
    config.groundY,
    centerZ,
  )
  floor.rotation.x = -Math.PI / 2
  const wall = new MeshStandardMaterial({
      color: config.wallColor,
      roughness: 0.78,
      metalness: 0.025,
      side: DoubleSide,
    }),
    ceiling = new MeshStandardMaterial({
      color: config.ceilingColor,
      roughness: 0.85,
      side: DoubleSide,
    }),
    radius = config.coveRadius,
    wallHeight = height - radius,
    wallY = config.groundY + radius + wallHeight * 0.5
  add(
    'back wall',
    new PlaneGeometry(config.floor.width, wallHeight),
    wall,
    centerX,
    wallY,
    min[2],
    true,
  )
  add(
    'front wall',
    new PlaneGeometry(config.floor.width, wallHeight),
    wall,
    centerX,
    wallY,
    max[2],
    true,
  ).rotation.y = Math.PI
  add(
    'left wall',
    new PlaneGeometry(config.floor.depth, wallHeight),
    wall,
    min[0],
    wallY,
    centerZ,
    true,
  ).rotation.y = Math.PI / 2
  add(
    'right wall',
    new PlaneGeometry(config.floor.depth, wallHeight),
    wall,
    max[0],
    wallY,
    centerZ,
    true,
  ).rotation.y = -Math.PI / 2
  add(
    'ceiling',
    new PlaneGeometry(config.floor.width, config.floor.depth),
    ceiling,
    centerX,
    max[1],
    centerZ,
    true,
  ).rotation.x = Math.PI / 2
  for (const [axis, coordinate, direction, start, end, id] of [
    ['z', min[2], 1, min[0], max[0], 'back'],
    ['z', max[2], -1, min[0], max[0], 'front'],
    ['x', min[0], 1, min[2], max[2], 'left'],
    ['x', max[0], -1, min[2], max[2], 'right'],
  ] as const)
    add(
      `${id} floor cove`,
      coveGeometry(axis, coordinate, direction, start, end, config.groundY, radius),
      wall,
      0,
      0,
      0,
      true,
    )
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
    const rim = new MeshStandardMaterial({ color: '#0d0e10', roughness: 0.7, metalness: 0.2 })
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
  return {
    root,
    fadeMeshes,
    panels,
    floor,
    dispose() {
      if (disposed) return
      disposed = true
      root.removeFromParent()
      root.clear()
      for (const geometry of geometries) geometry.dispose()
      for (const material of materials) material.dispose()
      for (const texture of textures) texture.dispose()
    },
  }
}

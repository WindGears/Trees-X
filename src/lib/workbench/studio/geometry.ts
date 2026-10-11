import {
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
import { createStudioBackdrop } from './backdrop'

function buildStudioGeometry(groundY: number, capture: boolean) {
  const group = new Group()
  group.name = capture ? 'Trees X / studio capture' : 'Trees X / product studio'
  group.userData.studio = true
  group.userData.capture = capture
  const backdrop = createStudioBackdrop(capture ? studioDesign.captureFill : 1)
  group.add(backdrop.mesh)
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
  const floorMaterial = new MeshStandardMaterial({
    color: studioDesign.floor,
    roughness: 0.74,
    transparent: true,
    depthWrite: false,
  })
  // A physical nearby floor recedes into the infinite sky instead of exposing
  // an edge, hard horizon, or a tone-mapped seam during wide-angle observation.
  floorMaterial.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vStudioFloorWorld;')
      .replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\nvStudioFloorWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      )
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vStudioFloorWorld;')
      .replace(
        '#include <dithering_fragment>',
        '#include <dithering_fragment>\ngl_FragColor.a *= 1.0 - smoothstep(14.0, 30.0, length(vStudioFloorWorld.xz - cameraPosition.xz));',
      )
  }
  floorMaterial.customProgramCacheKey = () => 'trees-studio-floor-fade-v1'
  const floor = add('floor', new PlaneGeometry(200, 200), floorMaterial, [
    0,
    groundY - studioDesign.height - 0.005,
    0,
  ])
  floor.rotation.x = -Math.PI / 2
  floor.renderOrder = -900
  for (const panel of capture ? studioDesign.panels : []) {
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
    board.lookAt(new Vector3().fromArray(panel.target))
  }
  group.updateMatrixWorld(true)
  let disposed = false
  return {
    group,
    dispose() {
      if (disposed) return
      disposed = true
      group.removeFromParent()
      backdrop.dispose()
      for (const resource of geometries) resource.dispose()
      for (const resource of materials) resource.dispose()
      group.clear()
    },
  }
}

/** The live scene owns its pedestal, floor, and seamless background; no softbox boards. */
export function createStudioGeometry(groundY: number = studioDesign.groundY) {
  return buildStudioGeometry(groundY, false)
}

/** Softbox geometry exists only while deriving the reflective HDR environment. */
export function createStudioCaptureGeometry(groundY: number = studioDesign.groundY) {
  return buildStudioGeometry(groundY, true)
}

/** Caller owns the returned PMREM target; temporary authored scene is released here. */
export function createStudioEnvironment(
  renderer: WebGLRenderer,
  groundY: number = studioDesign.groundY,
) {
  const environment = new Scene()
  environment.background = new Color(studioDesign.background).multiplyScalar(
    studioDesign.captureFill,
  )
  const geometry = createStudioCaptureGeometry(groundY)
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

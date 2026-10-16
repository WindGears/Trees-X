import {
  BackSide,
  BoxGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Vector3,
  type BufferGeometry,
  type Material,
} from 'three'
import { MeshBasicNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu'
import {
  cameraPosition,
  cameraProjectionMatrix,
  cameraViewMatrix,
  color,
  mix,
  positionLocal,
  positionWorld,
  smoothstep,
  vec4,
} from 'three/tsl'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { studioDesign } from '../studio/design'
import { studioPalettes, type StudioPalette } from '../studio/palette'
import { createLoungeSpatialTable } from './loungeSpatialTable'

export function createGpuStudioGeometry(
  groundY: number = studioDesign.groundY,
  capture = false,
  palette: StudioPalette = studioPalettes.light,
  spatialTable = false,
) {
  // Environment captures are frozen references, never the visitor's visible mood.
  const colors = capture ? studioPalettes.light : palette
  const group = new Group()
  group.name = capture ? 'Trees X / studio capture' : 'Trees X / product studio'
  group.userData.studio = true
  group.userData.capture = capture
  group.userData.studioMood = colors.mood
  const geometries = new Set<BufferGeometry>(),
    materials = new Set<Material>()
  const fill = capture ? studioDesign.captureFill : 1
  const skyMaterial = new MeshBasicNodeMaterial({
    side: BackSide,
    depthWrite: false,
    toneMapped: false,
    fog: false,
  })
  // This is a linear scene input, including inside planar captures. Realtime
  // postprocessing applies ACES/sRGB exactly once to the full HDR beauty.
  // toneMapped:false only prevents an independent material-local transform;
  // it is not a promise to bypass the final realtime output transform.
  skyMaterial.name = 'TreesXStudioSkyboxTSL'
  const elevation = positionLocal.normalize().y
  const upper = mix(
    color(new Color(colors.backdrop.middle).multiplyScalar(fill)),
    color(new Color(colors.backdrop.top).multiplyScalar(fill)),
    smoothstep(0, 0.85, elevation),
  )
  skyMaterial.colorNode = mix(
    upper,
    color(new Color(colors.backdrop.bottom).multiplyScalar(fill)),
    smoothstep(0, 0.85, elevation.negate()),
  )
  const view = cameraViewMatrix.mul(vec4(positionLocal, 0))
  const projected = cameraProjectionMatrix.mul(vec4(view.xyz, 1))
  skyMaterial.vertexNode = vec4(projected.xy, projected.w, projected.w)
  const sky = new Mesh(new BoxGeometry(2, 2, 2), skyMaterial)
  sky.name = 'Trees X / studio skybox'
  sky.userData.traceExclude = true
  sky.frustumCulled = false
  sky.renderOrder = -1000
  geometries.add(sky.geometry)
  materials.add(skyMaterial)
  group.add(sky)
  const surface = new MeshPhysicalMaterial({
    color: colors.pedestal,
    roughness: 0.32,
    metalness: 0.055,
    clearcoat: 0.2,
    clearcoatRoughness: 0.3,
  })
  const tableSideMaterial = spatialTable
    ? new MeshPhysicalMaterial({ color: '#40362c', roughness: 0.42, clearcoat: 0.1 })
    : undefined
  const table = spatialTable
    ? createLoungeSpatialTable({ groundY, topMaterial: surface, sideMaterial: tableSideMaterial })
    : undefined
  const pedestalMesh: Mesh<BufferGeometry, Material | Material[]> =
    table?.top ??
    new Mesh(
      new RoundedBoxGeometry(
        studioDesign.width,
        studioDesign.height,
        studioDesign.depth,
        5,
        studioDesign.radius,
      ),
      surface,
    )
  // The look owner replaces this with its Node Physical top and, in the
  // experimental profile, a separate side material. Keep the original handle.
  pedestalMesh.material = surface
  // The common handle starts with one material, preserving callers' existing
  // contract. The experiment's table.top exposes the later Material[] form.
  const pedestal = pedestalMesh as Mesh<BufferGeometry, Material>
  pedestal.name = 'Trees X / studio pedestal'
  if (!table) pedestal.position.y = groundY - studioDesign.height / 2
  pedestal.receiveShadow = true
  if (!table) geometries.add(pedestal.geometry)
  materials.add(surface)
  if (tableSideMaterial) materials.add(tableSideMaterial)
  group.add(table?.group ?? pedestal)
  const floorMaterial = new MeshStandardNodeMaterial({
    color: colors.floor,
    roughness: 0.74,
    transparent: true,
    depthWrite: false,
  })
  floorMaterial.opacityNode = smoothstep(
    14,
    30,
    positionWorld.xz.sub(cameraPosition.xz).length(),
  ).oneMinus()
  const traceFloor = new MeshStandardMaterial({ color: colors.floor, roughness: 0.74 })
  const floor = new Mesh(new PlaneGeometry(200, 200), floorMaterial)
  floor.name = 'Trees X / studio floor'
  floor.userData.traceMaterial = traceFloor
  floor.position.y = table?.floorY ?? groundY - studioDesign.height - 0.005
  // Finite room geometry supplies the experimental floor with actual depth.
  floor.visible = !spatialTable
  floor.rotation.x = -Math.PI / 2
  floor.renderOrder = -900
  geometries.add(floor.geometry)
  materials.add(floorMaterial)
  materials.add(traceFloor)
  group.add(floor)
  for (const panel of capture ? studioDesign.panels : []) {
    const board = new Mesh(
      new PlaneGeometry(panel.width, panel.height),
      new MeshBasicMaterial({
        color: new Color(panel.power, panel.power * 0.985, panel.power * 0.95),
        side: DoubleSide,
        toneMapped: false,
      }),
    )
    board.name = `Trees X / studio ${panel.name} lightboard`
    board.position.fromArray(panel.position)
    board.lookAt(new Vector3().fromArray(panel.target))
    geometries.add(board.geometry)
    materials.add(board.material)
    group.add(board)
  }
  group.updateMatrixWorld(true)
  let disposed = false
  return {
    group,
    sky,
    skyMaterial,
    pedestal,
    surface,
    table,
    tableSideMaterial,
    floorMesh: floor,
    floorMaterial,
    traceFloor,
    dispose() {
      if (disposed) return
      disposed = true
      group.removeFromParent()
      table?.dispose()
      for (const geometry of geometries) geometry.dispose()
      for (const material of materials) material.dispose()
      group.clear()
    },
  }
}

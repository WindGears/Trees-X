import {
  Color,
  InstancedMesh,
  Light,
  Material,
  Matrix4,
  Mesh,
  Scene,
  type Object3D,
  type Texture,
  type Vector2,
} from 'three'

interface MeshEntry {
  source: Mesh
  sourceBinding: Material | Material[]
  sourceSlots: Material[]
  traceBinding: unknown
  materialSlots: Material[]
  proxy: Mesh
  world: Matrix4
  instanceVersion: number
  instanceCapacity: number
  instanceCount: number
  seen: number
}
type PbrValues = Material &
  Partial<{
    color: Color
    emissive: Color
    roughness: number
    metalness: number
    opacity: number
    emissiveIntensity: number
    transmission: number
    ior: number
    clearcoat: number
    clearcoatRoughness: number
    normalScale: Vector2
    map: Texture | null
    normalMap: Texture | null
    roughnessMap: Texture | null
    metalnessMap: Texture | null
    emissiveMap: Texture | null
    alphaMap: Texture | null
  }>
const trackedFields = [
  'roughness',
  'metalness',
  'opacity',
  'emissiveIntensity',
  'transmission',
  'ior',
  'clearcoat',
  'clearcoatRoughness',
  'map',
  'normalMap',
  'roughnessMap',
  'metalnessMap',
  'emissiveMap',
  'alphaMap',
] as const
interface MaterialEntry {
  seen: number
  version: number
  color: Color
  emissive: Color
  fields: Map<(typeof trackedFields)[number], unknown>
  normalScaleX?: number
  normalScaleY?: number
}
interface LightEntry {
  source: Light
  proxy: Light
  world: Matrix4
  color: Color
  intensity: number
  seen: number
}
const tracedLightTypes = new Set(['RectAreaLight', 'PointLight', 'SpotLight', 'DirectionalLight'])

function sourceMaterial(material: Material) {
  const source: unknown = Reflect.get(material, 'source')
  return source instanceof Material ? source : material
}

function borrowedMaterials(source: Mesh) {
  const trace: unknown = source.userData.traceMaterial
  if (trace instanceof Material) return trace
  if (Array.isArray(trace) && trace.length > 0 && trace.every((item) => item instanceof Material))
    return trace as Material[]
  return Array.isArray(source.material)
    ? source.material.map(sourceMaterial)
    : sourceMaterial(source.material)
}

function sameMaterials(slots: Material[], binding: Material | Material[]) {
  return Array.isArray(binding)
    ? slots.length === binding.length &&
        slots.every((material, index) => material === binding[index])
    : slots.length === 1 && slots[0] === binding
}

function sourceAllowed(mesh: Mesh, root: Object3D) {
  let current: Object3D | null = mesh
  while (current) {
    if (current.userData.traceExclude === true) return false
    if (current === root) return true
    current = current.parent
  }
  return false
}

/** A CPU tracing view, never a rendered scene. Proxy transforms are owned; source
 * geometry, original PBR materials, textures and instance attributes are borrowed.
 * Image rooms, sky, reflection and shadow overlays do not become GI emitters.
 */
export function createDdgiProxyScene(sourceScene: Scene) {
  const scene = new Scene(),
    meshes = new Map<Mesh, MeshEntry>(),
    lights = new Map<Light, LightEntry>(),
    materialValues = new Map<Material, MaterialEntry>(),
    transforms: Object3D[] = [],
    materials: Material[] = []
  scene.name = 'Trees X / borrowed DDGI tracing view'
  let disposed = false,
    revision = 0,
    topology = false,
    lighting = false,
    selectedRoot: Object3D

  function materialChanged(material: Material) {
    const value = material as PbrValues,
      previous = materialValues.get(material)
    if (!previous) {
      materialValues.set(material, {
        seen: revision,
        version: value.version,
        color: value.color?.clone() ?? new Color(),
        emissive: value.emissive?.clone() ?? new Color(0),
        fields: new Map(trackedFields.map((field) => [field, value[field]])),
        normalScaleX: value.normalScale?.x,
        normalScaleY: value.normalScale?.y,
      })
      return
    }
    previous.seen = revision
    if (
      previous.version !== value.version ||
      (value.color && !previous.color.equals(value.color)) ||
      (value.emissive && !previous.emissive.equals(value.emissive)) ||
      trackedFields.some((field) => previous.fields.get(field) !== value[field]) ||
      previous.normalScaleX !== value.normalScale?.x ||
      previous.normalScaleY !== value.normalScale?.y
    ) {
      previous.version = value.version
      if (value.color) previous.color.copy(value.color)
      if (value.emissive) previous.emissive.copy(value.emissive)
      for (const field of trackedFields) previous.fields.set(field, value[field])
      previous.normalScaleX = value.normalScale?.x
      previous.normalScaleY = value.normalScale?.y
      materials.push(material)
    }
  }

  function visit(node: Object3D) {
    if (
      !(node instanceof Mesh) ||
      !sourceAllowed(node, selectedRoot) ||
      Reflect.get(node, 'isSkinnedMesh') === true
    )
      return
    let entry = meshes.get(node)
    const bindingChanged =
      !entry ||
      entry.sourceBinding !== node.material ||
      entry.traceBinding !== node.userData.traceMaterial ||
      (Array.isArray(node.userData.traceMaterial) &&
        !sameMaterials(entry.materialSlots, node.userData.traceMaterial)) ||
      (Array.isArray(node.material) &&
        !sameMaterials(entry.sourceSlots, node.material) &&
        node.userData.traceMaterial === undefined)
    const material = !entry || bindingChanged ? borrowedMaterials(node) : entry.proxy.material
    if (
      !entry ||
      entry.proxy.geometry !== node.geometry ||
      Array.isArray(entry.proxy.material) !== Array.isArray(material) ||
      !sameMaterials(entry.materialSlots, material) ||
      (node instanceof InstancedMesh && entry.instanceCapacity !== node.instanceMatrix.count)
    ) {
      entry?.proxy.removeFromParent()
      const proxy =
        node instanceof InstancedMesh
          ? new InstancedMesh(node.geometry, material, node.instanceMatrix.count)
          : new Mesh(node.geometry, material)
      proxy.name = node.name
      proxy.matrixAutoUpdate = false
      proxy.matrix.copy(node.matrixWorld)
      proxy.userData.ddgiSource = node.uuid
      if (node instanceof InstancedMesh && proxy instanceof InstancedMesh) {
        proxy.instanceMatrix = node.instanceMatrix
        proxy.instanceColor = node.instanceColor
        proxy.count = node.count
        proxy.computeBoundingBox()
      }
      scene.add(proxy)
      entry = {
        source: node,
        sourceBinding: node.material,
        sourceSlots: Array.isArray(node.material) ? node.material.slice() : [node.material],
        traceBinding: node.userData.traceMaterial,
        materialSlots: Array.isArray(material) ? material.slice() : [material],
        proxy,
        world: node.matrixWorld.clone(),
        instanceVersion: node instanceof InstancedMesh ? node.instanceMatrix.version : -1,
        instanceCapacity: node instanceof InstancedMesh ? node.instanceMatrix.count : 0,
        instanceCount: node instanceof InstancedMesh ? node.count : 0,
        seen: revision,
      }
      meshes.set(node, entry)
      topology = true
    } else {
      const instanceVersion = node instanceof InstancedMesh ? node.instanceMatrix.version : -1,
        instanceCount = node instanceof InstancedMesh ? node.count : 0,
        changed =
          !entry.world.equals(node.matrixWorld) ||
          instanceVersion !== entry.instanceVersion ||
          instanceCount !== entry.instanceCount
      if (changed) {
        entry.proxy.matrix.copy(node.matrixWorld)
        entry.world.copy(node.matrixWorld)
        if (entry.proxy instanceof InstancedMesh && node instanceof InstancedMesh) {
          entry.proxy.instanceMatrix = node.instanceMatrix
          entry.proxy.instanceColor = node.instanceColor
          entry.proxy.count = node.count
          entry.proxy.computeBoundingBox()
        }
        entry.instanceVersion = instanceVersion
        entry.instanceCount = instanceCount
        transforms.push(entry.proxy)
      }
    }
    if (bindingChanged)
      entry.sourceSlots = Array.isArray(node.material) ? node.material.slice() : [node.material]
    entry.sourceBinding = node.material
    entry.traceBinding = node.userData.traceMaterial
    entry.seen = revision
    if (Array.isArray(entry.proxy.material)) entry.proxy.material.forEach(materialChanged)
    else materialChanged(entry.proxy.material)
  }

  function visitLight(node: Object3D) {
    if (!(node instanceof Light) || node.userData.traceExclude === true) return
    if (!tracedLightTypes.has(node.type)) return
    let entry = lights.get(node)
    if (!entry) {
      const proxy = node.clone(false)
      proxy.matrixAutoUpdate = false
      proxy.matrix.copy(node.matrixWorld)
      scene.add(proxy)
      entry = {
        source: node,
        proxy,
        world: node.matrixWorld.clone(),
        color: node.color.clone(),
        intensity: node.intensity,
        seen: revision,
      }
      lights.set(node, entry)
      lighting = true
    }
    if (
      !entry.world.equals(node.matrixWorld) ||
      !entry.color.equals(node.color) ||
      entry.intensity !== node.intensity
    ) {
      entry.proxy.matrix.copy(node.matrixWorld)
      entry.proxy.color.copy(node.color)
      entry.proxy.intensity = node.intensity
      entry.world.copy(node.matrixWorld)
      entry.color.copy(node.color)
      entry.intensity = node.intensity
      lighting = true
    }
    entry.seen = revision
  }

  return {
    scene,
    sync() {
      transforms.length = materials.length = 0
      topology = lighting = false
      if (disposed) return { topology, lighting, transforms, materials }
      revision++
      sourceScene.updateMatrixWorld(true)
      for (const root of sourceScene.children) {
        if (root.userData.workbenchProduct === 'typewriter-study') {
          selectedRoot = root
          root.traverseVisible(visit)
        } else if (root.userData.studio === true && root.userData.capture !== true) {
          const table =
            root.getObjectByName('Trees X / spatial lounge table') ??
            root.getObjectByName('Trees X / studio pedestal')
          if (table) {
            selectedRoot = table
            table.traverseVisible(visit)
          }
        }
      }
      sourceScene.traverseVisible(visitLight)
      for (const [source, entry] of meshes)
        if (entry.seen !== revision) {
          entry.proxy.removeFromParent()
          meshes.delete(source)
          topology = true
        }
      for (const [source, entry] of lights)
        if (entry.seen !== revision) {
          entry.proxy.removeFromParent()
          lights.delete(source)
          lighting = true
        }
      for (const [material, entry] of materialValues)
        if (entry.seen !== revision) materialValues.delete(material)
      scene.updateMatrixWorld(true)
      return { topology, lighting, transforms, materials }
    },
    snapshot: () => ({
      meshes: meshes.size,
      instances: [...meshes.values()].reduce(
        (sum, entry) => sum + (entry.proxy instanceof InstancedMesh ? entry.proxy.count : 1),
        0,
      ),
      lights: lights.size,
      materialCount: materialValues.size,
      areaLightApproximation: 'Speedball 0.8.0 traces RectAreaLight as a point at its center',
    }),
    dispose() {
      if (disposed) return
      disposed = true
      // Do not dispatch Mesh/geometry/material disposal for borrowed resources.
      scene.clear()
      meshes.clear()
      lights.clear()
      materialValues.clear()
      transforms.length = materials.length = 0
    },
  }
}

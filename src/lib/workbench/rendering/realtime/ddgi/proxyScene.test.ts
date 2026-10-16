import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BoxGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  RectAreaLight,
  Scene,
  type Material,
} from 'three'
import { MeshPhysicalNodeMaterial } from 'three/webgpu'
import { createDdgiProxyScene } from './proxyScene'

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
  vi.restoreAllMocks()
})

function fixture() {
  const scene = new Scene(),
    product = new Group(),
    parent = new Group(),
    geometry = new BoxGeometry(),
    material = new MeshStandardMaterial({ color: '#6f2d19' }),
    mesh = new Mesh<BoxGeometry, Material>(geometry, material),
    instances = new InstancedMesh(geometry, material, 3)
  product.userData.workbenchProduct = 'typewriter-study'
  mesh.name = 'original component'
  instances.name = 'actual instances'
  instances.setMatrixAt(0, new Matrix4().makeTranslation(-2, 0, 0))
  instances.setMatrixAt(1, new Matrix4().makeTranslation(2, 0, 0))
  instances.setMatrixAt(2, new Matrix4().makeTranslation(4, 0, 0))
  instances.count = 2
  instances.instanceMatrix.needsUpdate = true
  parent.position.set(1, 2, 3)
  parent.rotation.y = 0.3
  parent.add(mesh, instances)
  product.add(parent)
  scene.add(product)
  const proxy = createDdgiProxyScene(scene)
  cleanups.push(() => {
    proxy.dispose()
    geometry.dispose()
    material.dispose()
    instances.dispose()
  })
  return { scene, product, parent, geometry, material, mesh, instances, proxy }
}

describe('borrowed Speedball tracing scene', () => {
  it('borrows original geometry/materials and copies exact world transforms without reparenting source objects', () => {
    const f = fixture(),
      runtime = new MeshPhysicalNodeMaterial()
    Object.defineProperty(runtime, 'source', { value: f.material })
    f.mesh.material = runtime
    const releases = [
      vi.spyOn(f.geometry, 'dispose'),
      vi.spyOn(f.material, 'dispose'),
      vi.spyOn(runtime, 'dispose'),
    ]
    cleanups.push(() => runtime.dispose())
    expect(f.proxy.sync().topology).toBe(true)
    const copy = f.proxy.scene.getObjectByName(f.mesh.name)
    if (!(copy instanceof Mesh)) throw new Error('Missing real proxy mesh')
    expect(copy).not.toBe(f.mesh)
    expect(copy.geometry).toBe(f.geometry)
    expect(copy.material).toBe(f.material)
    expect(copy.matrixWorld.equals(f.mesh.matrixWorld)).toBe(true)
    expect(f.mesh.parent).toBe(f.parent)
    expect(f.proxy.sync().topology).toBe(false)
    f.proxy.dispose()
    f.proxy.dispose()
    expect(f.proxy.scene.children).toHaveLength(0)
    for (const release of releases) expect(release).not.toHaveBeenCalled()
  })

  it('detects changed real instance attributes even when the mesh world matrix has not moved', () => {
    const f = fixture()
    f.proxy.sync()
    const world = f.instances.matrixWorld.clone(),
      copy = f.proxy.scene.getObjectByName(f.instances.name)
    if (!(copy instanceof InstancedMesh)) throw new Error('Expected actual InstancedMesh proxy')
    expect(copy.instanceMatrix).toBe(f.instances.instanceMatrix)
    expect(copy.count).toBe(2)
    const firstBox = copy.boundingBox!.clone()
    f.instances.setMatrixAt(1, new Matrix4().makeTranslation(9, 0, 0))
    f.instances.instanceMatrix.needsUpdate = true
    const change = f.proxy.sync()
    expect(change.topology).toBe(false)
    expect(change.transforms).toEqual([copy])
    expect(f.instances.matrixWorld.equals(world)).toBe(true)
    expect(copy.boundingBox!.max.x).toBeGreaterThan(firstBox.max.x)
    expect(f.proxy.sync().transforms).toHaveLength(0)
    f.instances.count = 3
    expect(f.proxy.sync().transforms).toEqual([copy])
    expect(copy.count).toBe(3)
  })

  it('separates rigid dirty, material values, topology and light changes', () => {
    const f = fixture(),
      light = new RectAreaLight('#fff0cc', 4, 3, 2)
    light.name = 'real softbox'
    f.scene.add(light)
    f.proxy.sync()
    f.parent.position.x++
    expect(f.proxy.sync().transforms).toHaveLength(2)
    f.material.color.set('#369a21')
    expect(f.proxy.sync().materials).toEqual([f.material])
    expect(f.proxy.sync().materials).toHaveLength(0)
    light.intensity = 2
    expect(f.proxy.sync().lighting).toBe(true)
    const copy = f.proxy.scene.getObjectByName(light.name)
    if (!(copy instanceof RectAreaLight)) throw new Error('Expected copied softbox')
    expect(copy.intensity).toBe(2)
    f.mesh.visible = false
    expect(f.proxy.sync().topology).toBe(true)
    expect(f.proxy.scene.getObjectByName(f.mesh.name)).toBeUndefined()
    f.mesh.visible = true
    expect(f.proxy.sync().topology).toBe(true)
    f.product.removeFromParent()
    f.proxy.sync()
    expect(f.proxy.snapshot()).toMatchObject({
      meshes: 0,
      instances: 0,
      materialCount: 0,
      lights: 1,
    })
  })

  it('includes the real pedestal but excludes giant floors, image rooms and every excluded subtree', () => {
    const f = fixture(),
      studio = new Group(),
      sky = new Mesh(f.geometry, f.material),
      floor = new Mesh(f.geometry, f.material),
      table = new Mesh(f.geometry, f.material),
      imageRoot = new Group(),
      imageCard = new Mesh(f.geometry, f.material)
    studio.userData.studio = true
    sky.name = 'Trees X / studio skybox'
    floor.name = 'Trees X / studio floor'
    table.name = 'Trees X / studio pedestal'
    sky.userData.traceExclude = true
    imageRoot.userData.traceExclude = true
    imageRoot.add(imageCard)
    f.product.add(imageRoot)
    studio.add(sky, floor, table)
    f.scene.add(studio)
    f.proxy.sync()
    expect(f.proxy.scene.getObjectByName(table.name)).toBeInstanceOf(Mesh)
    expect(f.proxy.scene.getObjectByName(sky.name)).toBeUndefined()
    expect(f.proxy.scene.getObjectByName(floor.name)).toBeUndefined()
    expect(f.proxy.snapshot().meshes).toBe(3)
  })
})

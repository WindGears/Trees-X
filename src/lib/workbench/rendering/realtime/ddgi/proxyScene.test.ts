import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BoxGeometry,
  CompressedTexture,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  RectAreaLight,
  Scene,
  Texture,
  type Material,
} from 'three'
import { MeshPhysicalNodeMaterial } from 'three/webgpu'
import { createDdgiProxyScene } from './proxyScene'
import {
  prepareCompressedTraceTextures,
  resolveCompressedTraceTexture,
} from './compressedTraceTextures'
import type { VerifiedFiles } from '../../../assetSession'

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
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
  it('traces registered cars and their explicit support without admitting image or unregistered roots', () => {
    const f = fixture(),
      support = new Mesh(f.geometry, f.material),
      excluded = new Group(),
      hiddenSupport = new Mesh(f.geometry, f.material)
    f.product.userData.workbenchProduct = 'custom-car-slug'
    f.product.userData.adapter = 'reventon-v1'
    support.name = 'car ground support'
    support.userData.traceSupport = true
    hiddenSupport.name = 'excluded support'
    hiddenSupport.userData.traceSupport = true
    excluded.userData.traceExclude = true
    excluded.add(hiddenSupport)
    f.scene.add(support, excluded)
    f.proxy.sync()
    expect(f.proxy.scene.getObjectByName(f.mesh.name)).toBeInstanceOf(Mesh)
    expect(f.proxy.scene.getObjectByName(support.name)).toBeInstanceOf(Mesh)
    expect(f.proxy.scene.getObjectByName(hiddenSupport.name)).toBeUndefined()
    f.product.userData.adapter = 'unregistered-v1'
    f.proxy.sync()
    expect(f.proxy.scene.getObjectByName(f.mesh.name)).toBeUndefined()
    expect(f.proxy.scene.getObjectByName(support.name)).toBeInstanceOf(Mesh)
  })

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

  it('accepts checked multi-material tracing groups and detects an in-place slot replacement', () => {
    const f = fixture(),
      trace = [new MeshStandardMaterial(), new MeshStandardMaterial()],
      replacement = new MeshStandardMaterial()
    cleanups.push(() => {
      trace.forEach((material) => material.dispose())
      replacement.dispose()
    })
    f.mesh.userData.traceMaterial = trace
    expect(f.proxy.sync().topology).toBe(true)
    const mesh = f.proxy.scene.getObjectByName(f.mesh.name)
    if (!(mesh instanceof Mesh)) throw new Error('Expected checked material array proxy')
    expect(mesh.material).toBe(trace)
    const original = trace[1]!
    trace[1] = replacement
    expect(f.proxy.sync().topology).toBe(true)
    expect(f.proxy.sync().topology).toBe(false)
    original.dispose()
    f.mesh.userData.traceMaterial = [replacement, null]
    expect(f.proxy.sync().topology).toBe(true)
    const fallback = f.proxy.scene.getObjectByName(f.mesh.name)
    if (!(fallback instanceof Mesh)) throw new Error('Expected original-material fallback')
    expect(fallback.material).toBe(f.material)
  })

  it('detects direct map, Physical scalar and normal-scale edits without requiring needsUpdate', () => {
    const f = fixture(),
      trace = new MeshPhysicalNodeMaterial(),
      map = new Texture()
    cleanups.push(() => {
      trace.dispose()
      map.dispose()
    })
    f.mesh.userData.traceMaterial = trace
    f.proxy.sync()
    trace.map = map
    expect(f.proxy.sync().materials).toEqual([trace])
    trace.roughnessMap = map
    expect(f.proxy.sync().materials).toEqual([trace])
    trace.normalScale.set(0.25, 0.5)
    expect(f.proxy.sync().materials).toEqual([trace])
    trace.clearcoat = 0.2
    expect(f.proxy.sync().materials).toEqual([trace])
    trace.clearcoatRoughness = 0.3
    expect(f.proxy.sync().materials).toEqual([trace])
    expect(f.proxy.sync().materials).toEqual([])
  })

  it('retains material-group semantics when a single binding changes into a one-slot array', () => {
    const f = fixture()
    f.mesh.userData.traceMaterial = f.material
    f.proxy.sync()
    f.mesh.userData.traceMaterial = [f.material]
    expect(f.proxy.sync().topology).toBe(true)
    const mesh = f.proxy.scene.getObjectByName(f.mesh.name)
    if (!(mesh instanceof Mesh)) throw new Error('Expected one-slot grouped proxy')
    expect(mesh.material).toEqual([f.material])
    expect(f.proxy.sync().topology).toBe(false)
  })

  it('redirects compressed maps through local views while finish and highlight values remain live', async () => {
    const f = fixture(),
      compressed = new CompressedTexture([], 4096, 2048),
      bitmap = { width: 256, height: 128, close: vi.fn() },
      files: VerifiedFiles = {
        read: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
        release: vi.fn(),
        dispose: vi.fn(),
      }
    compressed.userData.treesTraceImage = 'trace/texture-000.png'
    f.material.map = compressed
    f.material.normalMap = compressed
    f.material.roughnessMap = compressed
    f.material.metalnessMap = compressed
    f.material.emissiveMap = compressed
    f.material.alphaMap = compressed
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap))
    const owner = await prepareCompressedTraceTextures(
      f.product,
      files,
      new AbortController().signal,
    )
    cleanups.push(owner.dispose, () => compressed.dispose())
    f.proxy.sync()
    const mesh = f.proxy.scene.getObjectByName(f.mesh.name)
    if (!(mesh instanceof Mesh) || !(mesh.material instanceof MeshStandardMaterial))
      throw new Error('Expected inherited PBR tracing view')
    const view = mesh.material,
      cpu = resolveCompressedTraceTexture(compressed),
      sourceDispose = vi.spyOn(f.material, 'dispose'),
      compressedDispose = vi.spyOn(compressed, 'dispose'),
      cpuDispose = vi.spyOn(cpu, 'dispose')
    expect(view).not.toBe(f.material)
    expect(view.color).toBe(f.material.color)
    for (const field of [
      'map',
      'normalMap',
      'roughnessMap',
      'metalnessMap',
      'emissiveMap',
      'alphaMap',
    ])
      expect(Reflect.get(view, field)).toBe(cpu)
    expect(f.material.map).toBe(compressed)
    expect(f.proxy.sync()).toMatchObject({ topology: false, materials: [] })
    f.material.color.set('#abcd12')
    f.material.roughness = 0.21
    f.material.emissiveIntensity = 0.5
    f.material.opacity = 0.75
    expect(view.roughness).toBe(0.21)
    expect(view.opacity).toBe(0.75)
    expect(view.emissiveIntensity).toBe(0.5)
    expect(f.proxy.sync().materials).toEqual([view])
    const replacement = compressed.clone()
    cleanups.push(() => replacement.dispose())
    replacement.repeat.set(3, 4)
    f.material.map = replacement
    expect(view.map).toBe(resolveCompressedTraceTexture(replacement))
    expect(view.map?.repeat.equals(replacement.repeat)).toBe(true)
    expect(f.proxy.sync()).toMatchObject({ topology: false, materials: [view] })
    f.material.map = null
    expect(view.map).toBeNull()
    expect(f.proxy.sync().materials).toEqual([view])
    f.proxy.dispose()
    expect(sourceDispose).not.toHaveBeenCalled()
    expect(compressedDispose).not.toHaveBeenCalled()
    expect(cpuDispose).not.toHaveBeenCalled()
    expect(bitmap.close).not.toHaveBeenCalled()
    owner.dispose()
    expect(cpuDispose).toHaveBeenCalledOnce()
    expect(bitmap.close).toHaveBeenCalledOnce()
  })

  it('turns an unavailable compressed map into an explicit DDGI fallback error', () => {
    const f = fixture(),
      compressed = new CompressedTexture([], 4096, 2048)
    cleanups.push(() => compressed.dispose())
    compressed.userData.treesTraceImage = 'trace/missing.png'
    f.material.map = compressed
    expect(() => f.proxy.sync()).toThrow('缺少已登记的 CPU 追踪副本')
    expect(f.material.map).toBe(compressed)
    f.product.userData.ddgiTextureError = '追踪副本摘要不匹配：trace/missing.png'
    expect(() => f.proxy.sync()).toThrow('追踪副本摘要不匹配')
  })
})

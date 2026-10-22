import { afterEach, expect, it, vi } from 'vitest'
import { BoxGeometry, Group, Mesh, MeshPhysicalMaterial } from 'three'
import { MeshBVH } from 'three-mesh-bvh'
import { BVHComputeData } from 'three-mesh-bvh/webgpu'
import { float, vec3 } from 'three/tsl'
import { createCarShadowBvh } from './bvh'

const controls = vi.hoisted(() => ({ wait: null as Promise<void> | null, fail: false }))
vi.mock('./bvhWorker', () => ({
  buildCarShadowBlas: async (geometries: BoxGeometry[]) => {
    if (controls.wait) await controls.wait
    if (controls.fail) throw new Error('Worker failed')
    geometries.forEach(
      (geometry) => (geometry.boundsTree = new MeshBVH(geometry, { indirect: true })),
    )
  },
}))
afterEach(() => {
  controls.wait = null
  controls.fail = false
  vi.restoreAllMocks()
})

const prototype = BVHComputeData.prototype as unknown as {
  update(): void
  updateTransforms(): void
  dispose(): void
}
function fixture() {
  const geometry = new BoxGeometry()
  const material = new MeshPhysicalMaterial()
  const a = new Mesh(geometry, material)
  const b = new Mesh(geometry, material)
  b.position.x = 2
  const door = new Group().add(a)
  const root = new Group().add(door, b)
  return { root, door, geometry, material }
}

it('builds BLAS once per derivative and only refits TLAS after a rigid pose or visibility changes', async () => {
  const source = fixture()
  const rebuild = vi.spyOn(prototype, 'update')
  const transform = vi.spyOn(prototype, 'updateTransforms')
  const disposeSource = vi.spyOn(source.geometry, 'dispose')
  const disposeMaterial = vi.spyOn(source.material, 'dispose')
  const controller = new AbortController()
  const owner = await createCarShadowBvh(source.root, controller.signal)
  expect(owner.snapshot()).toMatchObject({
    meshes: 2,
    geometries: 1,
    triangles: 24,
    transformUpdates: 0,
  })
  expect(owner.snapshot().storageBytes).toBeGreaterThan(0)
  expect(rebuild).toHaveBeenCalledTimes(1)
  expect(owner.sync()).toBe(false)
  source.door.rotation.y = 0.6
  expect(owner.sync()).toBe(true)
  expect(owner.sync()).toBe(false)
  source.door.visible = false
  expect(owner.sync()).toBe(true)
  expect(owner.sync()).toBe(false)
  expect(rebuild).toHaveBeenCalledTimes(1)
  expect(transform).toHaveBeenCalledTimes(2)
  expect(owner.snapshot().transformUpdates).toBe(2)
  expect(owner.occluded(vec3(0, 3, 0), vec3(0, -1, 0), float(10)).isNode).toBe(true)
  owner.dispose()
  owner.dispose()
  expect(owner.snapshot().disposed).toBe(true)
  expect(owner.sync()).toBe(false)
  expect(() => owner.occluded(vec3(), vec3(0, 1, 0), float(1))).toThrow('disposed')
  expect(disposeSource).not.toHaveBeenCalled()
  expect(disposeMaterial).not.toHaveBeenCalled()
  expect(source.geometry.boundsTree).toBeUndefined()
})

it('cleans an aborted late build without ever creating GPU buffers', async () => {
  let resolve = () => {}
  controls.wait = new Promise<void>((done) => (resolve = done))
  const rebuild = vi.spyOn(prototype, 'update')
  const source = fixture()
  const controller = new AbortController()
  const result = createCarShadowBvh(source.root, controller.signal)
  controller.abort()
  resolve()
  await expect(result).rejects.toMatchObject({ name: 'AbortError' })
  expect(rebuild).not.toHaveBeenCalled()
  expect(source.geometry.boundsTree).toBeUndefined()
})

it('keeps one TLAS primitive per rigid source even when a BLAS has thousands of triangles', async () => {
  const geometry = new BoxGeometry(1, 1, 1, 16, 16, 16)
  const material = new MeshPhysicalMaterial()
  const root = new Group().add(new Mesh(geometry, material), new Mesh(geometry, material))
  const update = vi.spyOn(prototype, 'update')
  const owner = await createCarShadowBvh(root, new AbortController().signal)
  const data = update.mock.instances[0] as unknown as {
    bvh: { primitiveBuffer: Uint32Array; primitiveBufferStride: number }
  }
  expect(data.bvh.primitiveBuffer.length / data.bvh.primitiveBufferStride).toBe(2)
  expect(owner.snapshot()).toMatchObject({
    meshes: 2,
    geometries: 1,
    triangles: 6144,
    tlasStrategy: 'one-leaf-per-rigid-mesh',
  })
  owner.dispose()
  geometry.dispose()
  material.dispose()
})

it('releases a ready owner on abort, and keeps loader-owned materials and geometry alive', async () => {
  const source = fixture()
  const disposeGeometry = vi.spyOn(source.geometry, 'dispose')
  const controller = new AbortController()
  const owner = await createCarShadowBvh(source.root, controller.signal)
  const dispose = vi.spyOn(prototype, 'dispose')
  controller.abort()
  owner.dispose()
  expect(dispose).toHaveBeenCalledTimes(1)
  expect(owner.snapshot().disposed).toBe(true)
  expect(disposeGeometry).not.toHaveBeenCalled()
})

it('reports Worker errors and cannot revive an already aborted request', async () => {
  controls.fail = true
  const source = fixture()
  await expect(createCarShadowBvh(source.root, new AbortController().signal)).rejects.toThrow(
    'Worker failed',
  )
  const controller = new AbortController()
  controller.abort()
  await expect(createCarShadowBvh(source.root, controller.signal)).rejects.toMatchObject({
    name: 'AbortError',
  })
})

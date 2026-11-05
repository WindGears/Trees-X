/** Test-only module imported by the headless Vite harness, never by the application. */
import {
  BoxGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshPhysicalMaterial,
  Raycaster,
  Vector3,
  Matrix3,
} from 'three'
import { WebGPURenderer, StorageBufferAttribute } from 'three/webgpu'
import { Fn, float, storage, vec3, vec4 } from 'three/tsl'
import { createCarShadowBvh } from '../workbench/rendering/realtime/carShadow/bvh'

export async function runCarQueryFixture() {
  const renderer = new WebGPURenderer()
  await renderer.init()
  const geometry = new BoxGeometry(2, 2, 2)
  const material = new MeshPhysicalMaterial({ side: DoubleSide })
  const near = new Mesh(geometry, material)
  const far = new Mesh(geometry, material)
  near.name = 'near-door'
  far.name = 'far-body'
  far.position.z = -4
  const extras = [6, -6, 3].map((x) => {
    const mesh = new Mesh(geometry, material)
    mesh.position.set(x, 0, -1)
    mesh.name = `panel-${x}`
    return mesh
  })
  const objects = [extras[0]!, far, extras[1]!, near, extras[2]!]
  const root = new Group().add(...objects) // force spatial TLAS reorder
  const controller = new AbortController()
  const owner = await createCarShadowBvh(root, controller.signal)
  const rays = [
    { id: 'nearest', origin: [0.2, 0.3, 5], direction: [0, 0, -1], max: 0 },
    { id: 'miss', origin: [20, 0, 5], direction: [0, 0, -1], max: 0 },
    { id: 'bounded-miss', origin: [0.2, 0.3, 5], direction: [0, 0, -1], max: 3 },
    { id: 'bounded-hit', origin: [0.2, 0.3, 5], direction: [0, 0, -1], max: 10 },
    { id: 'inside', origin: [0, 0, 0], direction: [0, 0, 1], max: 10 },
    ...[6, -6, 3].map((x) => ({
      id: `reordered-${x}`,
      origin: [x + 0.2, 0.3, 5],
      direction: [0, 0, -1],
      max: 0,
    })),
  ]
  const output = new StorageBufferAttribute(rays.length * 5, 4)
  const buffer = storage(output, 'vec4', rays.length * 5)
  const kernel = Fn(() => {
    rays.forEach((ray, index) => {
      const origin = vec3(...(ray.origin as [number, number, number]))
      const direction = vec3(...(ray.direction as [number, number, number]))
      const hit = owner.nearestHit(origin, direction, float(ray.max))
      buffer
        .element(index * 5)
        .assign(vec4(float(hit.didHit), hit.distance, float(hit.objectIndex), hit.side))
      buffer.element(index * 5 + 1).assign(vec4(hit.normal, 0))
      buffer.element(index * 5 + 2).assign(vec4(hit.barycentric, 0))
      buffer.element(index * 5 + 3).assign(vec4(hit.indices))
      buffer
        .element(index * 5 + 4)
        .assign(vec4(float(owner.occluded(origin, direction, float(ray.max))), 0, 0, 0))
    })
  })().compute(1)
  const rounds = []
  try {
    for (const state of ['initial', 'transformed', 'hidden', 'restored']) {
      if (state === 'transformed') {
        near.scale.set(1.3, 0.7, 1.6)
        near.rotation.y = 0.35
      }
      if (state === 'hidden') near.visible = false
      if (state === 'restored') {
        near.visible = true
        near.scale.setScalar(1)
        near.rotation.set(0, 0, 0)
      }
      owner.sync()
      await renderer.computeAsync(kernel)
      const values = new Float32Array(await renderer.getArrayBufferAsync(output))
      const cases = rays.map((ray, index) => {
        const origin = new Vector3(...(ray.origin as [number, number, number]))
        const direction = new Vector3(...(ray.direction as [number, number, number]))
        const expected = new Raycaster(origin, direction, 0, ray.max || Infinity).intersectObjects(
          objects.filter((mesh) => mesh.visible),
          false,
        )[0]
        const normal = expected?.face?.normal
          .clone()
          .applyMatrix3(new Matrix3().getNormalMatrix(expected.object.matrixWorld))
          .normalize()
        const side = normal ? (normal.dot(direction) <= 0 ? 1 : -1) : 0
        normal?.multiplyScalar(side)
        const data = Array.from(values.slice(index * 20, index * 20 + 20))
        const recovered = new Vector3()
        if (data[0]) {
          for (let vertex = 0; vertex < 3; vertex++) {
            recovered.addScaledVector(
              new Vector3().fromBufferAttribute(
                geometry.getAttribute('position'),
                data[12 + vertex]!,
              ),
              data[8 + vertex]!,
            )
          }
          const source = owner.sourceForHit(data[2]!)
          if (!source) throw new Error('GPU hit has no semantic source')
          recovered.applyMatrix4(source.matrixWorld)
        }
        return {
          id: ray.id,
          gpu: data,
          sourceName: data[0] ? owner.sourceForHit(data[2]!)?.name : null,
          reconstructedPoint: recovered.toArray(),
          expected: expected
            ? {
                distance: expected.distance,
                sourceName: expected.object.name,
                normal: normal?.toArray(),
                side,
                point: expected.point.toArray(),
              }
            : null,
        }
      })
      rounds.push({ state, cases, resources: owner.snapshot() })
    }
    return { rounds, backend: renderer.backend.constructor.name }
  } finally {
    kernel.dispose()
    controller.abort()
    owner.dispose()
    geometry.dispose()
    material.dispose()
    renderer.dispose()
  }
}

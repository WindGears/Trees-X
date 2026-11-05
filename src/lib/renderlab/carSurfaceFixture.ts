/** GPU validation only. Not imported by the workbench or production entry. */
import {
  BoxGeometry,
  PlaneGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshPhysicalMaterial,
  Raycaster,
  Vector3,
  Matrix3,
  BufferAttribute,
  DataTexture,
  RGBAFormat,
  SRGBColorSpace,
  NearestFilter,
  Color,
  Vector2,
} from 'three'
import { WebGPURenderer, StorageBufferAttribute } from 'three/webgpu'
import { Fn, float, storage, vec3, vec4 } from 'three/tsl'
import { createCarShadowBvh } from '../workbench/rendering/realtime/carShadow/bvh'
import { carHitTextureSample } from '../workbench/rendering/realtime/carShadow/queryTexture'

export async function runCarSurfaceFixture() {
  const renderer = new WebGPURenderer()
  await renderer.init()
  const pixels = new Uint8Array([
    64, 128, 192, 255, 192, 64, 128, 255, 128, 192, 64, 255, 224, 160, 96, 255,
  ])
  const map = new DataTexture(pixels, 2, 2, RGBAFormat)
  map.colorSpace = SRGBColorSpace
  map.minFilter = map.magFilter = NearestFilter
  map.channel = 1
  map.repeat.set(0.8, 0.9)
  map.offset.set(0.1, 0.05)
  map.needsUpdate = true
  const box = new BoxGeometry(2, 2, 2),
    plane = new PlaneGeometry(2, 2)
  plane.addGroup(0, 3, 0)
  plane.addGroup(3, 3, 1)
  for (const geometry of [box, plane]) {
    const uv1 = geometry.getAttribute('uv').clone()
    for (let i = 0; i < uv1.count; i++)
      uv1.setXY(i, uv1.getX(i) * 0.5 + 0.1, uv1.getY(i) * 0.4 + 0.2)
    geometry.setAttribute('uv1', uv1)
    geometry.setAttribute(
      'treesPaintBevel',
      new BufferAttribute(new Float32Array(uv1.count).fill(0.7), 1),
    )
  }
  const materials = Array.from({ length: 6 }, (_, i) => {
    const material = new MeshPhysicalMaterial({ side: DoubleSide })
    material.name = `finish-${i}`
    return material
  })
  const left = new Mesh(plane, [materials[2]!, materials[5]!]),
    right = new Mesh(plane, [materials[4]!, materials[1]!])
  left.name = 'left-panel'
  right.name = 'right-panel'
  left.position.x = -3
  right.position.x = 3
  const center = new Mesh(box, materials)
  center.name = 'body'
  const root = new Group().add(right, center, left)
  const controller = new AbortController()
  const owner = await createCarShadowBvh(root, controller.signal, { surfaceData: true })
  const rays = [
    { id: 'body', origin: [0.2, 0.3, 5] },
    { id: 'left-triangle-0', origin: [-3.6, 0.5, 5] },
    { id: 'left-triangle-1', origin: [-2.4, -0.5, 5] },
    { id: 'right-triangle-0', origin: [2.4, 0.5, 5] },
    { id: 'right-triangle-1', origin: [3.6, -0.5, 5] },
  ]
  const output = new StorageBufferAttribute(rays.length * 5, 4)
  const buffer = storage(output, 'vec4', rays.length * 5)
  const kernel = Fn(() => {
    rays.forEach((ray, i) => {
      const hit = owner.nearestHit(
        vec3(...(ray.origin as [number, number, number])),
        vec3(0, 0, -1),
        float(100),
      )
      const surface = owner.surface(hit)
      const sampled = carHitTextureSample(map, surface, float(0))
      buffer
        .element(i * 5)
        .assign(
          vec4(
            float(hit.didHit),
            float(hit.objectIndex),
            float(surface.materialSlot),
            float(surface.flags),
          ),
        )
      buffer.element(i * 5 + 1).assign(vec4(surface.uv, surface.uv1))
      buffer.element(i * 5 + 2).assign(vec4(surface.position, surface.bevelWeight))
      buffer.element(i * 5 + 3).assign(vec4(surface.normal, 0))
      buffer.element(i * 5 + 4).assign(vec4(sampled.color.rgb, float(sampled.valid)))
    })
  })().compute(1)
  const rounds = []
  try {
    for (const state of ['initial', 'moving', 'restored']) {
      center.rotation.y = state === 'moving' ? 0.4 : 0
      center.scale.set(state === 'moving' ? 1.4 : 1, 1, state === 'moving' ? 0.7 : 1)
      owner.sync()
      await renderer.computeAsync(kernel)
      const values = new Float32Array(await renderer.getArrayBufferAsync(output))
      const cases = rays.map((ray, i) => {
        const expected = new Raycaster(
          new Vector3(...(ray.origin as [number, number, number])),
          new Vector3(0, 0, -1),
        ).intersectObject(root, true)[0]
        if (!expected?.face || !expected.uv || !expected.uv1)
          throw new Error('Surface fixture CPU hit incomplete')
        const expectedMaterial = (expected.object as Mesh).material
        const localSlot = expected.face.materialIndex
        const material = Array.isArray(expectedMaterial)
          ? expectedMaterial[localSlot]!
          : expectedMaterial
        const normal = expected
          .normal!.clone()
          .applyMatrix3(new Matrix3().getNormalMatrix(expected.object.matrixWorld))
          .normalize()
        const data = Array.from(values.slice(i * 20, i * 20 + 20))
        const sampleUv = new Vector2(expected.uv1.x * 0.8 + 0.1, expected.uv1.y * 0.9 + 0.05)
        const pixelIndex =
          (Math.min(1, Math.max(0, Math.floor(sampleUv.y * 2))) * 2 +
            Math.min(1, Math.max(0, Math.floor(sampleUv.x * 2)))) *
          4
        const color = new Color().setRGB(
          pixels[pixelIndex]! / 255,
          pixels[pixelIndex + 1]! / 255,
          pixels[pixelIndex + 2]! / 255,
          SRGBColorSpace,
        )
        return {
          id: ray.id,
          gpu: data,
          sourceName: owner.sourceForHit(data[1]!)?.name,
          materialName: owner.materialForHit(data[1]!, data[2]!)?.name,
          expected: {
            sourceName: expected.object.name,
            materialName: material.name,
            slot: localSlot,
            uv: expected.uv.toArray(),
            uv1: expected.uv1.toArray(),
            point: expected.point.toArray(),
            normal: normal.toArray(),
            color: color.toArray(),
          },
        }
      })
      rounds.push({ state, cases, resources: owner.snapshot() })
    }
    return { rounds, backend: renderer.backend.constructor.name }
  } finally {
    kernel.dispose()
    controller.abort()
    owner.dispose()
    box.dispose()
    plane.dispose()
    materials.forEach((material) => material.dispose())
    map.dispose()
    renderer.dispose()
  }
}

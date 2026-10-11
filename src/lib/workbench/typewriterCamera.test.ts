import { readFileSync } from 'node:fs'
import { Box3, Matrix4, PerspectiveCamera, Quaternion, Vector3 } from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseProduct } from './api'
import { createViewportFraming } from './viewportFraming'

const product = parseProduct(
  JSON.parse(
    readFileSync('server/src/main/resources/presentations/typewriter-kimi-v1.json', 'utf8'),
  ) as unknown,
)
interface GlbNode {
  matrix?: number[]
  translation?: [number, number, number]
  rotation?: [number, number, number, number]
  scale?: [number, number, number]
  mesh?: number
  children?: number[]
}
interface GlbJson {
  scene?: number
  scenes: { nodes: number[] }[]
  nodes: GlbNode[]
  meshes: { primitives: { attributes: { POSITION: number } }[] }[]
  accessors: { bufferView: number; componentType: number; count: number; byteOffset?: number }[]
  bufferViews: { byteOffset?: number; byteStride?: number }[]
}
const bytes = readFileSync('public/models/bundles/kimi-typewriter/v1/model.glb'),
  jsonLength = bytes.readUInt32LE(12),
  gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString()) as GlbJson,
  binary = bytes.subarray(28 + jsonLength)

// Decode every real primitive's positions and local transform. Long diagonal
// linkages have very loose accessor boxes, so projecting their box corners would
// overstate the rendered bounds. No substitute geometry or renderer is used.
function sourceVertices() {
  const source = product.presentation.source
  if (source.kind !== 'glb') throw new Error('Expected the real typewriter fixture')
  const chunks: Float64Array[] = [],
    point = new Vector3(),
    world = new Matrix4().compose(
      new Vector3(...source.transform.position),
      new Quaternion(),
      new Vector3().setScalar(source.transform.scale),
    )
  const visit = (index: number, parent: Matrix4) => {
    const node = gltf.nodes[index]!,
      local = node.matrix
        ? new Matrix4().fromArray(node.matrix)
        : new Matrix4().compose(
            new Vector3(...(node.translation ?? [0, 0, 0])),
            new Quaternion(...(node.rotation ?? [0, 0, 0, 1])),
            new Vector3(...(node.scale ?? [1, 1, 1])),
          ),
      transform = parent.clone().multiply(local)
    if (node.mesh != null)
      for (const primitive of gltf.meshes[node.mesh]!.primitives) {
        const accessor = gltf.accessors[primitive.attributes.POSITION]!,
          view = gltf.bufferViews[accessor.bufferView]!,
          base = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0),
          stride = view.byteStride ?? 12,
          chunk = new Float64Array(accessor.count * 3)
        if (accessor.componentType !== 5126) throw new Error('Fixture requires float positions')
        for (let i = 0; i < accessor.count; i++) {
          const offset = base + i * stride
          point
            .set(
              binary.readFloatLE(offset),
              binary.readFloatLE(offset + 4),
              binary.readFloatLE(offset + 8),
            )
            .applyMatrix4(transform)
            .toArray(chunk, i * 3)
        }
        chunks.push(chunk)
      }
    for (const child of node.children ?? []) visit(child, transform)
  }
  for (const node of gltf.scenes[gltf.scene ?? 0]!.nodes) visit(node, world)
  return chunks
}
const vertices = sourceVertices()

afterEach(() => vi.unstubAllGlobals())

describe('authored typewriter default camera', () => {
  it('narrows only the authored default observation by 0.88 and keeps reset consistent', () => {
    const camera = product.presentation.camera,
      perspective = product.presentation.views.find((view) => view.id === 'perspective')!,
      target = new Vector3(...camera.target),
      oldDirection = new Vector3(1.96, 1.574, 2.93).sub(target),
      direction = new Vector3(...camera.position).sub(target)
    expect(direction.length() / oldDirection.length()).toBeCloseTo(0.88, 12)
    expect(direction.clone().normalize().distanceTo(oldDirection.normalize())).toBeLessThan(1e-12)
    expect(camera.target).toEqual([0, 0.47, -0.15])
    expect(camera.minDistance).toBe(0.35)
    expect(camera.maxDistance).toBe(14)
    expect(perspective.position).toEqual(camera.position)
    expect(perspective.target).toEqual(camera.target)
    const generator = readFileSync('scripts/create-typewriter-presentation.mjs', 'utf8'),
      cameraDefinition = generator.split('const camera = {')[1]!.split('const product = {')[0]!
    expect(cameraDefinition).toContain('position: [' + camera.position.join(', ') + ']')
  })

  it('leaves authored structure, flat and alternative observation cameras intact', () => {
    const views = product.presentation.views
    expect(views.find((view) => view.id === 'front')).toMatchObject({
      position: [0, 1.1, 3.9],
      target: [0, 0.47, -0.15],
    })
    expect(views.find((view) => view.id === 'side')).toMatchObject({
      position: [3.9, 1.4, -0.15],
      target: [0, 0.47, -0.15],
    })
    expect(views.find((view) => view.id === 'top')).toMatchObject({
      position: [0, 4, 0.2],
      target: [0, 0.47, -0.15],
    })
    expect(views.find((view) => view.id === 'structure')).toMatchObject({
      position: [3.6, 3.6, 5.1],
      target: [0, 0.75, -0.4],
    })
    expect(views.find((view) => view.id === 'knoll')).toMatchObject({
      position: [0, 8, 0.01],
      target: [0, 0, 0],
    })
  })

  it('keeps actual real GLB vertex bounds inside the desktop stage with and without the inspector', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    for (const [width, height] of [
      [1280, 720],
      [1440, 1000],
      [1920, 1080],
    ] as const) {
      const camera = new PerspectiveCamera(38, width / height, 0.05, 250),
        framing = createViewportFraming(() => {}),
        point = new Vector3()
      camera.position.fromArray(product.presentation.camera.position)
      camera.lookAt(new Vector3(...product.presentation.camera.target))
      camera.updateMatrixWorld()
      try {
        for (const inspector of [false, true]) {
          framing.update(camera, width, height, true, inspector, false)
          const projected = new Box3()
          for (const chunk of vertices)
            for (let i = 0; i < chunk.length; i += 3) {
              point.fromArray(chunk, i).project(camera)
              projected.expandByPoint(
                point.set((point.x * 0.5 + 0.5) * width, (-point.y * 0.5 + 0.5) * height, point.z),
              )
            }
          expect(projected.min.x).toBeGreaterThan(136)
          expect(projected.max.x).toBeLessThan(width - (inspector ? 348 : 28))
          expect(projected.min.y).toBeGreaterThan(160)
          expect(projected.max.y).toBeLessThan(height - 130)
          expect(projected.min.z).toBeGreaterThan(-1)
          expect(projected.max.z).toBeLessThan(1)
        }
      } finally {
        framing.dispose()
      }
    }
  })
})

import { readFileSync } from 'node:fs'
import { Group, Matrix4, Quaternion, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { parseProduct } from './api'
import { bindTypewriterRig, parseTypewriterRig } from './typewriterRig'

const parts = parseTypewriterRig(
  JSON.parse(readFileSync('public/models/bundles/kimi-typewriter/v1/rig.json', 'utf8')) as unknown,
)
const product = parseProduct(
  JSON.parse(
    readFileSync('server/src/main/resources/presentations/typewriter-kimi-v1.json', 'utf8'),
  ) as unknown,
)
interface GlbNode {
  name?: string
  matrix?: number[]
  translation?: [number, number, number]
  rotation?: [number, number, number, number]
  scale?: [number, number, number]
  mesh?: number
  children?: number[]
}
interface GlbJson {
  nodes: GlbNode[]
  meshes: { primitives: { attributes: { POSITION: number }; material?: number }[] }[]
  materials: { name?: string }[]
  accessors: { bufferView: number; componentType: number; count: number; byteOffset?: number }[]
  bufferViews: { byteOffset?: number; byteStride?: number }[]
}
const bytes = readFileSync('public/models/bundles/kimi-typewriter/v1/model.glb'),
  jsonLength = bytes.readUInt32LE(12),
  gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString()) as GlbJson,
  binary = bytes.subarray(28 + jsonLength)

// Decode the real source positions with each mesh's local transform. The test
// uses no renderer, copied bounding boxes, or substitute geometric model.
function vertices(name: string, material?: string) {
  const part = gltf.nodes.find((node) => node.name === name)!,
    result: Vector3[] = []
  const visit = (node: GlbNode, parent: Matrix4) => {
    const local = node.matrix
      ? new Matrix4().fromArray(node.matrix)
      : new Matrix4().compose(
          new Vector3(...(node.translation ?? [0, 0, 0])),
          new Quaternion(...(node.rotation ?? [0, 0, 0, 1])),
          new Vector3(...(node.scale ?? [1, 1, 1])),
        )
    const transform = parent.clone().multiply(local)
    if (node.mesh != null)
      for (const primitive of gltf.meshes[node.mesh]!.primitives) {
        if (
          material &&
          (primitive.material == null || gltf.materials[primitive.material]?.name !== material)
        )
          continue
        const accessor = gltf.accessors[primitive.attributes.POSITION]!,
          view = gltf.bufferViews[accessor.bufferView]!,
          start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0),
          stride = view.byteStride ?? 12
        if (accessor.componentType !== 5126) throw new Error('Fixture requires float positions')
        for (let i = 0; i < accessor.count; i++) {
          const offset = start + i * stride
          result.push(
            new Vector3(
              binary.readFloatLE(offset),
              binary.readFloatLE(offset + 4),
              binary.readFloatLE(offset + 8),
            ).applyMatrix4(transform),
          )
        }
      }
    for (const child of node.children ?? []) visit(gltf.nodes[child]!, transform)
  }
  for (const child of part.children ?? []) visit(gltf.nodes[child]!, new Matrix4())
  return result
}
function fixture(index = 23) {
  const presentation = structuredClone(product.presentation),
    nodes = new Map<string, Group>()
  for (const part of parts) {
    const node = new Group()
    node.name = part.node
    node.userData.partId = part.id
    nodes.set(part.node, node)
  }
  const action = presentation.actions.find((item) => item.id === 'press-key')!
  action.node = parts.find((part) => part.group === 'keys' && part.index === index)!.node
  action.behavior = { type: 'typewriter-strike', index }
  return { nodes, apply: bindTypewriterRig(parts, nodes, presentation) }
}
const typebarVertices = new Map(
    parts
      .filter((part) => part.group === 'typebars')
      .map((part) => [part.node, vertices(part.node)]),
  ),
  platen = parts.find((part) => part.node === 'part-104')!,
  sleeveVertices = vertices(platen.node, 'rubber'),
  axis = new Vector3(1, 0, 0)

// The actual rubber sleeve is concentric on X, radius .44, half-length 4.26.
// Its values are checked against the source geometry, rather than assumed from
// a screenshot. A positive distance means the typebar vertex is outside it.
function clearance(point: Vector3) {
  return Math.hypot(point.y - platen.position[1], point.z - platen.position[2]) - 0.44
}

describe('typewriter bounded strike', () => {
  it('uses the actual GLB local pivots and restores the complete static pose exactly', () => {
    const { nodes, apply } = fixture(),
      position = new Vector3(),
      rotation = new Quaternion(),
      scale = new Vector3()
    apply({ 'explore-layout': 0, 'press-key': 0 })
    for (const part of parts) {
      const source = gltf.nodes.find((node) => node.name === part.node)!,
        node = nodes.get(part.node)!
      expect(source.matrix).toBeDefined()
      new Matrix4().fromArray(source.matrix!).decompose(position, rotation, scale)
      expect(position.distanceTo(node.position)).toBeLessThan(1e-11)
      expect(1 - Math.abs(rotation.dot(node.quaternion))).toBeLessThan(1e-11)
      expect(scale.distanceTo(new Vector3(1, 1, 1))).toBeLessThan(1e-11)
    }
  })

  it('reproduces the original A-bar platen penetration and keeps the corrected sampled trajectory clear', () => {
    const part = parts.find((item) => item.node === 'part-023')!,
      source = typebarVertices.get(part.node)!,
      rest = new Quaternion(...part.quaternion),
      position = new Vector3(...part.position),
      originalRotation = rest
        .clone()
        .multiply(new Quaternion().setFromAxisAngle(axis, -1.15 * 0.48)),
      { nodes, apply } = fixture(),
      point = new Vector3()
    const oldMinimum = Math.min(
      ...source.map((vertex) =>
        clearance(point.copy(vertex).applyQuaternion(originalRotation).add(position)),
      ),
    )
    expect(oldMinimum).toBeCloseTo(-0.3316543813098471, 8)
    let correctedMinimum = Infinity
    for (let i = 0; i <= 100; i++) {
      apply({ 'explore-layout': 0, 'press-key': i / 100 })
      const node = nodes.get(part.node)!
      for (const vertex of source)
        correctedMinimum = Math.min(
          correctedMinimum,
          clearance(point.copy(vertex).applyQuaternion(node.quaternion).add(node.position)),
        )
    }
    expect(correctedMinimum).toBeCloseTo(0.11765279876077545, 8)
  })

  it('checks every supported typebar binding against the real platen at 101 progress samples', () => {
    // The gold collars extend beyond the rubber sleeve. Verify the relevant
    // sleeve extents from the actual source mesh before using the analytic test.
    expect(sleeveVertices.length).toBeGreaterThan(0)
    expect(Math.max(...sleeveVertices.map((vertex) => Math.hypot(vertex.y, vertex.z)))).toBeCloseTo(
      0.44,
      6,
    )
    expect(Math.max(...sleeveVertices.map((vertex) => Math.abs(vertex.x)))).toBeCloseTo(4.26, 6)
    const point = new Vector3()
    let minimum = Infinity
    const supported = parts.filter(
      (item) =>
        item.group === 'typebars' &&
        parts.some((lever) => lever.group === 'levers' && lever.index === item.index),
    )
    expect(supported).toHaveLength(41)
    for (const part of supported) {
      const { nodes, apply } = fixture(part.index),
        node = nodes.get(part.node)!
      for (let i = 0; i <= 100; i++) {
        apply({ 'explore-layout': 0, 'press-key': i / 100 })
        for (const vertex of typebarVertices.get(part.node)!) {
          point.copy(vertex).applyQuaternion(node.quaternion).add(node.position)
          if (Math.abs(point.x) < 4.26) minimum = Math.min(minimum, clearance(point))
        }
      }
    }
    expect(minimum).toBeCloseTo(0.04905298529712049, 8)
  })

  it('keeps the stroke visible, preserves key and lever coupling, and restores without drift', () => {
    const { nodes, apply } = fixture(),
      key = nodes.get('part-070')!,
      lever = nodes.get('part-138')!,
      bar = nodes.get('part-023')!,
      tip = typebarVertices.get(bar.name)!.reduce((a, b) => (a.z > b.z ? a : b)),
      point = new Vector3()
    const snapshot = () =>
      [key, lever, bar].map((node) => [node.position.toArray(), node.quaternion.toArray()])
    apply({ 'explore-layout': 0, 'press-key': 0 })
    const rest = snapshot(),
      restY = point.copy(tip).applyQuaternion(bar.quaternion).add(bar.position).y,
      leverRest = lever.quaternion.clone()
    apply({ 'explore-layout': 0, 'press-key': 1 })
    const stroke = snapshot()
    expect(key.position.y).toBeCloseTo(1.87 - 0.18)
    expect(lever.quaternion.angleTo(leverRest)).toBeCloseTo(0.08)
    expect(
      point.copy(tip).applyQuaternion(bar.quaternion).add(bar.position).y - restY,
    ).toBeGreaterThan(1)
    for (let i = 0; i < 50; i++) {
      apply({ 'explore-layout': 0, 'press-key': 0 })
      expect(snapshot()).toEqual(rest)
      apply({ 'explore-layout': 0, 'press-key': 1 })
      expect(snapshot()).toEqual(stroke)
    }
    apply({ 'explore-layout': 0.35, 'press-key': 0.5 })
    const combined = snapshot()
    apply({ 'explore-layout': 1, 'press-key': 0 })
    apply({ 'explore-layout': 0.35, 'press-key': 0.5 })
    expect(snapshot()).toEqual(combined)
    apply({ 'explore-layout': 1, 'press-key': 0 })
    const flatRotation = bar.quaternion.clone()
    apply({ 'explore-layout': 1, 'press-key': 1 })
    expect(bar.quaternion.equals(flatRotation)).toBe(true)
  })
})

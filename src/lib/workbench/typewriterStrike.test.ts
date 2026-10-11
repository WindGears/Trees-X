import { readFileSync } from 'node:fs'
import { BufferGeometry, Float32BufferAttribute, Group, Matrix4, Quaternion, Vector3 } from 'three'
import { MeshBVH } from 'three-mesh-bvh'
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
  meshes: {
    primitives: {
      attributes: { POSITION: number }
      material?: number
      indices?: number
      mode?: number
    }[]
  }[]
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
function vertices(name: string, material?: string, triangles = false) {
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
        const positions: Vector3[] = []
        for (let i = 0; i < accessor.count; i++) {
          const offset = start + i * stride
          positions.push(
            new Vector3(
              binary.readFloatLE(offset),
              binary.readFloatLE(offset + 4),
              binary.readFloatLE(offset + 8),
            ).applyMatrix4(transform),
          )
        }
        if (!triangles || primitive.indices == null) result.push(...positions)
        else {
          if ((primitive.mode ?? 4) !== 4) throw new Error('Fixture requires triangle primitives')
          const index = gltf.accessors[primitive.indices]!,
            indexView = gltf.bufferViews[index.bufferView]!,
            indexStart = (indexView.byteOffset ?? 0) + (index.byteOffset ?? 0),
            bytesPerIndex = { 5121: 1, 5123: 2, 5125: 4 }[index.componentType]
          if (!bytesPerIndex) throw new Error('Fixture has unsupported triangle indices')
          for (let i = 0; i < index.count; i++) {
            const offset = indexStart + i * (indexView.byteStride ?? bytesPerIndex),
              vertex =
                bytesPerIndex === 1
                  ? binary.readUInt8(offset)
                  : bytesPerIndex === 2
                    ? binary.readUInt16LE(offset)
                    : binary.readUInt32LE(offset)
            result.push(positions[vertex]!)
          }
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
function geometry(name: string, material?: string) {
  return new BufferGeometry().setAttribute(
    'position',
    new Float32BufferAttribute(
      vertices(name, material, true).flatMap((v) => v.toArray()),
      3,
    ),
  )
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

  it('keeps actual A-bar triangles clear of the moving platen throughout layering and flattening', () => {
    const { nodes, apply } = fixture(),
      bar = nodes.get('part-023')!,
      roller = nodes.get(platen.node)!,
      root = new Group(),
      barGeometry = geometry(bar.name),
      rollerGeometry = geometry(platen.node, 'rubber'),
      relative = new Matrix4(),
      point = new Vector3(),
      source = typebarVertices.get(bar.name)!
    // Preserve mesh-child transforms when decoding, then exercise a shared
    // transformed ancestor as used by the runtime's instanced model. Broad-phase
    // box overlap is not a failure: intersectsGeometry checks source triangles.
    for (const node of nodes.values()) root.add(node)
    root.position.set(2, -0.02, 1)
    root.rotation.y = 0.43
    root.scale.setScalar(0.16)
    const bvh = new MeshBVH(rollerGeometry),
      penetrations: { layout: number; strike: number }[] = []
    let minimum = Infinity
    const transform = () => {
      root.updateMatrixWorld(true)
      return relative.copy(roller.matrixWorld).invert().multiply(bar.matrixWorld)
    }
    try {
      apply({ 'explore-layout': 0, 'press-key': 0 })
      bar.quaternion.multiply(new Quaternion().setFromAxisAngle(axis, -1.15 * 0.48))
      // A positive control proves this catches the known source penetration,
      // rather than only seeing the two parts' bounding boxes overlap.
      expect(bvh.intersectsGeometry(barGeometry, transform())).toBe(true)
      for (let i = 0; i <= 100; i++)
        for (let j = 0; j <= 20; j++) {
          const layout = i / 100,
            strike = j / 20
          apply({ 'explore-layout': layout, 'press-key': strike })
          transform()
          if (bvh.intersectsGeometry(barGeometry, relative)) penetrations.push({ layout, strike })
          for (const vertex of source) {
            point.copy(vertex).applyMatrix4(relative)
            if (Math.abs(point.x) < 4.26)
              minimum = Math.min(minimum, Math.hypot(point.y, point.z) - 0.44)
          }
        }
      expect(penetrations).toEqual([])
      expect(minimum).toBeCloseTo(0.11765279876077545, 8)
    } finally {
      barGeometry.dispose()
      rollerGeometry.dispose()
    }
  }, 15000)

  it('separates the actual cover triangles from the platen, bridge and typebar fan in layered views', () => {
    const { nodes, apply } = fixture(),
      names = ['part-023', 'part-095', 'part-096', 'part-097', 'part-104'],
      geometries = new Map(names.map((name) => [name, geometry(name)])),
      bvhs = new Map(names.map((name) => [name, new MeshBVH(geometries.get(name)!)])),
      pairs = [
        ['part-095', 'part-104'],
        ['part-096', 'part-097'],
        ['part-023', 'part-097'],
      ] as const,
      relative = new Matrix4()
    for (const name of names) geometries.get(name)!.boundsTree = bvhs.get(name)!
    const intersects = (a: string, b: string) => {
      const first = nodes.get(a)!,
        second = nodes.get(b)!
      first.updateMatrixWorld(true)
      second.updateMatrixWorld(true)
      relative.copy(first.matrixWorld).invert().multiply(second.matrixWorld)
      return bvhs.get(a)!.intersectsGeometry(geometries.get(b)!, relative)
    }
    try {
      apply({ 'explore-layout': 0.6, 'press-key': 0 })
      // Reconstruct the source's two exploded cover positions, proving each
      // tested pair really crossed triangles before the runtime-only correction.
      nodes.get('part-095')!.position.fromArray(parts.find((p) => p.id === 95)!.exploded)
      nodes.get('part-097')!.position.fromArray(parts.find((p) => p.id === 97)!.exploded)
      for (const [a, b] of pairs) expect(intersects(a, b)).toBe(true)
      // Do not classify the source's assembled panel seams as penetrations.
      // Once covers are detached, exercise the complete layered-view interval.
      const crossings: { a: string; b: string; layout: number; strike: number }[] = []
      for (let i = 5; i <= 60; i++)
        for (let j = 0; j <= 20; j++) {
          apply({ 'explore-layout': i / 100, 'press-key': j / 20 })
          for (const [a, b] of pairs)
            if (intersects(a, b)) crossings.push({ a, b, layout: i / 100, strike: j / 20 })
        }
      expect(crossings).toEqual([])
      for (const progress of [0, 1]) {
        apply({ 'explore-layout': progress, 'press-key': 0 })
        for (const id of [95, 97]) {
          const part = parts.find((p) => p.id === id)!
          expect(
            nodes
              .get(part.node)!
              .position.distanceTo(new Vector3(...(progress === 0 ? part.position : part.flat))),
          ).toBeLessThan(1e-11)
        }
      }
    } finally {
      for (const geometry of geometries.values()) geometry.dispose()
    }
  }, 15000)

  it('packs all 44 typebars and 11 broad parts without triangle crossings at 401 intermediate samples', () => {
    const { nodes, apply } = fixture(),
      primary = [95, 96, 97, 98, 103, 104, 105, 106, 107, 108, 109].map(
        (id) => parts.find((part) => part.id === id)!.node,
      ),
      bars = parts.filter((part) => part.group === 'typebars').map((part) => part.node),
      names = [...primary, ...bars],
      geometries = new Map(names.map((name) => [name, geometry(name)])),
      bvhs = new Map(names.map((name) => [name, new MeshBVH(geometries.get(name)!)])),
      pairs: [string, string][] = [],
      root = new Group(),
      relative = new Matrix4()
    for (const node of nodes.values()) root.add(node)
    root.scale.setScalar(0.16)
    for (const name of names) geometries.get(name)!.boundsTree = bvhs.get(name)!
    for (let i = 0; i < primary.length; i++)
      for (let j = i + 1; j < primary.length; j++) pairs.push([primary[i]!, primary[j]!])
    for (const bar of bars) for (const part of primary) pairs.push([bar, part])
    const intersects = (a: string, b: string) => {
      relative.copy(nodes.get(a)!.matrixWorld).invert().multiply(nodes.get(b)!.matrixWorld)
      return bvhs.get(a)!.intersectsGeometry(geometries.get(b)!, relative)
    }
    const sourcePose = (progress: number) => {
      apply({ 'explore-layout': progress, 'press-key': 0 })
      const t = (progress - 0.6) / 0.4,
        flat = t * t * (3 - 2 * t)
      for (const name of names) {
        const part = parts.find((part) => part.node === name)!,
          node = nodes.get(name)!
        node.position.fromArray(part.exploded).lerp(new Vector3(...part.flat), flat)
        node.quaternion
          .fromArray(part.explodedQuaternion)
          .slerp(new Quaternion(...part.flatQuaternion), flat)
      }
      root.updateMatrixWorld(true)
    }
    try {
      expect(bars).toHaveLength(44)
      expect(pairs).toHaveLength(539)
      sourcePose(0.75)
      for (const [a, b] of [
        ['part-095', 'part-104'],
        ['part-096', 'part-104'],
        ['part-103', 'part-104'],
      ])
        expect(intersects(a!, b!)).toBe(true)
      sourcePose(0.8)
      expect(intersects('part-104', 'part-107')).toBe(true)
      const crossings: { a: string; b: string; progress: number }[] = []
      for (let i = 600; i <= 1000; i++) {
        const progress = i / 1000
        apply({ 'explore-layout': progress, 'press-key': 0 })
        root.updateMatrixWorld(true)
        for (const [a, b] of pairs) if (intersects(a, b)) crossings.push({ a, b, progress })
      }
      expect(crossings).toEqual([])
      // Packing windows preserve the exact final pose of every source part.
      for (const part of parts)
        expect(nodes.get(part.node)!.position.distanceTo(new Vector3(...part.flat))).toBeLessThan(
          1e-11,
        )
    } finally {
      for (const geometry of geometries.values()) geometry.dispose()
    }
  }, 15000)
})

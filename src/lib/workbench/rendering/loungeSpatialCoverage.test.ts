import { readFileSync } from 'node:fs'
import {
  Box3,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
} from 'three'
import { expect, it } from 'vitest'
import { parseProduct } from '../api'
import { bindTypewriterRig, parseTypewriterRig } from '../typewriterRig'
import { loungeMotionBounds, loungeTableDimensions } from './loungeSpatialTable'

interface GlbNode {
  name?: string
  matrix?: number[]
  translation?: [number, number, number]
  rotation?: [number, number, number, number]
  scale?: [number, number, number]
  extras?: Record<string, unknown>
  mesh?: number
  children?: number[]
}
interface GeometryFixture {
  scene?: number
  scenes: { nodes: number[] }[]
  nodes: GlbNode[]
  meshes: { primitives: { attributes: { POSITION: number } }[] }[]
  accessors: { bufferView: number; componentType: number; count: number; byteOffset?: number }[]
  bufferViews: { byteOffset?: number; byteStride?: number }[]
}

it('covers every real v2 POSITION vertex at 101 actual rig states, not just node origins', () => {
  const bytes = readFileSync('public/models/bundles/kimi-typewriter/v2/model.glb'),
    length = bytes.readUInt32LE(12),
    gltf = JSON.parse(bytes.subarray(20, 20 + length).toString()) as GeometryFixture,
    binary = bytes.subarray(28 + length),
    material = new MeshBasicMaterial(),
    geometries = gltf.meshes.map((mesh) =>
      mesh.primitives.map((primitive) => {
        const accessor = gltf.accessors[primitive.attributes.POSITION]!,
          view = gltf.bufferViews[accessor.bufferView]!,
          offset = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0),
          stride = view.byteStride ?? 12,
          positions = new Float32Array(accessor.count * 3),
          geometry = new BufferGeometry()
        if (accessor.componentType !== 5126)
          throw new Error('Expected uncompressed float positions')
        for (let i = 0; i < accessor.count; i++)
          for (let axis = 0; axis < 3; axis++)
            positions[i * 3 + axis] = binary.readFloatLE(offset + i * stride + axis * 4)
        geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
        return geometry
      }),
    ),
    nodes = gltf.nodes.map((source) => {
      const node = new Group()
      node.name = source.name ?? ''
      Object.assign(node.userData, source.extras)
      if (source.matrix)
        new Matrix4().fromArray(source.matrix).decompose(node.position, node.quaternion, node.scale)
      else {
        node.position.fromArray(source.translation ?? [0, 0, 0])
        node.quaternion.fromArray(source.rotation ?? [0, 0, 0, 1])
        node.scale.fromArray(source.scale ?? [1, 1, 1])
      }
      if (source.mesh != null)
        for (const geometry of geometries[source.mesh]!) node.add(new Mesh(geometry, material))
      return node
    }),
    root = new Group()
  gltf.nodes.forEach((source, i) => {
    for (const child of source.children ?? []) nodes[i]!.add(nodes[child]!)
  })
  const product = parseProduct(
      JSON.parse(
        readFileSync('server/src/main/resources/presentations/typewriter-kimi-v1.json', 'utf8'),
      ) as unknown,
    ),
    source = product.presentation.source
  if (source.kind !== 'glb') throw new Error('Expected typewriter GLB')
  root.scale.setScalar(source.transform.scale)
  root.position.fromArray(source.transform.position)
  root.rotation.set(...source.transform.rotation)
  for (const node of gltf.scenes[gltf.scene ?? 0]!.nodes) root.add(nodes[node]!)
  const parts = parseTypewriterRig(
      JSON.parse(
        readFileSync('public/models/bundles/kimi-typewriter/v2/rig.json', 'utf8'),
      ) as unknown,
    ),
    apply = bindTypewriterRig(
      parts,
      new Map(nodes.map((node) => [node.name, node])),
      product.presentation,
    ),
    action = product.presentation.actions.find(
      (a) => a.motion?.program?.type === 'typewriter-layout-v1',
    )!,
    envelope = new Box3()
  try {
    for (let i = 0; i <= 100; i++) {
      apply({ [action.id]: i / 100 })
      root.updateMatrixWorld(true)
      const current = new Box3().setFromObject(root, true)
      envelope.union(current)
      expect(current.min.x).toBeGreaterThan(-loungeTableDimensions.width / 2 + 0.1)
      expect(current.max.x).toBeLessThan(loungeTableDimensions.width / 2 - 0.1)
      expect(current.min.z).toBeGreaterThan(-loungeTableDimensions.depth / 2 + 0.1)
      expect(current.max.z).toBeLessThan(loungeTableDimensions.depth / 2 - 0.1)
    }
    for (let axis = 0; axis < 3; axis++) {
      expect(envelope.min.getComponent(axis)).toBeCloseTo(loungeMotionBounds.min[axis]!, 6)
      expect(envelope.max.getComponent(axis)).toBeCloseTo(loungeMotionBounds.max[axis]!, 6)
    }
    expect(parts).toHaveLength(572)
  } finally {
    root.clear()
    for (const primitives of geometries) for (const geometry of primitives) geometry.dispose()
    material.dispose()
  }
}, 15000)

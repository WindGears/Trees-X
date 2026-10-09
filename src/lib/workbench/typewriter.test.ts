import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  BoxGeometry,
  Group,
  InstancedMesh,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from 'three'
import { parseProduct } from './api'
import { bindTypewriterRig, parseTypewriterRig } from './typewriterRig'
import { instanceTypewriter } from './typewriterInstances'

const file = JSON.parse(
  readFileSync('public/models/bundles/kimi-typewriter/v1/rig.json', 'utf8'),
) as unknown
const parts = parseTypewriterRig(file)
const product = parseProduct(
  JSON.parse(
    readFileSync('server/src/main/resources/presentations/typewriter-kimi-v1.json', 'utf8'),
  ) as unknown,
)
function fixture() {
  const root = new Group(),
    nodes = new Map<string, Group>()
  for (const part of parts) {
    const node = new Group()
    node.name = part.node
    node.userData.partId = part.id
    node.position.fromArray(part.position)
    node.quaternion.fromArray(part.quaternion)
    root.add(node)
    nodes.set(part.node, node)
  }
  return { root, nodes, apply: bindTypewriterRig(parts, nodes, product.presentation) }
}
describe('owner-created typewriter migration', () => {
  it('matches source runtime poses at 101 points across every semantic group', () => {
    const reference = JSON.parse(
      readFileSync('src/lib/workbench/__fixtures__/typewriter-source-poses.json', 'utf8'),
    ) as {
      samples: {
        progress: number
        parts: {
          id: number
          position: [number, number, number]
          quaternion: [number, number, number, number]
        }[]
      }[]
    }
    const { nodes, apply } = fixture()
    for (const sample of reference.samples) {
      apply({ 'explore-layout': sample.progress })
      for (const expected of sample.parts) {
        const node = nodes.get(parts.find((p) => p.id === expected.id)!.node)!
        expect(node.position.distanceTo(new Vector3(...expected.position))).toBeLessThan(1e-11)
        expect(
          1 - Math.abs(node.quaternion.dot(new Quaternion(...expected.quaternion))),
        ).toBeLessThan(1e-11)
      }
    }
  })
  it('has deterministic reverse samples and no drift after 50 round trips', () => {
    const { nodes, apply } = fixture()
    const snapshot = () =>
      [...nodes.values()].map((node) => [node.position.toArray(), node.quaternion.toArray()])
    const forward = Array.from({ length: 101 }, (_, i) => {
      apply({ 'explore-layout': i / 100 })
      return snapshot()
    })
    for (let i = 100; i >= 0; i--) {
      apply({ 'explore-layout': i / 100 })
      expect(snapshot()).toEqual(forward[i])
    }
    for (let i = 0; i < 50; i++) {
      apply({ 'explore-layout': 1 })
      apply({ 'explore-layout': 0 })
    }
    expect(snapshot()).toEqual(forward[0])
    apply({ 'explore-layout': 0.35, 'press-key': 1 })
    const active = snapshot()
    apply({ 'explore-layout': 1, 'press-key': 0 })
    apply({ 'explore-layout': 0.35, 'press-key': 1 })
    expect(snapshot()).toEqual(active)
  })
  it('rejects unregistered programs, unsafe paths, wrong adapters and invalid strike bindings', () => {
    for (const mutate of [
      (p: typeof product) => {
        p.presentation.source = { kind: 'procedural', key: 'typewriter' }
      },
      (p: typeof product) => {
        p.presentation.actions[1]!.motion!.program = {
          type: 'typewriter-layout-v1',
          file: '../rig.json',
        }
      },
      (p: typeof product) => {
        p.presentation.actions[0]!.behavior = { type: 'typewriter-strike', index: 44 }
      },
    ]) {
      const bad = structuredClone(product)
      mutate(bad)
      expect(() => parseProduct(bad)).toThrow()
    }
    const p = structuredClone(product)
    p.presentation.actions[0]!.node = 'part-000'
    expect(() => bindTypewriterRig(parts, fixture().nodes, p.presentation)).toThrow('击发')
    expect(() =>
      parseTypewriterRig({ version: 1, type: 'typewriter-layout-v1', parts: [parts[0], parts[0]] }),
    ).toThrow('重复')
  })
  it('preserves per-part hit identity and leaves shared geometry to the loader', () => {
    const model = new Group(),
      geometry = new BoxGeometry(),
      material = new MeshStandardMaterial()
    const nodes = new Map<string, Group>()
    for (const p of parts.slice(0, 2)) {
      const node = new Group()
      node.name = p.node
      node.position.set(p.id, 0, 0)
      const surface = new Mesh(geometry, material)
      surface.position.set(0.5, 0, 0)
      node.add(surface)
      model.add(node)
      nodes.set(node.name, node)
    }
    let disposed = 0
    geometry.addEventListener('dispose', () => disposed++)
    const instances = instanceTypewriter(model, parts.slice(0, 2), nodes)
    instances.update()
    const mesh = model.children.find((node) => node instanceof InstancedMesh) as InstancedMesh
    expect(mesh.count).toBe(2)
    expect(mesh.geometry).toBe(geometry)
    expect(instances.nodeForHit(mesh, 1)).toBe(nodes.get(parts[1]!.node))
    instances.select(parts[1]!.node)
    expect(mesh.instanceColor).not.toBeNull()
    instances.dispose()
    instances.dispose()
    expect(disposed).toBe(0)
    geometry.dispose()
    material.dispose()
    expect(disposed).toBe(1)
  })
})

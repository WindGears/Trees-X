import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { Box3, Group, Matrix4, PropertyBinding, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { parseProduct } from '../../api'
import { bindMotionPose } from '../../motionPose'
import { progressActions } from '../../motionConfig'
import { createDdgiVolume, ddgiBudget } from './ddgi/contract'
import {
  realtimeProductProfile,
  realtimeSceneProfile,
  reventonMotionEnvelope,
  reventonRealtimeProfile,
  typewriterRealtimeProfile,
} from './productProfile'

interface GltfDocument {
  scene?: number
  scenes: { nodes: number[] }[]
  nodes: {
    name: string
    matrix?: number[]
    translation?: number[]
    rotation?: number[]
    scale?: number[]
    children?: number[]
    mesh?: number
  }[]
  meshes: { primitives: { attributes: { POSITION: number } }[] }[]
  accessors: { min: number[]; max: number[] }[]
}

function box(bounds: { min: readonly number[]; max: readonly number[] }) {
  return new Box3(new Vector3().fromArray(bounds.min), new Vector3().fromArray(bounds.max))
}

/** CPU hierarchy and accessor boxes only: no renderer, GLTF texture decoding or
 * alteration of the authored asset. bindMotionPose is the production v3 rig.
 */
function carCoverage() {
  const bytes = readFileSync(reventonMotionEnvelope.source.model),
    gltf = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12))) as GltfDocument,
    raw: unknown = JSON.parse(readFileSync(reventonMotionEnvelope.source.configuration, 'utf8')),
    product = parseProduct(raw),
    source = product.presentation.source
  if (source.kind !== 'glb') throw new Error('Expected registered car GLB')
  expect(source.adapter).toBe(reventonRealtimeProfile.adapterId)
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(
    reventonMotionEnvelope.source.sha256,
  )
  const nodes = gltf.nodes.map((item) => {
    const node = new Group()
    node.name = PropertyBinding.sanitizeNodeName(item.name)
    if (item.matrix) node.applyMatrix4(new Matrix4().fromArray(item.matrix))
    else {
      node.position.fromArray(item.translation ?? [0, 0, 0])
      node.quaternion.fromArray(item.rotation ?? [0, 0, 0, 1])
      node.scale.fromArray(item.scale ?? [1, 1, 1])
    }
    return node
  })
  gltf.nodes.forEach((item, index) => {
    for (const child of item.children ?? []) nodes[index]!.add(nodes[child]!)
  })
  const root = new Group()
  for (const index of gltf.scenes[gltf.scene ?? 0]!.nodes) root.add(nodes[index]!)
  root.position.fromArray(source.transform.position)
  root.rotation.set(...source.transform.rotation)
  root.scale.setScalar(source.transform.scale)
  root.updateMatrixWorld(true)
  const byName = new Map(nodes.map((node) => [node.name, node])),
    apply = bindMotionPose(product.presentation, byName),
    groups = reventonMotionEnvelope.motionGroups.map((name) => {
      const node = byName.get(name)
      if (!node) throw new Error('Missing source motion group: ' + name)
      return { node, local: new Box3(), coverage: new Box3() }
    }),
    staticBounds = new Box3()
  expect(
    new Set(
      progressActions(product.presentation).flatMap((action) =>
        (action.motion.tracks ?? []).map((track) => track.node),
      ),
    ),
  ).toEqual(new Set(reventonMotionEnvelope.motionGroups))
  gltf.nodes.forEach((item, index) => {
    if (item.mesh === undefined) return
    const node = nodes[index]!,
      group = groups.find((candidate) => {
        let ancestor: Group | null = node
        while (ancestor) {
          if (ancestor === candidate.node) return true
          ancestor = ancestor.parent as Group | null
        }
        return false
      }),
      transform = group
        ? group.node.matrixWorld.clone().invert().multiply(node.matrixWorld)
        : node.matrixWorld
    for (const primitive of gltf.meshes[item.mesh]!.primitives) {
      const bounds = box(gltf.accessors[primitive.attributes.POSITION]!).applyMatrix4(transform)
      if (group) group.local.union(bounds)
      else staticBounds.union(bounds)
    }
  })
  const rest = staticBounds.clone()
  for (const group of groups) rest.union(group.local.clone().applyMatrix4(group.node.matrixWorld))
  return { root, groups, staticBounds, rest, apply }
}

describe('registered realtime product profiles', () => {
  it('uses adapter identity and keeps the car independent of lounge mood and depth of field', () => {
    expect(realtimeProductProfile('typewriter-v1')).toBe(typewriterRealtimeProfile)
    expect(realtimeProductProfile('reventon-v1')).toBe(reventonRealtimeProfile)
    for (const id of ['typewriter-study', 'reventon', 'Reventón 汽车', 'piano-v1', null])
      expect(realtimeProductProfile(id)).toBeUndefined()
    expect(typewriterRealtimeProfile).toMatchObject({ allowLoungeMood: true, allowLoungeDof: true })
    expect(reventonRealtimeProfile).toMatchObject({
      allowLoungeMood: false,
      allowLoungeDof: false,
      ddgiVolume: 'reventon-stage',
    })
  })

  it('reads only registered root metadata and restores profile identity after a product handoff', () => {
    const scene = new Group(),
      car = new Group(),
      typewriter = new Group()
    car.name = 'Arbitrary edited product title'
    car.userData.adapter = 'reventon-v1'
    typewriter.userData.adapter = 'typewriter-v1'
    expect(realtimeSceneProfile(scene)).toBeUndefined()
    scene.add(car)
    expect(realtimeSceneProfile(scene)).toBe(reventonRealtimeProfile)
    scene.remove(car)
    scene.add(typewriter)
    expect(realtimeSceneProfile(scene)).toBe(typewriterRealtimeProfile)
    scene.add(car)
    expect(() => realtimeSceneProfile(scene)).toThrow('multiple registered products')
  })

  it('covers all seven groups at every 101 x 101 independent door/separation combination', () => {
    const f = carCoverage(),
      volume = createDdgiVolume(undefined, reventonRealtimeProfile),
      envelope = box(reventonMotionEnvelope),
      pose = { 'open-doors': 0, 'explore-parts': 0 },
      sample = new Box3(),
      total = f.staticBounds.clone()
    expect(box(reventonMotionEnvelope.rest).containsBox(f.rest)).toBe(true)
    for (let doors = 0; doors < reventonMotionEnvelope.samplesPerAction; doors++) {
      for (let parts = 0; parts < reventonMotionEnvelope.samplesPerAction; parts++) {
        pose['open-doors'] = doors / 100
        pose['explore-parts'] = parts / 100
        f.apply(pose)
        f.root.updateMatrixWorld(true)
        for (const group of f.groups) {
          sample.copy(group.local).applyMatrix4(group.node.matrixWorld)
          group.coverage.union(sample)
          total.union(sample)
        }
      }
    }
    expect(f.groups).toHaveLength(7)
    for (const group of f.groups) {
      expect(group.coverage.isEmpty(), group.node.name).toBe(false)
      expect(envelope.containsBox(group.coverage), group.node.name).toBe(true)
      expect(volume.box.containsBox(group.coverage), group.node.name).toBe(true)
    }
    expect(envelope.containsBox(total)).toBe(true)
    expect(volume.box.containsBox(total)).toBe(true)
    expect(volume.res.toArray()).toEqual([12, 8, 16])
    expect(volume.probes * ddgiBudget.raysPerProbe).toBe(ddgiBudget.maxRaysPerTick)
  })
})

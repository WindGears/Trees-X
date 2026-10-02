import {
  Group,
  Mesh,
  MeshStandardMaterial,
  CylinderGeometry,
  SphereGeometry,
  Vector3,
  type BufferGeometry,
} from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import type { Vec3 } from './types'

export function modelKit() {
  const root = new Group(),
    nodes = new Map<string, Group>()
  const geometries = new Set<BufferGeometry>(),
    materials = new Set<MeshStandardMaterial>()
  const material = (color: string, metalness = 0, roughness = 0.5) => {
    const value = new MeshStandardMaterial({ color, metalness, roughness })
    materials.add(value)
    return value
  }
  const finish = material('#586879', 0.6, 0.35),
    dark = material('#151d26', 0.15, 0.6)
  const metal = material('#bbc6d0', 0.8, 0.25),
    rubber = material('#242c34', 0, 0.85)
  const paper = material('#e1ddd1', 0, 0.95),
    glass = material('#253e50', 0.6, 0.18)
  const bindings: { node: Group; base: Vector3; offset: Vector3 }[] = []
  function node(id: string, position: Vec3, offset: Vec3 = [0, 0, 0], parent = root) {
    if (nodes.has(id)) throw new Error('重复样板节点：' + id)
    const value = new Group()
    value.name = id
    value.position.fromArray(position)
    parent.add(value)
    nodes.set(id, value)
    bindings.push({ node: value, base: value.position.clone(), offset: new Vector3(...offset) })
    return value
  }
  function mesh(
    parent: Group,
    geometry: BufferGeometry,
    surface: MeshStandardMaterial,
    position: Vec3,
  ) {
    geometries.add(geometry)
    const value = new Mesh(geometry, surface)
    value.position.fromArray(position)
    value.castShadow = true
    value.receiveShadow = true
    parent.add(value)
    return value
  }
  const box = (parent: Group, size: Vec3, position: Vec3, surface = finish, radius = 0.06) =>
    mesh(
      parent,
      new RoundedBoxGeometry(...size, 2, Math.min(radius, ...size.map((s) => s / 4))),
      surface,
      position,
    )
  const cylinder = (
    parent: Group,
    radius: number,
    depth: number,
    position: Vec3,
    surface = metal,
  ) => mesh(parent, new CylinderGeometry(radius, radius, depth, 40), surface, position)
  const sphere = (parent: Group, radius: number, position: Vec3, surface = dark) =>
    mesh(parent, new SphereGeometry(radius, 24, 16), surface, position)
  let disposed = false
  return {
    root,
    nodes,
    bindings,
    finish,
    dark,
    metal,
    rubber,
    paper,
    glass,
    node,
    box,
    cylinder,
    sphere,
    resetPositions(explosion: number) {
      for (const b of bindings) b.node.position.copy(b.base).addScaledVector(b.offset, explosion)
    },
    dispose() {
      if (disposed) return
      disposed = true
      root.removeFromParent()
      geometries.forEach((g) => g.dispose())
      materials.forEach((m) => m.dispose())
      root.clear()
      nodes.clear()
    },
  }
}
export type ModelKit = ReturnType<typeof modelKit>

import { Quaternion, Vector3, type Object3D } from 'three'
import { list, number, object, string, vector } from './validation'
import type { ProductPresentation, Vec3 } from './types'

type Rotation = [number, number, number, number]
export interface TypewriterPart {
  node: string
  id: number
  group: string
  index: number
  phase: [number, number]
  position: Vec3
  exploded: Vec3
  flat: Vec3
  quaternion: Rotation
  explodedQuaternion: Rotation
  flatQuaternion: Rotation
}
const groups = ['keys', 'levers', 'typebars', 'ribbon', 'carriage', 'frame', 'hardware', 'shell']
function rotation(value: unknown): Rotation {
  if (!Array.isArray(value) || value.length !== 4) throw new Error('部件旋转数据无效')
  const result = value.map(number) as Rotation
  if (Math.abs(Math.hypot(...result) - 1) > 0.001) throw new Error('部件旋转须使用单位四元数')
  return result
}
export function parseTypewriterRig(value: unknown): TypewriterPart[] {
  const data = object(value)
  if (data.version !== 1 || data.type !== 'typewriter-layout-v1')
    throw new Error('打字机动作数据版本无效')
  const parts = list(data.parts, (value): TypewriterPart => {
    const p = object(value)
    if (!Array.isArray(p.phase) || p.phase.length !== 2) throw new Error('部件分层区间无效')
    const phase: [number, number] = [number(p.phase[0]), number(p.phase[1])]
    const id = number(p.id),
      index = number(p.index),
      group = string(p.group)
    if (
      !Number.isInteger(id) ||
      id < 0 ||
      !Number.isInteger(index) ||
      index < -1 ||
      phase[0] < 0 ||
      phase[1] > 1 ||
      phase[0] >= phase[1] ||
      !groups.includes(group)
    )
      throw new Error('部件分组或分层区间无效')
    return {
      node: string(p.node),
      id,
      index,
      group,
      phase,
      position: vector(p.position),
      exploded: vector(p.exploded),
      flat: vector(p.flat),
      quaternion: rotation(p.quaternion),
      explodedQuaternion: rotation(p.explodedQuaternion),
      flatQuaternion: rotation(p.flatQuaternion),
    }
  })
  if (
    !parts.length ||
    parts.length > 4096 ||
    new Set(parts.map((p) => p.node)).size !== parts.length ||
    new Set(parts.map((p) => p.id)).size !== parts.length
  )
    throw new Error('打字机部件数据为空或重复')
  return parts
}
const clamp = (v: number) => Math.max(0, Math.min(1, v))
const ease = (v: number) => {
  const x = clamp(v)
  return x * x * (3 - 2 * x)
}
const segment = (a: number, b: number, v: number) => ease((v - a) / (b - a))
// Source-specific spatial packing windows. These ten broad parts were proven
// to cross each other during the source's simultaneous straight-line flattening.
// Clear neighbouring parts horizontally, turn into the destination lane, then
// descend. No runtime collision solver or accumulated pose changes are needed.
const flatWindows: Partial<Record<number, readonly [number, number]>> = {
  104: [0.15, 0.4],
  106: [0, 0.15],
  105: [0.4, 0.6],
  107: [0.6, 0.8],
  103: [0.4, 0.65],
  108: [0.35, 0.6],
  109: [0.1, 0.35],
  96: [0.4, 0.7],
  95: [0.5, 0.8],
  97: [0.65, 1],
}

// Structure poses preserve the owner's source except two separated cover Z
// paths and ten broad parts' flattening routes. The exploded rear guard cut the
// platen and the hood cut the typebar fan/bridge cover. Clearance and staged
// packing preserve every source initial/flat endpoint and the progress contract.
// The strike is a bounded mechanism
// illustration: the source's 1.15 rad swing crossed the platen mid-stroke. A 0.35
// rad excursion keeps the source's 41 fully bound strike chains outside its
// rubber sleeve while retaining a visible rise. This is not a factory-calibrated
// printing mechanism. The other three typebars have no valid lever binding.
// Every update starts from rest; camera and rendering stay outside the controller.
export function bindTypewriterRig(
  parts: TypewriterPart[],
  nodes: Map<string, Object3D>,
  p: ProductPresentation,
) {
  const action = p.actions.find((a) => a.motion?.program?.type === 'typewriter-layout-v1')
  if (!action) throw new Error('打字机缺少结构展示动作')
  const strikes = p.actions.flatMap((a) =>
    a.behavior?.type === 'typewriter-strike'
      ? [{ id: a.id, index: a.behavior.index, node: a.node }]
      : [],
  )
  for (const strike of strikes) {
    if (
      !parts.some(
        (part) => part.node === strike.node && part.group === 'keys' && part.index === strike.index,
      ) ||
      !['typebars', 'levers'].every((group) =>
        parts.some((part) => part.group === group && part.index === strike.index),
      )
    )
      throw new Error('击发动作缺少对应的按键、键杠杆或字杆')
  }
  const bindings = parts.map((part) => {
    const node = nodes.get(part.node)
    if (!node || node.userData.partId !== part.id)
      throw new Error('模型与部件动作清单不一致：' + part.node)
    return {
      part,
      node,
      position: new Vector3(...part.position),
      exploded: new Vector3(...part.exploded),
      flat: new Vector3(...part.flat),
      quaternion: new Quaternion(...part.quaternion),
      explodedQuaternion: new Quaternion(...part.explodedQuaternion),
      flatQuaternion: new Quaternion(...part.flatQuaternion),
    }
  })
  const axis = new Vector3(1, 0, 0),
    delta = new Quaternion()
  return (pose: Record<string, number>) => {
    const value = clamp(pose[action.id] ?? 0),
      progress = clamp(value / 0.6),
      flat = segment(0.6, 1, value),
      packingProgress = clamp((value - 0.6) / 0.4)
    for (const b of bindings) {
      const { part, node } = b,
        f = segment(part.phase[0], part.phase[1], progress)
      node.position.copy(b.position).lerp(b.exploded, f).lerp(b.flat, flat)
      if (part.id === 95) node.position.z -= 1.55 * f * (1 - flat)
      else if (part.id === 97) node.position.z += 3.2 * f * (1 - flat)
      node.quaternion
        .copy(b.quaternion)
        .slerp(b.explodedQuaternion, part.group === 'typebars' ? segment(0.2, 1, f) : f)
        .slerp(b.flatQuaternion, flat)
      const window = flatWindows[part.id]
      if (value > 0.6 && window) {
        const t = segment(window[0], window[1], packingProgress),
          across = segment(0, 0.35, t),
          lane = segment(0.35, 0.65, t),
          down = segment(0.65, 1, t),
          sourceZ = b.exploded.z + (part.id === 95 ? -1.55 : part.id === 97 ? 3.2 : 0)
        node.position.set(
          b.exploded.x + (b.flat.x - b.exploded.x) * across,
          b.exploded.y + (b.flat.y - b.exploded.y) * down,
          sourceZ + (b.flat.z - sourceZ) * lane,
        )
        // The return lever leaves behind the rails before travelling sideways.
        if (part.id === 109) {
          node.position.x = b.exploded.x + (b.flat.x - b.exploded.x) * lane
          node.position.z = sourceZ + (b.flat.z - sourceZ) * across
        }
        // Clear the typebars' turn-to-flat sweep before packing the large hood.
        if (part.id === 97) node.position.z += 4 * segment(0, 0.1, packingProgress) * (1 - lane)
        node.quaternion.copy(b.explodedQuaternion).slerp(b.flatQuaternion, lane)
      }
      let hit = 0
      for (const strike of strikes)
        if (strike.index === part.index) hit = Math.max(hit, clamp(pose[strike.id] ?? 0))
      if (part.group === 'keys') node.position.y -= hit * 0.18
      else if (part.group === 'levers')
        node.quaternion.multiply(delta.setFromAxisAngle(axis, 0.08 * hit))
      else if (part.group === 'typebars')
        node.quaternion.multiply(delta.setFromAxisAngle(axis, -0.35 * hit * (1 - flat)))
    }
  }
}

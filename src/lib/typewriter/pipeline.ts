import {
  EXPLODE_PHASE,
  GROUPS,
  lerpTransform,
  smoothstep,
  type PartSpec,
  type Transform,
} from './spec'
import type { FlatPlacement } from './layout'

/**
 * 三态变换管线：进度 p ∈ [0,1] → 每零件的世界变换。
 * [0, 0.45)：整机 → 爆炸；[0.45, 1]：爆炸 → 平铺。
 * 组间错峰由 GROUPS.explodeStart 决定（外壳/字车架先行），组内由 stageOffset 铺开。
 */

const groupStart = new Map(GROUPS.map((g) => [g.id, g.explodeStart]))
const PART_SPAN = 0.3

function staged(p: number, part: PartSpec, phaseStart: number, phaseSpan: number): number {
  const local = (p - phaseStart) / phaseSpan
  const start = groupStart.get(part.group)! * (1 - PART_SPAN) + part.stageOffset * 0.6
  return smoothstep((local - start) / PART_SPAN)
}

export interface FlatPose {
  x: number
  z: number
  y: number
  yaw: number
}

/** 求某零件在进度 p 的世界变换 */
export function evaluateTransform(
  part: PartSpec,
  flat: FlatPlacement | undefined,
  p: number,
): Transform {
  const flatPose: Transform = flat
    ? { p: [flat.x, flat.y, flat.z], r: [0, flat.yaw, 0] }
    : part.exploded
  if (p <= 0) return part.assembled
  if (p >= 1) return flatPose

  if (p < EXPLODE_PHASE) {
    const t = staged(p, part, 0, EXPLODE_PHASE)
    return lerpTransform(part.assembled, part.exploded, t)
  }
  // 爆炸→平铺：先完成爆炸（可能在第一阶段没走完），再移向平铺位
  const explodeT = staged(EXPLODE_PHASE - 1e-6, part, 0, EXPLODE_PHASE)
  const explodedPose = lerpTransform(part.assembled, part.exploded, explodeT)
  const t = staged(p, part, EXPLODE_PHASE, 1 - EXPLODE_PHASE)
  return lerpTransform(explodedPose, flatPose, t)
}

/** 各阶段的相机关键帧（三分之四视角 → 高位展开 → 顶视平铺） */
export const CAMERA_KEYS = {
  /** 整机 */
  assembled: { position: [3.6, 2.4, 4.4] as const, target: [0, 0.62, 0.1] as const },
  /** 爆炸 */
  exploded: { position: [4.6, 3.6, 4.8] as const, target: [0, 0.85, 0.1] as const },
  /** 平铺顶视 */
  flat: { position: [0, 9.8, 0.01] as const, target: [0, 0, 0] as const },
}

export function cameraPoseAt(
  p: number,
  flatWidth: number,
  flatDepth: number,
): { position: [number, number, number]; target: [number, number, number] } {
  // 顶视时按版面尺寸后退
  const fitDist = Math.max(flatWidth, flatDepth) * 0.62 + 4.2
  const flatKey = {
    position: [0, Math.max(CAMERA_KEYS.flat.position[1], fitDist), 0.01] as const,
    target: CAMERA_KEYS.flat.target,
  }
  const keys =
    p < EXPLODE_PHASE
      ? ([CAMERA_KEYS.assembled, CAMERA_KEYS.exploded] as const)
      : ([CAMERA_KEYS.exploded, flatKey] as const)
  const span = p < EXPLODE_PHASE ? EXPLODE_PHASE : 1 - EXPLODE_PHASE
  const start = p < EXPLODE_PHASE ? 0 : EXPLODE_PHASE
  const t = smoothstep((p - start) / span)
  const a = keys[0]
  const b = keys[1]
  const mix = (x: number, y: number) => x + (y - x) * t
  return {
    position: [
      mix(a.position[0], b.position[0]),
      mix(a.position[1], b.position[1]),
      mix(a.position[2], b.position[2]),
    ],
    target: [mix(a.target[0], b.target[0]), mix(a.target[1], b.target[1]), mix(a.target[2], b.target[2])],
  }
}

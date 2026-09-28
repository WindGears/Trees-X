import { GROUPS, type GroupId, type PartSpec } from './spec'
import { buildKeys, type KeyPartIds } from './parts.keys'
import { buildLevers } from './parts.levers'
import { buildTypebars } from './parts.typebars'
import { buildRibbon } from './parts.ribbon'
import { buildCarriage } from './parts.carriage'
import { buildFrame } from './parts.frame'
import { buildShell } from './parts.shell'
import { buildHardware } from './parts.hardware'
import { CHARS } from './dim'

/**
 * 整机装配：合并八组零件，分配组内错峰，建立击发联动图。
 * 纯数据模块，可在 node 环境测试。
 */

export const EXPECTED_TOTAL = 572

export interface StrikeLink {
  char: string
  cap: string
  ring: string
  lever: string
  link: string
  typebar: string
}

export interface TypewriterSpec {
  parts: PartSpec[]
  byId: Map<string, PartSpec>
  byGroup: Map<GroupId, PartSpec[]>
  strike: Map<string, StrikeLink>
  /** 空格杆联动（键帽/键圈/键杆） */
  spaceStrike: { cap: string; ring: string; lever: string }
  /** 回车联动（回车臂/握把） */
  returnStrike: { arm: string; handle: string }
  keyIds: KeyPartIds[]
  counts: Record<GroupId, number>
}

let cachedSpec: TypewriterSpec | null = null

export function typewriterSpec(): TypewriterSpec {
  if (cachedSpec) return cachedSpec

  const keys = buildKeys()
  const levers = buildLevers()
  const typebars = buildTypebars()
  const ribbon = buildRibbon()
  const carriage = buildCarriage()
  const frame = buildFrame()
  const shell = buildShell()
  const hardware = buildHardware()

  const parts = [
    ...shell.parts,
    ...carriage.parts,
    ...ribbon.parts,
    ...typebars.parts,
    ...keys.parts,
    ...levers.parts,
    ...frame.parts,
    ...hardware.parts,
  ]

  // 组内错峰：按生成顺序铺开 0..0.14
  const byGroup = new Map<GroupId, PartSpec[]>()
  for (const meta of GROUPS) byGroup.set(meta.id, [])
  for (const part of parts) byGroup.get(part.group)!.push(part)
  for (const list of byGroup.values()) {
    const n = list.length
    list.forEach((part, i) => {
      part.stageOffset = n > 1 ? (i / (n - 1)) * 0.14 : 0
    })
  }

  // 击发联动图：字符 → 键帽/键圈/键杆/拉线/字杆
  const strike = new Map<string, StrikeLink>()
  const charKeys = keys.keyIds.filter((k) => k.char !== undefined)
  for (let i = 0; i < CHARS.length; i++) {
    const key = charKeys[i]!
    strike.set(CHARS[i]!, {
      char: CHARS[i]!,
      cap: key.cap,
      ring: key.ring,
      lever: levers.leverIds[key.keyIndex]!,
      link: levers.linkIds[i]!,
      typebar: typebars.barIds[i]!,
    })
  }

  const counts = Object.fromEntries(
    GROUPS.map((g) => [g.id, byGroup.get(g.id)!.length]),
  ) as Record<GroupId, number>

  const spaceKey = keys.keyIds.find((k) => k.fn === 'space')!
  const returnArm = carriage.parts.find((p) => p.name === '回车臂')!
  const returnHandle = carriage.parts.find((p) => p.name === '回车握把')!

  cachedSpec = {
    parts,
    byId: new Map(parts.map((p) => [p.id, p])),
    byGroup,
    strike,
    spaceStrike: {
      cap: spaceKey.cap,
      ring: spaceKey.ring,
      lever: levers.leverIds[spaceKey.keyIndex]!,
    },
    returnStrike: { arm: returnArm.id, handle: returnHandle.id },
    keyIds: keys.keyIds,
    counts,
  }
  return cachedSpec
}

/** 供测试使用：丢弃缓存（几何缓存请配合 clearGeometryCache） */
export function resetTypewriterSpec() {
  cachedSpec = null
}

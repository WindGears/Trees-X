import type { GroupId, PartSpec } from './spec'

/**
 * 平铺布局求解器：将全部零件以「组块」装进 16:9 矩形。
 * - 组内按占地降序做货架式行排（shelf packing）
 * - 组块按固定顺序做三列砌放，最后整体居中并外扩到 16:9
 * 确定性算法，可在 node 环境测试无重叠与边界。
 */

export interface FlatPlacement {
  x: number
  z: number
  y: number
  yaw: number
}

export interface FlatLayout {
  placements: Map<string, FlatPlacement>
  width: number
  depth: number
}

const GAP = 0.05
/** 组块在版面中的相对槽位顺序：从左到右、从上到下阅读 */
const GROUP_SLOTS: { id: GroupId; col: number }[] = [
  { id: 'shell', col: 0 },
  { id: 'carriage', col: 1 },
  { id: 'typebars', col: 2 },
  { id: 'frame', col: 0 },
  { id: 'keys', col: 1 },
  { id: 'levers', col: 2 },
  { id: 'ribbon', col: 0 },
  { id: 'hardware', col: 1 },
]

/** 各组货架排布的目标行宽（按零件尺寸调参，测试保证不溢出） */
const ROW_WIDTH: Record<GroupId, number> = {
  shell: 3.0,
  carriage: 2.9,
  typebars: 2.4,
  keys: 2.5,
  levers: 2.3,
  frame: 3.0,
  ribbon: 2.2,
  hardware: 2.6,
}

interface Block {
  id: GroupId
  col: number
  width: number
  depth: number
  items: { part: PartSpec; x: number; z: number }[]
}

/** 旋转后的 AABB 占地 */
function rotatedFootprint(part: PartSpec): [number, number] {
  const [w, d] = part.flatSize
  const c = Math.abs(Math.cos(part.flatYaw))
  const s = Math.abs(Math.sin(part.flatYaw))
  return [w * c + d * s, w * s + d * c]
}

function packGroup(parts: PartSpec[], rowWidth: number): Block['items'] & { w: number; d: number } {
  const sorted = [...parts].sort((a, b) => {
    const fa = rotatedFootprint(a)
    const fb = rotatedFootprint(b)
    return fb[1] - fa[1] || fb[0] - fa[0]
  })
  const items: { part: PartSpec; x: number; z: number }[] = []
  let x = 0
  let z = 0
  let rowH = 0
  let blockW = 0
  for (const part of sorted) {
    const [w, d] = rotatedFootprint(part)
    if (x > 0 && x + w > rowWidth) {
      x = 0
      z += rowH + GAP
      rowH = 0
    }
    items.push({ part, x: x + w / 2, z: z + d / 2 })
    x += w + GAP
    rowH = Math.max(rowH, d)
    blockW = Math.max(blockW, x - GAP)
  }
  const blockD = z + rowH
  return Object.assign(items, { w: blockW, d: blockD })
}

export function solveFlatLay(parts: PartSpec[]): FlatLayout {
  const blocks: Block[] = []
  for (const slot of GROUP_SLOTS) {
    const groupParts = parts.filter((p) => p.group === slot.id)
    const packed = packGroup(groupParts, ROW_WIDTH[slot.id])
    blocks.push({
      id: slot.id,
      col: slot.col,
      width: packed.w,
      depth: packed.d,
      items: packed,
    })
  }

  // 三列砌放：列宽 = 列内最大块宽；块在列内自上而下
  const cols: Block[][] = [[], [], []]
  for (const block of blocks) cols[block.col]!.push(block)
  const colWidths = cols.map((list) => Math.max(...list.map((b) => b.width), 0))
  const colX: number[] = []
  let cx = 0
  for (let c = 0; c < 3; c++) {
    colX.push(cx)
    cx += colWidths[c]! + GAP * 4
  }

  const placements = new Map<string, FlatPlacement>()
  let contentW = 0
  let contentD = 0
  for (let c = 0; c < 3; c++) {
    let z = 0
    for (const block of cols[c]!) {
      for (const item of block.items) {
        placements.set(item.part.id, {
          x: colX[c]! + item.x,
          z: z + item.z,
          y: item.part.flatHeight,
          yaw: item.part.flatYaw,
        })
      }
      z += block.depth + GAP * 4
    }
    contentW = Math.max(contentW, colX[c]! + colWidths[c]!)
    contentD = Math.max(contentD, z - GAP * 4)
  }

  // 居中到 16:9 版面
  const targetRatio = 16 / 9
  let width = contentW
  let depth = width / targetRatio
  if (depth < contentD) {
    depth = contentD
    width = depth * targetRatio
  }
  const dx = width / 2
  const dz = depth / 2

  for (const p of placements.values()) {
    p.x -= dx
    p.z -= dz
  }

  return { placements, width, depth }
}

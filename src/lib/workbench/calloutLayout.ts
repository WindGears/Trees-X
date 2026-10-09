export type CalloutSide = 'left' | 'right'

export interface CalloutRect {
  x: number
  y: number
  width: number
  height: number
}

/** Mutable screen-space state, owned by the overlay rather than the product store. */
export interface CalloutLayoutItem {
  id: string
  anchorX: number
  anchorY: number
  width: number
  height: number
  x: number
  y: number
  targetX: number
  targetY: number
  side: CalloutSide
  visible: boolean
  priority: number
  enabled?: boolean
  /** Fade-out may reserve a label's current rectangle while delaying its move. */
  moving?: boolean
}

export const CALLOUT_GAP = 8
export const MAX_CALLOUT_LABELS = 12
const LEADER_CLEARANCE = 28
const NO_OBSTACLES: readonly CalloutRect[] = []

function usable(item: CalloutLayoutItem, bounds: CalloutRect) {
  return (
    item.enabled !== false &&
    Number.isFinite(item.anchorX) &&
    Number.isFinite(item.anchorY) &&
    Number.isFinite(item.priority) &&
    Number.isFinite(item.width) &&
    Number.isFinite(item.height) &&
    item.width > 0 &&
    item.height > 0 &&
    item.width <= bounds.width &&
    item.height <= bounds.height &&
    item.anchorX >= bounds.x &&
    item.anchorX <= bounds.x + bounds.width &&
    item.anchorY >= bounds.y &&
    item.anchorY <= bounds.y + bounds.height
  )
}

function separated(x: number, y: number, item: CalloutLayoutItem, rect: CalloutRect) {
  return (
    x + item.width + CALLOUT_GAP <= rect.x ||
    x >= rect.x + rect.width + CALLOUT_GAP ||
    y + item.height + CALLOUT_GAP <= rect.y ||
    y >= rect.y + rect.height + CALLOUT_GAP
  )
}

function clear(
  x: number,
  y: number,
  item: CalloutLayoutItem,
  items: readonly CalloutLayoutItem[],
  obstacles: readonly CalloutRect[],
) {
  for (let i = 0; i < obstacles.length; i++) {
    const obstacle = obstacles[i]!
    if (obstacle.width > 0 && obstacle.height > 0 && !separated(x, y, item, obstacle)) {
      return false
    }
  }
  for (let i = 0; i < items.length; i++) {
    const placed = items[i]!
    if (
      placed.visible &&
      !(
        x + item.width + CALLOUT_GAP <= placed.targetX ||
        x >= placed.targetX + placed.width + CALLOUT_GAP ||
        y + item.height + CALLOUT_GAP <= placed.targetY ||
        y >= placed.targetY + placed.height + CALLOUT_GAP
      )
    ) {
      return false
    }
  }
  return true
}

function columnX(
  index: number,
  item: CalloutLayoutItem,
  bounds: CalloutRect,
  obstacles: readonly CalloutRect[],
) {
  if (index === 0) return item.anchorX - LEADER_CLEARANCE - item.width
  if (index === 1) return item.anchorX + LEADER_CLEARANCE
  if (index === 2) return bounds.x
  if (index === 3) return bounds.x + bounds.width - item.width
  const obstacle = obstacles[Math.floor((index - 4) / 2)]!
  return index % 2 === 0
    ? obstacle.x - CALLOUT_GAP - item.width
    : obstacle.x + obstacle.width + CALLOUT_GAP
}

function rowY(
  index: number,
  item: CalloutLayoutItem,
  bounds: CalloutRect,
  items: readonly CalloutLayoutItem[],
  obstacles: readonly CalloutRect[],
) {
  if (index === 0) return item.anchorY - item.height / 2
  if (index === 1) return bounds.y
  if (index === 2) return bounds.y + bounds.height - item.height
  const row = Math.floor((index - 3) / 2)
  const below = (index - 3) % 2 === 1
  if (row < obstacles.length) {
    const obstacle = obstacles[row]!
    return below
      ? obstacle.y + obstacle.height + CALLOUT_GAP
      : obstacle.y - CALLOUT_GAP - item.height
  }
  const placed = items[row - obstacles.length]!
  if (!placed.visible) return Number.NaN
  return below
    ? placed.targetY + placed.height + CALLOUT_GAP
    : placed.targetY - CALLOUT_GAP - item.height
}

function place(
  item: CalloutLayoutItem,
  items: readonly CalloutLayoutItem[],
  bounds: CalloutRect,
  obstacles: readonly CalloutRect[],
) {
  const center = bounds.x + bounds.width / 2
  const preferredSide =
    Math.abs(item.anchorX - center) < 40 ? item.side : item.anchorX < center ? 'left' : 'right'
  let bestScore = Number.POSITIVE_INFINITY
  let bestX = item.targetX
  let bestY = item.targetY
  for (let column = 0; column < 4 + obstacles.length * 2; column++) {
    const x = Math.max(
      bounds.x,
      Math.min(bounds.x + bounds.width - item.width, columnX(column, item, bounds, obstacles)),
    )
    for (let row = 0; row < 3 + (obstacles.length + items.length) * 2; row++) {
      const y = rowY(row, item, bounds, items, obstacles)
      if (!Number.isFinite(y) || y < bounds.y || y + item.height > bounds.y + bounds.height)
        continue
      if (!clear(x, y, item, items, obstacles)) continue
      const side: CalloutSide = x + item.width / 2 < item.anchorX ? 'left' : 'right'
      const horizontal = side === 'left' ? item.anchorX - x - item.width : x - item.anchorX
      const previousDistance =
        Number.isFinite(item.targetX) && Number.isFinite(item.targetY)
          ? Math.min(80, Math.abs(x - item.targetX) + Math.abs(y - item.targetY))
          : 0
      const score =
        Math.abs(y + item.height / 2 - item.anchorY) +
        Math.abs(horizontal) * 0.45 +
        (side === preferredSide ? 0 : 36) +
        previousDistance * 0.06
      if (
        score < bestScore - 0.000001 ||
        (Math.abs(score - bestScore) <= 0.000001 && (x < bestX || (x === bestX && y < bestY)))
      ) {
        bestScore = score
        bestX = x
        bestY = y
      }
    }
  }
  if (!Number.isFinite(bestScore)) return false
  item.targetX = bestX
  item.targetY = bestY
  item.side = bestX + item.width / 2 < item.anchorX ? 'left' : 'right'
  item.visible = true
  return true
}

/** Deterministic priority packing. No sorting, arrays, or rectangle allocation per solve. */
export function solveCalloutLayout(
  items: readonly CalloutLayoutItem[],
  bounds: CalloutRect,
  obstacles: readonly CalloutRect[] = NO_OBSTACLES,
) {
  for (let i = 0; i < items.length; i++) items[i]!.visible = false
  if (
    !Number.isFinite(bounds.x) ||
    !Number.isFinite(bounds.y) ||
    !Number.isFinite(bounds.width) ||
    !Number.isFinite(bounds.height) ||
    bounds.width <= 0 ||
    bounds.height <= 0
  )
    return 0
  let previous: CalloutLayoutItem | undefined
  let shown = 0
  for (let rank = 0; rank < items.length && shown < MAX_CALLOUT_LABELS; rank++) {
    let next: CalloutLayoutItem | undefined
    for (let i = 0; i < items.length; i++) {
      const candidate = items[i]!
      if (!usable(candidate, bounds)) continue
      if (
        previous &&
        (candidate.priority > previous.priority ||
          (candidate.priority === previous.priority && candidate.id <= previous.id))
      )
        continue
      if (
        !next ||
        candidate.priority > next.priority ||
        (candidate.priority === next.priority && candidate.id < next.id)
      )
        next = candidate
    }
    if (!next) break
    previous = next
    if (place(next, items, bounds, obstacles)) shown++
  }
  return shown
}

/** Frame-rate-independent settling; reduced motion jumps to the settled positions. */
export function stepCalloutLayout(
  items: readonly CalloutLayoutItem[],
  deltaSeconds: number,
  reduced = false,
) {
  const delta = Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0
  const amount = reduced ? 1 : 1 - Math.exp(-delta / 0.12)
  let settled = true
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!
    if (!item.visible || item.moving === false) continue
    if (!Number.isFinite(item.x) || !Number.isFinite(item.y)) {
      item.x = item.targetX
      item.y = item.targetY
    }
    item.x += (item.targetX - item.x) * amount
    item.y += (item.targetY - item.y) * amount
    if (Math.abs(item.targetX - item.x) <= 0.25 && Math.abs(item.targetY - item.y) <= 0.25) {
      item.x = item.targetX
      item.y = item.targetY
    } else settled = false
  }
  return settled
}

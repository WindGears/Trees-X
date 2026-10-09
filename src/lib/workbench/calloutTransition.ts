import type { CalloutLayoutItem, CalloutRect } from './calloutLayout'

export function calloutOverlaps(
  x: number,
  y: number,
  width: number,
  height: number,
  rect: CalloutRect,
) {
  return (
    x < rect.x + rect.width + 6 &&
    x + width + 6 > rect.x &&
    y < rect.y + rect.height + 6 &&
    y + height + 6 > rect.y
  )
}

/** Relative swept rectangles: two damped labels share the same interpolation amount. */
export function calloutPathsCross(a: CalloutLayoutItem, b: CalloutLayoutItem, moving = true) {
  let enter = 0,
    leave = 1
  function axis(start: number, delta: number, low: number, high: number) {
    if (Math.abs(delta) < 1e-8) return start > low && start < high
    const first = (low - start) / delta,
      last = (high - start) / delta
    enter = Math.max(enter, Math.min(first, last))
    leave = Math.min(leave, Math.max(first, last))
    return enter < leave
  }
  return (
    axis(a.x - b.x, a.targetX - a.x - (moving ? b.targetX - b.x : 0), -a.width - 6, b.width + 6) &&
    axis(a.y - b.y, a.targetY - a.y - (moving ? b.targetY - b.y : 0), -a.height - 6, b.height + 6)
  )
}

export function calloutWithin(item: CalloutLayoutItem, bounds: CalloutRect) {
  return (
    Number.isFinite(item.x) &&
    Number.isFinite(item.y) &&
    item.x >= bounds.x &&
    item.y >= bounds.y &&
    item.x + item.width <= bounds.x + bounds.width &&
    item.y + item.height <= bounds.y + bounds.height
  )
}

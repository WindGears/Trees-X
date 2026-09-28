import { OneEuroFilter } from './filter'
import { RotationSignal } from './rotationSignal'
export interface Point {
  x: number
  y: number
  z: number
}
export type Position = Pick<Point, 'x' | 'y'>
export type GestureMode = 'rotate' | 'select'
export const LOSS_GRACE_MS = 250
export const DEFAULT_THRESHOLDS = { close: 0.28, open: 0.46 }
export type PinchThresholds = typeof DEFAULT_THRESHOLDS
const PALM = [0, 5, 9, 13, 17] as const

export function handGeometry(points: Point[], aspect = 4 / 3) {
  if (points.length !== 21 || points.some((p) => !Number.isFinite(p.x + p.y + p.z))) return null
  if (!Number.isFinite(aspect) || aspect <= 0) return null
  const distance = (a: Point, b: Point) => Math.hypot((a.x - b.x) * aspect, a.y - b.y)
  // Palm length prevents a sideways palm from collapsing the scale.
  const scale = Math.max(
    distance(points[5]!, points[17]!),
    distance(points[0]!, points[9]!),
    distance(points[0]!, points[13]!),
  )
  if (scale < 0.06) return null
  const palm = { x: 0, y: 0 }
  for (const index of PALM) {
    palm.x += (1 - points[index]!.x) / PALM.length
    palm.y += points[index]!.y / PALM.length
  }
  const fingers = [8, 12, 16, 20].filter(
    (i) => distance(points[i]!, points[0]!) > distance(points[i - 2]!, points[0]!) * 1.1,
  ).length
  return {
    scale,
    palm,
    pointer: {
      x: Math.min(1, Math.max(0, 1 - points[8]!.x)),
      y: Math.min(1, Math.max(0, points[8]!.y)),
    },
    ratio: distance(points[8]!, points[4]!) / scale,
    openPalm: fingers >= 3,
  }
}
export class GestureDetector {
  thresholds: PinchThresholds = { ...DEFAULT_THRESHOLDS }
  private fx = new OneEuroFilter()
  private fy = new OneEuroFilter()
  private rotation = new RotationSignal()
  private lastValid: number | null = null
  private missing = false
  private pressedAt: number | null = null
  private releaseAt: number | null = null
  private ready = false
  private armed = false
  private heldMs = 0
  private releasedMs = 0
  private previousPose: 'closed' | 'open' | 'neutral' = 'neutral'
  reset() {
    this.fx.reset()
    this.fy.reset()
    this.rotation.reset()
    this.lastValid = this.pressedAt = this.releaseAt = null
    this.missing = false
    this.ready = false
    this.armed = false
    this.heldMs = this.releasedMs = 0
    this.previousPose = 'neutral'
  }
  update(points: Point[], time: number, mode: GestureMode, aspect = 4 / 3) {
    const validDt =
      this.lastValid !== null &&
      !this.missing &&
      time > this.lastValid &&
      time - this.lastValid <= LOSS_GRACE_MS
        ? time - this.lastValid
        : 0
    const geometry = handGeometry(points, aspect)
    const rotation = this.rotation.update(mode === 'rotate' ? geometry : null, time)
    const result = {
      dx: rotation.delta / (Math.PI * 2),
      rotation,
      pointer: null as Position | null,
      rawPointer: null as Position | null,
      palm: null as Position | null,
      ratio: null as number | null,
      confirm: false,
      pinchStarted: false,
      pinching: false,
      tracked: false,
      cancelled: false,
      progress: 0,
      ready: false,
    }
    if (
      this.lastValid !== null &&
      (time - this.lastValid > LOSS_GRACE_MS || time < this.lastValid)
    ) {
      this.reset()
      result.cancelled = true
    }
    if (!geometry) {
      this.missing = true
      return result
    }
    this.lastValid = time
    result.tracked = true
    result.ratio = geometry.ratio
    result.palm = geometry.palm
    result.rawPointer = geometry.pointer
    if (this.missing) {
      this.fx.reset()
      this.fy.reset()
    }
    result.pointer = {
      x: this.fx.update(geometry.pointer.x, time),
      y: this.fy.update(geometry.pointer.y, time),
    }
    if (mode === 'rotate') {
      this.missing = false
      return result
    }
    const closed = geometry.ratio < this.thresholds.close
    const opened = geometry.ratio > this.thresholds.open
    if (this.missing) {
      this.missing = false
      // A release hidden by occlusion is ambiguous, never a click.
      if (!closed && this.pressedAt !== null) {
        this.pressedAt = this.releaseAt = null
        this.armed = false
        result.cancelled = true
      }
    }
    if (opened && this.pressedAt === null) this.ready = true
    if (closed && this.ready) {
      result.pinchStarted = this.pressedAt === null
      if (result.pinchStarted) this.heldMs = 0
      else if (this.previousPose === 'closed') this.heldMs += validDt
      this.pressedAt ??= time
      this.releaseAt = null
      this.releasedMs = 0
      if (this.heldMs >= 120) this.armed = true
    } else if (opened && this.pressedAt !== null) {
      if (this.releaseAt !== null && this.previousPose === 'open') this.releasedMs += validDt
      else this.releasedMs = 0
      this.releaseAt ??= time
      if (this.releasedMs >= 60) {
        result.confirm = this.armed
        this.pressedAt = this.releaseAt = null
        this.armed = false
      }
    } else this.releaseAt = null
    this.previousPose = closed ? 'closed' : opened ? 'open' : 'neutral'
    result.pinching = this.pressedAt !== null
    result.ready = this.ready
    result.progress = this.pressedAt === null ? 0 : Math.min(1, this.heldMs / 120)
    return result
  }
}
export type GestureResult = ReturnType<GestureDetector['update']>

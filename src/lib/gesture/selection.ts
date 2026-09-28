import { LOSS_GRACE_MS } from './detector'
import type { GestureResult, Position } from './detector'
import { targetContains } from './targets'
export type SelectionPhase =
  'idle' | 'aiming' | 'aimed' | 'locked' | 'dwell' | 'missing' | 'confirmed' | 'cancelled'
export interface Target extends Position {
  visible: boolean
  id?: string
  halfWidth?: number
  halfHeight?: number
}
export class TargetCapture {
  get locked() {
    return this.captureAt !== null
  }
  targetId: string | null = null
  private previousTime: number | null = null
  private wasTracked = false
  private hoverAt: number | null = null
  private captureAt: number | null = null
  private anchor: Position | null = null
  private lastValid: number | null = null
  private feedbackUntil = 0
  private phase: SelectionPhase = 'idle'
  reset() {
    this.targetId = null
    this.previousTime = null
    this.wasTracked = false
    this.hoverAt = this.captureAt = this.lastValid = null
    this.anchor = null
    this.feedbackUntil = 0
    this.phase = 'idle'
  }
  update(
    result: GestureResult,
    time: number,
    target: Target,
    size: { width: number; height: number },
  ) {
    const id = target.id ?? 'current'
    if (
      this.hoverAt !== null &&
      this.previousTime !== null &&
      (!this.wasTracked || !result.tracked)
    )
      this.hoverAt += Math.max(0, time - this.previousTime)
    this.previousTime = time
    this.wasTracked = result.tracked
    let confirm = false
    const cancel = () => {
      this.captureAt = this.hoverAt = null
      this.targetId = null
      this.anchor = null
      this.phase = 'cancelled'
      this.feedbackUntil = time + 650
    }
    if (
      result.cancelled ||
      !target.visible ||
      (this.targetId !== null && this.targetId !== id) ||
      (this.lastValid !== null && time - this.lastValid > LOSS_GRACE_MS)
    ) {
      if (this.captureAt !== null) cancel()
      else {
        this.hoverAt = null
        this.targetId = null
      }
    }
    if (!result.tracked) {
      if (this.captureAt !== null && time - this.captureAt > 2500) cancel()
      return {
        phase: this.phase === 'cancelled' ? this.phase : ('missing' as const),
        pointer: null,
        hovered: this.captureAt !== null,
        confirm,
        progress: 0,
      }
    }
    this.lastValid = time
    const pointer = result.pointer!
    if (this.captureAt !== null) {
      // Fingertip motion is expected; only a large palm translation cancels.
      const moved =
        this.anchor &&
        result.palm &&
        Math.hypot(result.palm.x - this.anchor.x, result.palm.y - this.anchor.y) > 0.22
      if (moved || time - this.captureAt > 2500) cancel()
      else if (result.confirm) {
        confirm = true
        this.phase = 'confirmed'
        this.feedbackUntil = time + 800
        this.captureAt = this.hoverAt = null
        this.anchor = null
      } else if (!result.pinching) cancel()
    } else if (!result.ready && time >= this.feedbackUntil) {
      this.hoverAt = null
      this.phase = 'idle'
    } else if (
      time >= this.feedbackUntil &&
      result.pinchStarted &&
      this.hoverAt !== null &&
      time - this.hoverAt >= 120 &&
      target.visible
    ) {
      // Capture the already-aimed target before fingertip closure changes the hit test.
      this.captureAt = time
      this.anchor = result.palm
      this.phase = 'locked'
    } else if (time >= this.feedbackUntil) {
      const hit = targetContains(pointer, target, size, this.hoverAt !== null)
      if (!hit) {
        this.hoverAt = null
        this.targetId = null
        this.phase = 'idle'
      } else {
        this.hoverAt ??= time
        this.targetId = id
        this.phase = time - this.hoverAt >= 120 ? 'aimed' : 'aiming'
        if (result.pinchStarted && this.phase === 'aimed') {
          this.captureAt = time
          this.anchor = result.palm
          this.phase = 'locked'
        }
      }
    }
    const snapped = this.hoverAt !== null || this.captureAt !== null || this.phase === 'confirmed'
    return {
      phase: this.phase,
      pointer: snapped ? { x: target.x, y: target.y } : pointer,
      hovered: snapped,
      confirm,
      progress: this.phase === 'locked' ? result.progress : 0,
    }
  }
}

import { LOSS_GRACE_MS } from './detector'
import type { GestureResult } from './detector'
import type { SelectionPhase, Target } from './selection'
import { targetContains } from './targets'

export class DwellCapture {
  targetId: string | null = null
  private blockedId: string | null = null
  private blockedPointer: { x: number; y: number } | null = null
  private elapsed = 0
  private lastTime: number | null = null
  private lastValid: number | null = null
  private wasTracked = false
  private feedbackUntil = 0
  reset(preserveBlock = false) {
    this.targetId = null
    if (!preserveBlock) {
      this.blockedId = null
      this.blockedPointer = null
    }
    this.elapsed = this.feedbackUntil = 0
    this.lastTime = this.lastValid = null
    this.wasTracked = false
  }
  update(
    result: GestureResult,
    time: number,
    target: Target,
    size: { width: number; height: number },
  ) {
    const id = target.id ?? 'current'
    const dt =
      this.lastTime !== null && this.wasTracked && result.tracked
        ? Math.max(0, time - this.lastTime)
        : 0
    const expired = this.lastValid !== null && time - this.lastValid > LOSS_GRACE_MS
    this.lastTime = time
    this.wasTracked = result.tracked
    let phase: SelectionPhase = 'idle',
      confirm = false
    if (expired || result.cancelled || !target.visible || (this.targetId && id !== this.targetId)) {
      this.targetId = null
      this.elapsed = 0
    }
    if (!result.tracked || !result.pointer) {
      return {
        phase: 'missing' as const,
        pointer: null,
        hovered: this.targetId !== null,
        progress: Math.min(1, Math.max(0, this.elapsed - 150) / 650),
        confirm,
      }
    }
    this.lastValid = time
    const hit = targetContains(
      result.pointer,
      target,
      size,
      this.targetId !== null || this.blockedId === id,
    )
    const departed =
      this.blockedPointer &&
      Math.hypot(
        (result.pointer.x - this.blockedPointer.x) * size.width,
        (result.pointer.y - this.blockedPointer.y) * size.height,
      ) > 48
    if (departed && (!hit || this.blockedId !== id)) {
      this.blockedId = null
      this.blockedPointer = null
    }
    if (!hit) {
      this.targetId = null
      this.elapsed = 0
    } else if (this.blockedId)
      phase = this.blockedId === id && time < this.feedbackUntil ? 'confirmed' : 'idle'
    else {
      if (this.targetId === id && !expired && !result.cancelled) this.elapsed += dt
      else {
        this.targetId = id
        this.elapsed = 0
      }
      phase = this.elapsed < 150 ? 'aiming' : 'dwell'
      if (this.elapsed >= 800) {
        confirm = true
        phase = 'confirmed'
        this.blockedId = id
        this.blockedPointer = { ...result.pointer }
        this.feedbackUntil = time + 800
      }
    }
    const hovered = hit && (this.targetId === id || this.blockedId === id)
    return {
      phase,
      confirm,
      hovered,
      pointer: hovered ? { x: target.x, y: target.y } : result.pointer,
      progress: hovered ? Math.min(1, Math.max(0, this.elapsed - 150) / 650) : 0,
    }
  }
}

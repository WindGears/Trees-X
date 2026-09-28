import type { RotationSample } from './rotationSignal'

export type MotionPhase = 'idle' | 'arming' | 'tracking' | 'braking' | 'coasting' | 'missing'
export const ROTATION_TUNING = {
  followTau: 0.07,
  brakeTau: 0.06,
  coastTau: 0.32,
  maxVelocity: 1.5,
  stopVelocity: 0.035,
  maxCoastMs: 1200,
  maxAgeMs: 250,
} as const

/** No renderer or timers. The owner supplies a monotonic clock and applies each delta once. */
export class RotationMotion {
  phase: MotionPhase = 'idle'
  velocity = 0
  private target = 0
  private tickAt: number | null = null
  private sampleAt = -Infinity
  private freshUntil = Infinity
  private coastUntil = Infinity
  private interval = 1000 / 15

  get running() {
    return this.velocity !== 0 || this.target !== 0
  }

  reset() {
    this.phase = 'idle'
    this.velocity = this.target = 0
    this.tickAt = null
    this.sampleAt = -Infinity
    this.freshUntil = this.coastUntil = Infinity
    this.interval = 1000 / 15
  }

  private coast(time: number) {
    if (this.phase === 'coasting' || this.phase === 'missing') return
    const braking = this.phase === 'braking' && this.target === 0
    this.target = 0
    this.freshUntil = Infinity
    this.coastUntil = time + ROTATION_TUNING.maxCoastMs
    // Tracking loss after a deliberate stop must not turn braking into a longer glide.
    this.phase = this.velocity === 0 || braking ? 'missing' : 'coasting'
  }

  submit(sample: RotationSample, receivedAt: number) {
    const delta = this.step(receivedAt)
    if (!Number.isFinite(sample.time + sample.velocity + sample.delta + receivedAt)) return delta
    if (sample.time <= this.sampleAt) return delta
    const previous = this.sampleAt
    this.sampleAt = sample.time
    if (receivedAt - sample.time > ROTATION_TUNING.maxAgeMs || sample.time > receivedAt + 10) {
      this.coast(receivedAt)
      return delta
    }
    if (sample.kind === 'discontinuous') {
      this.velocity = this.target = 0
      this.phase = 'arming'
      this.freshUntil = this.coastUntil = Infinity
    } else if (sample.kind === 'missing' || sample.kind === 'arming') {
      this.coast(receivedAt)
      if (sample.kind === 'arming' && !this.running) this.phase = 'arming'
    } else if (sample.kind === 'released') {
      this.target = 0
      this.phase = this.running ? 'braking' : 'arming'
      this.freshUntil = this.coastUntil = Infinity
    } else {
      const interval = sample.time - previous
      if (interval > 0 && interval <= 250) this.interval = interval
      this.target = Math.max(
        -ROTATION_TUNING.maxVelocity,
        Math.min(ROTATION_TUNING.maxVelocity, sample.velocity),
      )
      this.phase = this.target === 0 && this.velocity !== 0 ? 'braking' : 'tracking'
      this.freshUntil = receivedAt + Math.min(150, Math.max(80, this.interval * 1.6))
      this.coastUntil = Infinity
    }
    return delta
  }

  step(now: number): number {
    if (!Number.isFinite(now)) return 0
    if (this.tickAt === null) {
      this.tickAt = now
      return 0
    }
    if (now <= this.tickAt) return 0
    let from = this.tickAt
    this.tickAt = now
    // A suspended render clock must never replay a backlog of movement.
    if (now - from > 250) {
      this.velocity = this.target = 0
      this.phase = 'missing'
      this.freshUntil = this.coastUntil = Infinity
      return 0
    }
    let delta = 0
    while (from < now) {
      if (from >= this.freshUntil) this.coast(this.freshUntil)
      if (from >= this.coastUntil) {
        this.velocity = this.target = 0
        this.phase = 'missing'
        break
      }
      const end = Math.min(now, this.freshUntil, this.coastUntil)
      const dt = (end - from) / 1000
      const tau =
        this.phase === 'coasting'
          ? ROTATION_TUNING.coastTau
          : this.target === 0
            ? ROTATION_TUNING.brakeTau
            : ROTATION_TUNING.followTau
      const decay = Math.exp(-dt / tau)
      delta += this.target * dt + (this.velocity - this.target) * tau * (1 - decay)
      this.velocity = this.target + (this.velocity - this.target) * decay
      if (this.target === 0 && Math.abs(this.velocity) < ROTATION_TUNING.stopVelocity) {
        this.velocity = 0
        if (this.phase === 'coasting') this.phase = 'missing'
      }
      from = end
    }
    return delta
  }
}

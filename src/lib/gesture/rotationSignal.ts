import { OneEuroFilter } from './filter'

export type RotationKind = 'arming' | 'moving' | 'still' | 'released' | 'missing' | 'discontinuous'
export interface RotationSample {
  kind: RotationKind
  time: number
  velocity: number
  delta: number
}
interface PalmPose {
  palm: { x: number; y: number }
  scale: number
  openPalm: boolean
}

/** Camera-normalized palm displacement; velocities and deltas are in radians. */
export class RotationSignal {
  private filter = new OneEuroFilter(1.6, 4)
  private previous: { x: number; y: number; scale: number; filtered: number; time: number } | null =
    null
  private armedAt: number | null = null

  reset() {
    this.filter.reset()
    this.previous = null
    this.armedAt = null
  }

  update(pose: PalmPose | null, time: number): RotationSample {
    const sample: RotationSample = { kind: 'arming', time, velocity: 0, delta: 0 }
    if (!Number.isFinite(time)) {
      this.reset()
      sample.kind = 'discontinuous'
      return sample
    }
    if (!pose || !pose.openPalm) {
      this.reset()
      sample.kind = pose ? 'released' : 'missing'
      return sample
    }
    const previous = this.previous
    const dt = previous ? time - previous.time : 0
    const discontinuous =
      previous &&
      (dt <= 0 ||
        dt > 250 ||
        Math.abs(pose.palm.x - previous.x) > 0.12 ||
        Math.abs(pose.palm.y - previous.y) > 0.2 ||
        pose.scale / previous.scale < 0.65 ||
        pose.scale / previous.scale > 1.55)
    if (discontinuous) this.reset()
    const x = this.filter.update(pose.palm.x, time)
    this.armedAt ??= time
    if (!discontinuous && previous && time - this.armedAt >= 120) {
      const velocity = ((x - previous.filtered) * Math.PI * 2) / (dt / 1000)
      sample.kind = Math.abs(velocity) < 0.075 ? 'still' : 'moving'
      sample.velocity = sample.kind === 'still' ? 0 : velocity
      sample.delta = (sample.velocity * dt) / 1000
    }
    if (discontinuous) sample.kind = 'discontinuous'
    this.previous = { ...pose.palm, scale: pose.scale, filtered: x, time }
    return sample
  }
}

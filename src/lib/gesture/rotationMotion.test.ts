import { describe, expect, it } from 'vitest'
import { RotationMotion } from './rotationMotion'
import { RotationSignal } from './rotationSignal'
import type { RotationSample } from './rotationSignal'

const sample = (
  time: number,
  velocity = 1,
  kind: RotationSample['kind'] = 'moving',
): RotationSample => ({ time, velocity, kind, delta: velocity / 15 })
function moving() {
  const motion = new RotationMotion()
  for (let time = 0; time <= 300; time += 50) motion.submit(sample(time), time)
  return motion
}
function coast(motion: RotationMotion, until: number, empty = false) {
  let angle = 0
  for (let time = 310; time <= until; time += 10) {
    angle += empty ? motion.submit(sample(time, 0, 'missing'), time) : motion.step(time)
  }
  return angle
}
describe('continuous gesture motion', () => {
  it('moves between inference frames and brakes faster for a still visible hand', () => {
    const motion = moving(),
      stopping = moving()
    expect(motion.step(316)).toBeGreaterThan(0)
    stopping.submit(sample(300.1, 0, 'still'), 300.1)
    motion.submit(sample(316.1, 0, 'missing'), 316.1)
    for (let time = 330; time <= 450; time += 10) {
      motion.step(time)
      stopping.step(time)
    }
    expect(Math.abs(stopping.velocity)).toBeLessThan(Math.abs(motion.velocity) / 3)
  })
  it('decays without new results and repeated empty frames cannot restart coasting', () => {
    const a = moving(),
      b = moving()
    a.submit(sample(301, 0, 'missing'), 301)
    b.submit(sample(301, 0, 'missing'), 301)
    expect(coast(a, 1600)).toBeCloseTo(coast(b, 1600, true), 8)
    expect(a.running).toBe(false)
    expect(b.running).toBe(false)
    const silent = moving()
    expect(coast(silent, 1700)).toBeGreaterThan(0)
    expect(silent.running).toBe(false)
  })
  it('rejects old/stale/nonfinite velocity and never catches up a suspended clock', () => {
    const motion = moving()
    motion.submit(sample(200, -100), 310)
    expect(motion.velocity).toBeGreaterThan(0)
    motion.submit(sample(320, Infinity), 320)
    expect(Number.isFinite(motion.velocity)).toBe(true)
    expect(motion.step(1000)).toBe(0)
    motion.submit(sample(400, 100), 1000)
    expect(motion.running).toBe(false)
  })
  it('resets every trace of momentum and caps fast gestures', () => {
    const motion = moving()
    for (let time = 350; time <= 600; time += 50) motion.submit(sample(time, 20), time)
    expect(motion.velocity).toBeLessThanOrEqual(1.5)
    motion.reset()
    expect(motion.step(700)).toBe(0)
    expect(motion.running).toBe(false)
  })
  it('preserves momentum while rearming but rejects discontinuous hands', () => {
    const motion = moving()
    motion.submit(sample(310, 0, 'missing'), 310)
    motion.submit(sample(380, 0, 'arming'), 380)
    expect(motion.velocity).toBeGreaterThan(0)
    motion.submit(sample(420, 0, 'discontinuous'), 420)
    expect(motion.velocity).toBe(0)
    expect(motion.phase).toBe('arming')
  })
  it('has consistent travel at different input and display frequencies', () => {
    const angles: number[] = []
    for (const hz of [8, 15, 30])
      for (const fps of [60, 120]) {
        const motion = new RotationMotion()
        let total = 0,
          nextSample = 0
        for (let time = 0; time <= 2400; time += 1000 / fps) {
          while (nextSample <= time && nextSample <= 1000.01) {
            total += motion.submit(
              sample(nextSample, nextSample < 999 ? 0.8 : 0, nextSample < 999 ? 'moving' : 'still'),
              nextSample,
            )
            nextSample += 1000 / hz
          }
          total += motion.step(time)
        }
        angles.push(total)
      }
    expect(
      (Math.max(...angles) - Math.min(...angles)) / Math.max(...angles),
      JSON.stringify(angles),
    ).toBeLessThan(0.05)
  })
})

describe('palm rotation signal', () => {
  const pose = (x: number, scale = 0.35) => ({ palm: { x, y: 0.5 }, scale, openPalm: true })
  it('arms, distinguishes still from missing, and rebaselines after loss', () => {
    const signal = new RotationSignal()
    expect(signal.update(pose(0.5), 0).kind).toBe('arming')
    signal.update(pose(0.52), 70)
    expect(signal.update(pose(0.54), 140).velocity).toBeGreaterThan(0)
    expect(signal.update(null, 210).kind).toBe('missing')
    expect(signal.update(pose(0.8), 280).delta).toBe(0)
    expect(signal.update(pose(0.1), 350).kind).toBe('discontinuous')
    signal.update(pose(0.1), 420)
    expect(signal.update(pose(0.1), 490).kind).toBe('still')
    expect(signal.update({ ...pose(0.1), openPalm: false }, 560).kind).toBe('released')
  })
  it('rejects scale discontinuity and nonincreasing timestamps', () => {
    const signal = new RotationSignal()
    signal.update(pose(0.5), 0)
    expect(signal.update(pose(0.52, 0.8), 150).kind).toBe('discontinuous')
    expect(signal.update(pose(0.53, 0.8), 150).velocity).toBe(0)
  })
})

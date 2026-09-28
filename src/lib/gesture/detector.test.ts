import { describe, it, expect } from 'vitest'
import { GestureDetector, handGeometry } from './detector'
import { OneEuroFilter } from './filter'
import { hand } from './fixtures'

function pinch(d: GestureDetector, start = 0) {
  d.update(hand(), start, 'select')
  d.update(hand(0, true), start + 70, 'select')
  d.update(hand(0, true), start + 210, 'select')
}
describe('gesture intent', () => {
  it('never uses an occluded interval to arm a pinch', () => {
    const d = new GestureDetector()
    d.update(hand(), 0, 'select')
    d.update(hand(0, true), 70, 'select')
    d.update([], 140, 'select')
    expect(d.update(hand(0, true), 210, 'select').progress).toBe(0)
    d.update(hand(), 280, 'select')
    expect(d.update(hand(), 350, 'select').confirm).toBe(false)
  })
  it('smooths stationary noise while allowing fast intentional movement', () => {
    const f = new OneEuroFilter()
    f.update(0.5, 0)
    const output = Array.from({ length: 20 }, (_, i) =>
      f.update(0.5 + (i % 2 ? 0.008 : -0.008), (i + 1) * 67),
    )
    expect(Math.max(...output) - Math.min(...output)).toBeLessThan(0.011)
    expect(f.update(0.8, 1500)).toBeGreaterThan(0.65)
  })
  it('normalizes distances consistently for different video aspect ratios', () => {
    const a = hand(),
      b = a.map((p) => ({ ...p, x: 0.5 + (p.x - 0.5) * 0.75 }))
    expect(handGeometry(a, 4 / 3)!.ratio).toBeCloseTo(handGeometry(b, 16 / 9)!.ratio)
  })
  it('mirrors a filtered pointer and uses a stable palm rotation baseline', () => {
    const d = new GestureDetector()
    expect(d.update(hand(), 0, 'rotate').dx).toBe(0)
    d.update(hand(-0.025), 70, 'rotate')
    expect(d.update(hand(-0.05), 140, 'rotate').dx).toBeGreaterThan(0)
    d.reset()
    expect(d.update(hand(-0.1), 210, 'select').pointer!.x).toBeCloseTo(0.6)
  })
  it('does not jump after tracking loss or a large discontinuity', () => {
    const d = new GestureDetector()
    d.update(hand(), 0, 'rotate')
    d.update([], 70, 'rotate')
    expect(d.update(hand(0.3), 140, 'rotate').dx).toBe(0)
    expect(d.update(hand(-0.3), 210, 'rotate').dx).toBe(0)
  })
  it('requires an open pose after reset and confirms once after a stable release', () => {
    const d = new GestureDetector()
    expect(d.update(hand(0, true), 0, 'select').pinchStarted).toBe(false)
    pinch(d, 100)
    expect(d.update(hand(), 380, 'select').confirm).toBe(false)
    expect(d.update(hand(), 450, 'select').confirm).toBe(true)
    expect(d.update(hand(), 520, 'select').confirm).toBe(false)
  })
  it('survives a brief closed-hand occlusion but never clicks on a hidden release', () => {
    const d = new GestureDetector()
    pinch(d)
    expect(d.update([], 280, 'select').confirm).toBe(false)
    expect(d.update(hand(0, true), 350, 'select').pinching).toBe(true)
    d.update(hand(), 420, 'select')
    expect(d.update(hand(), 490, 'select').confirm).toBe(true)
    d.reset()
    pinch(d, 1000)
    d.update([], 1280, 'select')
    expect(d.update(hand(), 1350, 'select').cancelled).toBe(true)
    expect(d.update(hand(), 1420, 'select').confirm).toBe(false)
  })
  it('rejects a stale pinch after a long gap even if no empty frame arrived', () => {
    const d = new GestureDetector()
    pinch(d)
    expect(d.update(hand(), 600, 'select').confirm).toBe(false)
    expect(d.update(hand(), 670, 'select').confirm).toBe(false)
    expect(d.update([{ x: NaN, y: 0, z: 0 }], 740, 'select').tracked).toBe(false)
  })
})

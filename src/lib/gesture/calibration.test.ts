import { it, expect } from 'vitest'
import { PinchCalibration } from './calibration'
const sample = (c: PinchCalibration, value: number, start: number) => {
  let thresholds = null
  for (let i = 0; i <= 12; i++) thresholds = c.update(value, start + i * 100) ?? thresholds
  return thresholds
}
it('derives separated thresholds only from two stable distinct poses', () => {
  const c = new PinchCalibration()
  c.start('open', 0)
  sample(c, 0.8, 0)
  expect(c.stage).toBe('prepare-pinch')
  c.start('pinch', 2000)
  const thresholds = sample(c, 0.1, 2000)!
  expect(c.stage).toBe('done')
  expect(thresholds.close).toBeGreaterThan(0.1)
  expect(thresholds.open - thresholds.close).toBeGreaterThanOrEqual(0.12)
  expect(thresholds.open).toBeLessThan(0.8)
})
it('rejects insufficient separation, noisy poses and timeout', () => {
  const c = new PinchCalibration()
  c.start('open', 0)
  sample(c, 0.55, 0)
  c.start('pinch', 2000)
  expect(sample(c, 0.4, 2000)).toBeNull()
  expect(c.stage).toBe('error')
  c.start('open', 4000)
  for (let i = 0; i <= 12; i++) c.update(i % 2 ? 0.6 : 1, 4000 + i * 100)
  expect(c.stage).toBe('error')
  c.start('open', 6000)
  c.update(null, 19000)
  expect(c.stage).toBe('error')
})
it('does not accumulate samples across a tracking gap or cancellation', () => {
  const c = new PinchCalibration()
  c.start('open', 0)
  for (let i = 0; i < 8; i++) c.update(0.8, i * 100)
  c.update(null, 800)
  c.update(0.8, 900)
  expect(c.progress).toBe(0)
  c.cancel()
  sample(c, 0.8, 1000)
  expect(c.stage).toBe('idle')
})

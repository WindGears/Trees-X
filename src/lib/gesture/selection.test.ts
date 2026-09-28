import { it, expect } from 'vitest'
import { GestureDetector } from './detector'
import { TargetCapture } from './selection'
import { hand } from './fixtures'
function setup() {
  const d = new GestureDetector(),
    c = new TargetCapture()
  const target = { x: 0.5, y: 0.5, visible: true }
  const send = (points: ReturnType<typeof hand>, time: number) =>
    c.update(d.update(points, time, 'select'), time, target, { width: 1000, height: 600 })
  const aim = () => {
    send(hand(), 0)
    send(hand(), 140)
  }
  return { send, aim, c, target }
}
it('captures the target despite fingertip movement beyond the original 32px radius', () => {
  const { send, aim } = setup()
  aim()
  expect(send(hand(0, true, 0.06), 210).phase).toBe('locked')
  const held = send(hand(0, true, 0.15), 350)
  expect(held.phase).toBe('locked')
  expect(held.pointer).toEqual({ x: 0.5, y: 0.5 })
  send(hand(0, false, 0.15), 420)
  expect(send(hand(0, false, 0.15), 490).confirm).toBe(true)
  expect(send(hand(), 560).confirm).toBe(false)
})
it('requires a stable candidate rather than clicking wherever a pinch starts', () => {
  const { send } = setup()
  send(hand(0.2), 0)
  send(hand(0.2, true), 140)
  send(hand(0.2, true), 280)
  send(hand(), 350)
  expect(send(hand(), 420).confirm).toBe(false)
})
it('cancels deliberate palm movement, invisible targets and reset', () => {
  for (const cause of ['palm', 'hidden', 'reset']) {
    const { send, aim, target, c } = setup()
    aim()
    send(hand(0, true), 210)
    send(hand(0, true), 350)
    if (cause === 'palm') send(hand(0.3, true), 420)
    if (cause === 'hidden') target.visible = false
    if (cause === 'reset') c.reset()
    send(hand(), 490)
    expect(send(hand(), 560).confirm).toBe(false)
  }
})
it('pauses briefly, cancels prolonged loss and never confirms on loss', () => {
  const { send, aim } = setup()
  aim()
  send(hand(0, true), 210)
  send(hand(0, true), 350)
  expect(send([], 420).confirm).toBe(false)
  expect(send(hand(0, true), 490).phase).toBe('locked')
  expect(send([], 800).phase).toBe('cancelled')
  send(hand(), 870)
  expect(send(hand(), 940).confirm).toBe(false)
})

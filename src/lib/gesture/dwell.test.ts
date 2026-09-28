import { expect, it } from 'vitest'
import { GestureDetector } from './detector'
import { DwellCapture } from './dwell'
import { hand } from './fixtures'
import { GestureTargets } from './targets'

function setup() {
  const detector = new GestureDetector(),
    dwell = new DwellCapture()
  const target = { id: 'part', x: 0.5, y: 0.5, visible: true }
  const send = (time: number, points = hand()) =>
    dwell.update(detector.update(points, time, 'select'), time, target, {
      width: 1000,
      height: 600,
    })
  return { dwell, target, send }
}
it('confirms one dwell and requires departure before another confirmation', () => {
  const { send } = setup()
  for (let t = 0; t < 800; t += 100) expect(send(t).confirm).toBe(false)
  expect(send(800).confirm).toBe(true)
  for (let t = 900; t <= 2400; t += 100) expect(send(t).confirm).toBe(false)
  send(2500, hand(0.3))
  send(2600, hand(0.3))
  let confirms = 0
  for (let t = 2700; t <= 4100; t += 100) if (send(t).confirm) confirms++
  expect(confirms).toBe(1)
})
it('excludes missing intervals and recovery intervals from progress', () => {
  const { send } = setup()
  for (let t = 0; t <= 500; t += 100) send(t)
  const missing = send(600, [])
  expect(missing.phase).toBe('missing')
  expect(send(700).progress).toBe(missing.progress)
  expect(send(800).confirm).toBe(false)
  expect(send(900).confirm).toBe(false)
  expect(send(1000).confirm).toBe(true)
})
it('cancels on long loss, hidden or changed targets', () => {
  for (const cause of ['loss', 'hidden', 'changed']) {
    const { send, target } = setup()
    for (let t = 0; t <= 700; t += 100) send(t)
    if (cause === 'hidden') target.visible = false
    if (cause === 'changed') target.id = 'other'
    expect(send(cause === 'loss' ? 1100 : 800).confirm).toBe(false)
  }
})
it('keeps a selected target blocked across an animation reset', () => {
  const { send, dwell } = setup()
  for (let t = 0; t <= 800; t += 100) send(t)
  dwell.reset(true)
  for (let t = 900; t <= 2000; t += 100) expect(send(t).confirm).toBe(false)
})
it('does not confirm a different target moved under a stationary hand after a camera transition', () => {
  const { send, dwell, target } = setup()
  for (let t = 0; t <= 800; t += 100) send(t)
  dwell.reset(true)
  target.id = 'another-part'
  for (let t = 900; t <= 3000; t += 100) expect(send(t).confirm).toBe(false)
})
it('retains overlapping candidates and unregisters only its own provider', () => {
  const registry = new GestureTargets(),
    size = { width: 1000, height: 600 }
  const create = (id: string, x: number) => () => ({
    id,
    x,
    y: 0.5,
    label: id,
    visible: true,
    priority: 1,
    activate: () => {},
  })
  const remove = registry.register('a', create('a', 0.5))
  registry.register('b', create('b', 0.55))
  expect(registry.pick({ x: 0.54, y: 0.5 }, size, 'a', false)?.id).toBe('a')
  expect(registry.pick({ x: 0.61, y: 0.5 }, size, 'a', false)?.id).toBe('b')
  expect(registry.pick({ x: 0.9, y: 0.8 }, size, 'a', true)?.id).toBe('a')
  registry.register('a', create('a', 0.6))
  remove()
  expect(registry.get('a')?.x).toBe(0.6)
})

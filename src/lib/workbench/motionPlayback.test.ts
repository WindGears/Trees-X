import { readFileSync } from 'node:fs'
import { expect, it, vi } from 'vitest'
import { gsap } from 'gsap'
import { parseProduct } from './api'
import { createSampleAdapter } from './adapter'
import { progressActions } from './motionConfig'
import { createMotionPlayback } from './motionPlayback'

const product = parseProduct(
  JSON.parse(readFileSync('server/src/main/resources/samples/progress-products.json', 'utf8'))[1],
)

it('distinguishes deterministic seeks and resets from every continuous playback frame, including its endpoint', () => {
  const adapter = createSampleAdapter(product),
    changed = vi.fn(),
    feedback = vi.fn(),
    tweens = vi.spyOn(gsap, 'to'),
    id = progressActions(product.presentation)[0]!.id,
    playback = createMotionPlayback(
      adapter,
      progressActions(product.presentation),
      changed,
      feedback,
      () => false,
    )
  try {
    playback.command({ revision: 1, operation: 'seek', id, value: 0.37 })
    expect(changed.mock.calls).toEqual([['pose-jump']])
    expect(adapter.pose[id]).toBe(0.37)
    playback.command({ revision: 2, operation: 'play', id, value: 1 })
    const tween = tweens.mock.results.at(-1)!.value as gsap.core.Tween
    changed.mockClear()
    tween.progress(0.5)
    expect(adapter.pose[id]).toBeGreaterThan(0.37)
    tween.progress(1)
    expect(adapter.pose[id]).toBe(1)
    expect(changed.mock.calls.length).toBeGreaterThan(1)
    expect(changed.mock.calls.every(([kind]) => kind === 'pose')).toBe(true)
    expect(feedback.mock.calls.at(-1)?.[1]).toMatchObject({ progress: 1, playing: false })
    changed.mockClear()
    playback.command({ revision: 3, operation: 'reset', id })
    expect(changed.mock.calls).toEqual([['pose-jump']])
    expect(adapter.pose[id]).toBe(0)
    playback.command({ revision: 4, operation: 'seek', id, value: 0.6 })
    changed.mockClear()
    playback.reset()
    expect(changed.mock.calls).toEqual([['pose-jump']])
    expect(adapter.pose[id]).toBe(0)
  } finally {
    playback.dispose()
    adapter.dispose()
    tweens.mockRestore()
  }
})

it('invalidates reduced-motion jumps and remains silent after disposal', () => {
  const adapter = createSampleAdapter(product),
    changed = vi.fn(),
    feedback = vi.fn(),
    id = progressActions(product.presentation)[0]!.id,
    playback = createMotionPlayback(
      adapter,
      progressActions(product.presentation),
      changed,
      feedback,
      () => true,
      { [id]: { progress: 0.3, target: 1, playing: true } },
    )
  try {
    expect(adapter.pose[id]).toBe(0.3)
    playback.command({ revision: 1, operation: 'resume', id })
    expect(adapter.pose[id]).toBe(1)
    expect(changed.mock.calls).toEqual([['pose-jump']])
    playback.dispose()
    changed.mockClear()
    feedback.mockClear()
    playback.reset()
    playback.pauseAll()
    playback.command({ revision: 2, operation: 'seek', id, value: 0.2 })
    expect(adapter.pose[id]).toBe(1)
    expect(changed).not.toHaveBeenCalled()
    expect(feedback).not.toHaveBeenCalled()
  } finally {
    playback.dispose()
    adapter.dispose()
  }
})

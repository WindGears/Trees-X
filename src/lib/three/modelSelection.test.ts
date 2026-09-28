import { expect, it } from 'vitest'
import { isCurrentModel } from './modelSelection'

it('rejects late ready, error and visual callbacks, including a retry of the same asset', () => {
  for (const event of [
    { status: 'ready' as const },
    { error: 'late failure' },
    { visualReady: false },
  ]) {
    expect(isCurrentModel({ productId: 'plant', revision: 1, ...event }, 'gamepad', 2)).toBe(false)
    expect(isCurrentModel({ productId: 'plant', revision: 1, ...event }, 'plant', 2)).toBe(false)
    expect(isCurrentModel({ productId: 'plant', revision: 2, ...event }, 'plant', 2)).toBe(true)
  }
})

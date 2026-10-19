import { describe, expect, it } from 'vitest'
import { decodeQueue, heavyWork, taskSlots } from './decodeQueue'

describe('bounded texture decoding', () => {
  it('keeps pending work below the limit, including after rejection', async () => {
    const queue = decodeQueue(2, new AbortController().signal)
    let active = 0,
      maximum = 0
    const completed: number[] = []
    const tasks = Array.from({ length: 9 }, (_, index) =>
      queue(async () => {
        active++
        maximum = Math.max(maximum, active)
        await new Promise((resolve) => setTimeout(resolve, 1))
        active--
        completed.push(index)
        if (index === 2) throw new Error('decode failed')
        return index
      }),
    )
    const results = await Promise.allSettled(tasks)
    expect(maximum).toBe(2)
    expect(completed).toHaveLength(9)
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1)
  })
  it('does not start queued decoders after cancellation', async () => {
    const abort = new AbortController(),
      queue = decodeQueue(1, abort.signal)
    let finish: (() => void) | undefined,
      started = 0
    const first = queue(async () => {
      started++
      await new Promise<void>((resolve) => {
        finish = resolve
      })
    })
    await Promise.resolve()
    const later = queue(async () => {
      started++
    })
    abort.abort()
    finish?.()
    expect((await Promise.allSettled([first, later]))[1]?.status).toBe('rejected')
    expect(started).toBe(1)
  })
  it('releases cancelled waiters immediately while keeping running work bounded', async () => {
    const run = taskSlots(1),
      signal = new AbortController().signal,
      abort = new AbortController()
    let finish!: () => void
    const first = run(
      signal,
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    )
    await Promise.resolve()
    const queued = run(abort.signal, async () => {
      throw new Error('must not run')
    })
    const rejected = expect(queued).rejects.toThrow()
    abort.abort()
    await rejected
    finish()
    await first
    await expect(run(signal, async () => 7)).resolves.toBe(7)
  })
  it('shares two heavy-work slots across different selection signals', async () => {
    let active = 0,
      maximum = 0
    const signals = [new AbortController().signal, new AbortController().signal]
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        heavyWork(signals[i % 2]!, async () => {
          active++
          maximum = Math.max(maximum, active)
          await new Promise((resolve) => setTimeout(resolve, 1))
          active--
        }),
      ),
    )
    expect(maximum).toBe(2)
  })
})

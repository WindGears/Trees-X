import { describe, expect, it } from 'vitest'
import { byteResidency } from './assetResidency'

describe('verified compressed-byte residency', () => {
  it('bounds reservations, queues fairly and permits an oversized file only alone', async () => {
    const memory = byteResidency(10),
      signal = new AbortController().signal
    const free = await memory.reserve(6, signal)
    let large = false,
      small = false
    const next = memory.reserve(20, signal).then((release) => {
      large = true
      return release
    })
    const last = memory.reserve(1, signal).then((release) => {
      small = true
      return release
    })
    await Promise.resolve()
    expect(memory.bytes).toBe(6)
    expect(large).toBe(false)
    free()
    const releaseLarge = await next
    expect(memory.bytes).toBe(20)
    expect(small).toBe(false)
    releaseLarge()
    const releaseSmall = await last
    expect(memory.bytes).toBe(1)
    releaseSmall()
    releaseSmall()
    free()
    expect(memory.bytes).toBe(0)
  })
  it('cancels a blocked reservation immediately and allows the next waiter through', async () => {
    const memory = byteResidency(10),
      signal = new AbortController().signal
    const free = await memory.reserve(6, signal),
      abort = new AbortController()
    const blocked = memory.reserve(8, abort.signal)
    const rejection = expect(blocked).rejects.toThrow()
    const next = memory.reserve(1, signal)
    abort.abort()
    await rejection
    const release = await next
    expect(memory.bytes).toBe(7)
    release()
    free()
  })
})

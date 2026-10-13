import { describe, expect, it } from 'vitest'
import { isRealtimeRenderer, registerRealtimeRenderer } from './realtimeMode'

describe('renderer-local realtime mode', () => {
  it('isolates simultaneous reference and realtime renderers and clears disposed identities', () => {
    const realtime = {},
      reference = {}
    const release = registerRealtimeRenderer(realtime)
    expect(isRealtimeRenderer(realtime)).toBe(true)
    expect(isRealtimeRenderer(reference)).toBe(false)
    release()
    release()
    expect(isRealtimeRenderer(realtime)).toBe(false)
    const nextHost = {}
    const releaseNext = registerRealtimeRenderer(nextHost)
    expect(isRealtimeRenderer(nextHost)).toBe(true)
    expect(isRealtimeRenderer(realtime)).toBe(false)
    releaseNext()
  })
})

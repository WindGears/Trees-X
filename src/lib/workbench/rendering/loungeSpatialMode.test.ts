import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveLoungeProjection } from './loungeSpatialMode'

afterEach(() => vi.unstubAllGlobals())

describe('lounge spatial experiment selection', () => {
  it.each([
    ['', 'infinite'],
    ['?loungeSpatial=box', 'box'],
    ['?loungeSpatial=depth', 'depth'],
    ['?loungeSpatial=infinite', 'infinite'],
    ['?loungeSpatial=invalid', 'infinite'],
    ['?product=typewriter-study&renderPipeline=realtime&loungeSpatial=depth', 'depth'],
  ] as const)('resolves %s to %s', (search, expected) => {
    expect(resolveLoungeProjection(search)).toBe(expected)
  })

  it('reads the current location only when no explicit search was given', () => {
    vi.stubGlobal('window', { location: { search: '?loungeSpatial=box' } })
    expect(resolveLoungeProjection()).toBe('box')
    expect(resolveLoungeProjection('')).toBe('infinite')
  })

  it('is safe without a browser window', () => {
    vi.stubGlobal('window', undefined)
    expect(resolveLoungeProjection()).toBe('infinite')
  })
})

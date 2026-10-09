import { describe, expect, it } from 'vitest'
import { calloutPathsCross, calloutWithin } from './calloutTransition'
import type { CalloutLayoutItem } from './calloutLayout'

function label(y: number, targetY: number): CalloutLayoutItem {
  return {
    id: 'test',
    anchorX: 0,
    anchorY: 0,
    x: 20,
    y,
    targetX: 20,
    targetY,
    width: 90,
    height: 28,
    side: 'left',
    priority: 10,
    visible: true,
  }
}
describe('clear callout transitions', () => {
  it('detects intermediate crossings even when both end layouts are clear', () => {
    expect(calloutPathsCross(label(106, 246), label(246, 106))).toBe(true)
  })
  it('allows parallel movement with stable separation', () => {
    expect(calloutPathsCross(label(106, 206), label(246, 346))).toBe(false)
  })
  it('keeps fading labels as stationary obstacles until their pixels are gone', () => {
    expect(calloutPathsCross(label(100, 300), label(210, 450), false)).toBe(true)
  })
  it('allows separated columns through the same vertical interval', () => {
    const other = label(246, 106)
    other.x = other.targetX = 200
    expect(calloutPathsCross(label(106, 246), other)).toBe(false)
  })
  it('rejects stale screen positions after a smaller viewport', () => {
    expect(calloutWithin(label(100, 100), { x: 16, y: 16, width: 50, height: 200 })).toBe(false)
  })
})

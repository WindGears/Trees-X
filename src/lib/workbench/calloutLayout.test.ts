import { describe, expect, it } from 'vitest'
import {
  CALLOUT_GAP,
  MAX_CALLOUT_LABELS,
  solveCalloutLayout,
  stepCalloutLayout,
  type CalloutLayoutItem,
  type CalloutRect,
} from './calloutLayout'

function label(id: string, patch: Partial<CalloutLayoutItem> = {}): CalloutLayoutItem {
  return {
    id,
    anchorX: 400,
    anchorY: 220,
    width: 120,
    height: 28,
    x: Number.NaN,
    y: Number.NaN,
    targetX: Number.NaN,
    targetY: Number.NaN,
    side: 'left',
    visible: false,
    priority: 0,
    ...patch,
  }
}

const bounds: CalloutRect = { x: 16, y: 24, width: 768, height: 432 }
const product: CalloutRect = { x: 275, y: 110, width: 250, height: 270 }

function separated(a: CalloutRect, b: CalloutRect) {
  return (
    a.x + a.width + CALLOUT_GAP <= b.x ||
    a.x >= b.x + b.width + CALLOUT_GAP ||
    a.y + a.height + CALLOUT_GAP <= b.y ||
    a.y >= b.y + b.height + CALLOUT_GAP
  )
}

function assertSafe(items: CalloutLayoutItem[], frame: CalloutRect, obstacles: CalloutRect[]) {
  const visible = items.filter((item) => item.visible)
  for (const item of visible) {
    const rect = { x: item.targetX, y: item.targetY, width: item.width, height: item.height }
    expect(rect.x).toBeGreaterThanOrEqual(frame.x)
    expect(rect.y).toBeGreaterThanOrEqual(frame.y)
    expect(rect.x + rect.width).toBeLessThanOrEqual(frame.x + frame.width)
    expect(rect.y + rect.height).toBeLessThanOrEqual(frame.y + frame.height)
    for (const obstacle of obstacles) expect(separated(rect, obstacle)).toBe(true)
    for (const other of visible) {
      if (other === item) continue
      expect(
        separated(rect, {
          x: other.targetX,
          y: other.targetY,
          width: other.width,
          height: other.height,
        }),
      ).toBe(true)
    }
  }
}

function positions(items: CalloutLayoutItem[]) {
  return [...items]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(({ id, targetX, targetY, visible, side }) => ({ id, targetX, targetY, visible, side }))
}

describe('callout layout', () => {
  it('packs dense anchors outside the product with readable spacing', () => {
    const items = Array.from({ length: 12 }, (_, i) =>
      label(`part-${i.toString().padStart(2, '0')}`),
    )
    expect(solveCalloutLayout(items, bounds, [product])).toBe(12)
    assertSafe(items, bounds, [product])
  })

  it('does not depend on source array order when candidate scores tie', () => {
    const a = Array.from({ length: 12 }, (_, i) => label(`part-${i.toString().padStart(2, '0')}`))
    const b = [...a].reverse().map((item) => ({ ...item }))
    solveCalloutLayout(a, bounds, [product])
    solveCalloutLayout(b, bounds, [product])
    expect(positions(a)).toEqual(positions(b))
    for (let i = 0; i < 10; i++) solveCalloutLayout(a, bounds, [product])
    expect(positions(a)).toEqual(positions(b))
  })

  it('retains selected labels first when only one label fits', () => {
    const frame = { x: 10, y: 20, width: 170, height: 30 }
    const items = [
      label('a', { anchorX: 70, anchorY: 35 }),
      label('selected', { anchorX: 75, anchorY: 35, priority: 100 }),
      label('b', { anchorX: 100, anchorY: 35 }),
    ]
    expect(solveCalloutLayout(items, frame)).toBe(1)
    expect(items[1]!.visible).toBe(true)
    expect(items[0]!.visible).toBe(false)
    expect(items[2]!.visible).toBe(false)
    assertSafe(items, frame, [])
  })

  it('caps clutter while reserving capacity for higher-priority labels', () => {
    const items = Array.from({ length: 30 }, (_, i) =>
      label(`part-${i.toString().padStart(2, '0')}`),
    )
    items[29]!.priority = 100
    expect(solveCalloutLayout(items, { x: 0, y: 0, width: 1200, height: 1000 })).toBe(
      MAX_CALLOUT_LABELS,
    )
    expect(items[29]!.visible).toBe(true)
    expect(items[28]!.visible).toBe(false)
  })

  it('hides labels that cannot fit a narrow viewport instead of spilling out', () => {
    const items = [
      label('long', { anchorX: 30, anchorY: 30 }),
      label('short', { anchorX: 30, anchorY: 30, width: 44, height: 20 }),
    ]
    const frame = { x: 8, y: 8, width: 50, height: 64 }
    expect(solveCalloutLayout(items, frame)).toBe(1)
    expect(items[0]!.visible).toBe(false)
    assertSafe(items, frame, [])
  })

  it('avoids a product and a panel together, including different label widths', () => {
    const panel = { x: 592, y: 48, width: 192, height: 350 }
    const items = Array.from({ length: 8 }, (_, i) =>
      label(`part-${i}`, {
        anchorX: 290 + i * 24,
        anchorY: 125 + i * 23,
        width: i % 2 === 0 ? 164 : 92,
      }),
    )
    expect(solveCalloutLayout(items, bounds, [product, panel])).toBeGreaterThan(0)
    assertSafe(items, bounds, [product, panel])
  })

  it('handles disabled, invalid, and offscreen anchors without poisoning other labels', () => {
    const items = [
      label('disabled', { enabled: false }),
      label('invalid', { anchorX: Number.NaN }),
      label('offscreen', { anchorY: 800 }),
      label('valid'),
    ]
    expect(solveCalloutLayout(items, bounds)).toBe(1)
    expect(items.map((item) => item.visible)).toEqual([false, false, false, true])
    expect(solveCalloutLayout(items, { x: 0, y: 0, width: 0, height: 40 })).toBe(0)
    expect(items.every((item) => !item.visible)).toBe(true)
  })

  it('keeps a stable side for small movements around the center', () => {
    const item = label('part', { anchorX: 398, side: 'right' })
    solveCalloutLayout([item], bounds, [product])
    expect(item.side).toBe('right')
    item.anchorX = 402
    solveCalloutLayout([item], bounds, [product])
    expect(item.side).toBe('right')
  })
})

describe('callout smoothing', () => {
  it('freezes a departing label while other labels still settle', () => {
    const departing = label('departing', {
      visible: true,
      moving: false,
      x: 32,
      y: 48,
      targetX: 240,
      targetY: 180,
    })
    const moving = label('moving', {
      visible: true,
      x: 380,
      y: 48,
      targetX: 420,
      targetY: 180,
    })
    const items = [departing, moving]
    expect(stepCalloutLayout(items, 1 / 60)).toBe(false)
    expect([departing.x, departing.y]).toEqual([32, 48])
    expect(moving.x).toBeGreaterThan(380)
    expect(stepCalloutLayout(items, 1 / 60, true)).toBe(true)
    expect([departing.x, departing.y]).toEqual([32, 48])
    expect([moving.x, moving.y]).toEqual([420, 180])
    departing.moving = true
    expect(stepCalloutLayout(items, 1 / 60)).toBe(false)
    expect(departing.x).toBeGreaterThan(32)
  })

  it('settles smoothly without overshoot and converges to exact target coordinates', () => {
    const item = label('part', { visible: true, x: 0, y: 0, targetX: 240, targetY: 140 })
    expect(stepCalloutLayout([item], 1 / 60)).toBe(false)
    expect(item.x).toBeGreaterThan(0)
    expect(item.x).toBeLessThan(240)
    expect(item.y).toBeGreaterThan(0)
    expect(item.y).toBeLessThan(140)
    for (let i = 0; i < 90; i++) stepCalloutLayout([item], 1 / 60)
    expect(stepCalloutLayout([item], 1 / 60)).toBe(true)
    expect(item.x).toBe(240)
    expect(item.y).toBe(140)
  })

  it('has the same response at different frame rates', () => {
    const a = label('part', { visible: true, x: 0, y: 0, targetX: 240, targetY: 140 })
    const b = { ...a }
    for (let i = 0; i < 6; i++) stepCalloutLayout([a], 1 / 60)
    for (let i = 0; i < 3; i++) stepCalloutLayout([b], 1 / 30)
    expect(a.x).toBeCloseTo(b.x, 10)
    expect(a.y).toBeCloseTo(b.y, 10)
  })

  it('places newly visible labels directly and respects reduced motion', () => {
    const first = label('first', { visible: true, targetX: 110, targetY: 120 })
    const reduced = label('reduced', { visible: true, x: 300, y: 200, targetX: 20, targetY: 40 })
    expect(stepCalloutLayout([first], 1 / 60)).toBe(true)
    expect([first.x, first.y]).toEqual([110, 120])
    expect(stepCalloutLayout([reduced], 1 / 60, true)).toBe(true)
    expect([reduced.x, reduced.y]).toEqual([20, 40])
  })

  it('ignores hidden labels and treats invalid or negative deltas as zero', () => {
    const hidden = label('hidden', { x: 10, y: 10, targetX: 100, targetY: 100 })
    expect(stepCalloutLayout([hidden], 1)).toBe(true)
    expect([hidden.x, hidden.y]).toEqual([10, 10])
    hidden.visible = true
    stepCalloutLayout([hidden], -1)
    stepCalloutLayout([hidden], Number.NaN)
    expect([hidden.x, hidden.y]).toEqual([10, 10])
  })
})

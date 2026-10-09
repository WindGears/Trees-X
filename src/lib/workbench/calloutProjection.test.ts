import { describe, expect, it } from 'vitest'
import { structureReveal } from './calloutProjection'
import { readFileSync } from 'node:fs'
import { parseProduct } from './api'
const samples: unknown[] = JSON.parse(
  readFileSync('server/src/main/resources/samples/progress-products.json', 'utf8'),
)
const legacy: unknown[] = JSON.parse(
  readFileSync('server/src/main/resources/samples/products.json', 'utf8'),
)

describe('structure callout reveal', () => {
  it('follows the actual reversible pose instead of a requested target', () => {
    const p = parseProduct(samples[0]).presentation
    expect(structureReveal(p, { explosion: 0 })).toBe(0)
    expect(structureReveal(p, { explosion: 0.35 })).toBe(0.35)
    expect(structureReveal(p, { explosion: 1 })).toBe(1)
    expect(structureReveal(p, { explosion: 0 })).toBe(0)
  })
  it('includes configured door/progress motion and excludes temporary strikes', () => {
    const car = parseProduct(samples[1]).presentation
    expect(structureReveal(car, { 'open-doors': 0.4, explosion: 0.1 })).toBe(0.4)
    const typewriter = parseProduct(legacy[1]).presentation
    expect(structureReveal(typewriter, { 'press-key': 1, explosion: 0 })).toBe(0)
  })
})

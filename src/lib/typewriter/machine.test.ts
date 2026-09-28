import { describe, expect, it } from 'vitest'
import { EXPECTED_TOTAL, typewriterSpec } from './machine'
import { GROUPS } from './spec'
import { CHARS } from './dim'

describe('打字机零件规格', () => {
  const spec = typewriterSpec()

  it('零件总数为 572', () => {
    expect(spec.parts.length).toBe(EXPECTED_TOTAL)
  })

  it('八组齐全且数量符合设计', () => {
    expect(spec.counts).toEqual({
      shell: 19,
      carriage: 35,
      ribbon: 16,
      typebars: 46,
      keys: 100,
      levers: 104,
      frame: 30,
      hardware: 222,
    })
    const sum = Object.values(spec.counts).reduce((a, b) => a + b, 0)
    expect(sum).toBe(EXPECTED_TOTAL)
  })

  it('每个零件有序列号且唯一', () => {
    const serials = new Set(spec.parts.map((p) => p.serial))
    expect(serials.size).toBe(EXPECTED_TOTAL)
    for (const part of spec.parts) {
      const meta = GROUPS.find((g) => g.id === part.group)!
      expect(part.serial.startsWith(meta.prefix + '-')).toBe(true)
    }
  })

  it('44 字符的击发联动图完整', () => {
    expect(spec.strike.size).toBe(44)
    for (const char of CHARS) {
      const link = spec.strike.get(char)
      expect(link, char).toBeDefined()
      for (const id of [link!.cap, link!.ring, link!.lever, link!.link, link!.typebar]) {
        expect(spec.byId.has(id), `${char} -> ${id}`).toBe(true)
      }
      expect(spec.byId.get(link!.typebar)!.char).toBe(char)
    }
  })

  it('所有零件都有双态变换与平铺参数', () => {
    for (const part of spec.parts) {
      expect(part.assembled.p).toHaveLength(3)
      expect(part.exploded.p).toHaveLength(3)
      expect(part.flatSize[0]).toBeGreaterThan(0)
      expect(part.flatSize[1]).toBeGreaterThan(0)
      expect(part.flatHeight).toBeGreaterThan(0)
      expect(part.stageOffset).toBeGreaterThanOrEqual(0)
      expect(part.stageOffset).toBeLessThanOrEqual(0.14)
    }
  })

  it('50 个键位全部生成', () => {
    expect(spec.keyIds.length).toBe(50)
    const chars = spec.keyIds.filter((k) => k.char)
    expect(chars.length).toBe(44)
  })
})

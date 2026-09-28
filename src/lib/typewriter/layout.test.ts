import { describe, expect, it } from 'vitest'
import { typewriterSpec } from './machine'
import { solveFlatLay } from './layout'

describe('平铺布局求解器', () => {
  const spec = typewriterSpec()
  const layout = solveFlatLay(spec.parts)

  it('每个零件都有平铺位', () => {
    expect(layout.placements.size).toBe(spec.parts.length)
  })

  it('版面为 16:9', () => {
    expect(layout.width / layout.depth).toBeCloseTo(16 / 9, 5)
  })

  it('零件互不重叠（保留可见间隙）', () => {
    const rects = spec.parts.map((part) => {
      const p = layout.placements.get(part.id)!
      const c = Math.abs(Math.cos(p.yaw))
      const s = Math.abs(Math.sin(p.yaw))
      const w = part.flatSize[0] * c + part.flatSize[1] * s
      const d = part.flatSize[0] * s + part.flatSize[1] * c
      return { id: part.id, x0: p.x - w / 2, x1: p.x + w / 2, z0: p.z - d / 2, z1: p.z + d / 2 }
    })
    // O(n²) 对 572 件可接受（测试一次性）
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i]!
        const b = rects[j]!
        const overlap =
          Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 0.001 &&
          Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0) > 0.001
        expect(overlap, `${a.id} 与 ${b.id} 重叠`).toBe(false)
      }
    }
  })

  it('所有零件落在版面内', () => {
    for (const part of spec.parts) {
      const p = layout.placements.get(part.id)!
      const c = Math.abs(Math.cos(p.yaw))
      const s = Math.abs(Math.sin(p.yaw))
      const w = part.flatSize[0] * c + part.flatSize[1] * s
      const d = part.flatSize[0] * s + part.flatSize[1] * c
      expect(Math.abs(p.x) + w / 2, part.id).toBeLessThanOrEqual(layout.width / 2 + 0.001)
      expect(Math.abs(p.z) + d / 2, part.id).toBeLessThanOrEqual(layout.depth / 2 + 0.001)
    }
  })

  it('同组零件聚成一块（组内最大跨度有界）', () => {
    const byGroup = new Map<string, { xs: number[]; zs: number[] }>()
    for (const part of spec.parts) {
      const p = layout.placements.get(part.id)!
      if (!byGroup.has(part.group)) byGroup.set(part.group, { xs: [], zs: [] })
      byGroup.get(part.group)!.xs.push(p.x)
      byGroup.get(part.group)!.zs.push(p.z)
    }
    for (const [group, pts] of byGroup) {
      const spanX = Math.max(...pts.xs) - Math.min(...pts.xs)
      const spanZ = Math.max(...pts.zs) - Math.min(...pts.zs)
      // 组块不应横跨整个版面
      expect(spanX, group).toBeLessThan(layout.width * 0.55)
      expect(spanZ, group).toBeLessThan(layout.depth * 0.95)
    }
  })

  it('平铺落地高度为正且小于零件尺寸', () => {
    for (const part of spec.parts) {
      const p = layout.placements.get(part.id)!
      expect(p.y, part.id).toBeGreaterThan(0)
      expect(p.y, part.id).toBeLessThan(0.5)
    }
  })
})

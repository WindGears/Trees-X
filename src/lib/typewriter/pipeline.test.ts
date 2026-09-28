import { describe, expect, it } from 'vitest'
import { typewriterSpec } from './machine'
import { solveFlatLay } from './layout'
import { evaluateTransform, cameraPoseAt } from './pipeline'
import { GROUPS } from './spec'

describe('三态变换管线', () => {
  const spec = typewriterSpec()
  const layout = solveFlatLay(spec.parts)

  it('p=0 为整机组装态', () => {
    for (const part of spec.parts) {
      const t = evaluateTransform(part, layout.placements.get(part.id), 0)
      expect(t).toEqual(part.assembled)
    }
  })

  it('p=1 为平铺态', () => {
    for (const part of spec.parts) {
      const flat = layout.placements.get(part.id)!
      const t = evaluateTransform(part, flat, 1)
      expect(t.p[0]).toBeCloseTo(flat.x)
      expect(t.p[2]).toBeCloseTo(flat.z)
      expect(t.r[1]).toBeCloseTo(flat.yaw)
    }
  })

  it('外壳比五金更早分离', () => {
    const shell = spec.byGroup.get('shell')![0]!
    const hardware = spec.byGroup.get('hardware')![0]!
    const p = 0.2
    const ts = evaluateTransform(shell, layout.placements.get(shell.id), p)
    const th = evaluateTransform(hardware, layout.placements.get(hardware.id), p)
    // 外壳已明显离开组装位，五金仍接近组装位
    const ds = Math.hypot(...ts.p.map((v, i) => v - shell.assembled.p[i]!))
    const dh = Math.hypot(...th.p.map((v, i) => v - hardware.assembled.p[i]!))
    expect(ds).toBeGreaterThan(dh)
  })

  it('进度连续变化时变换连续（无跳变）', () => {
    const part = spec.parts[100]!
    const flat = layout.placements.get(part.id)!
    let prev = evaluateTransform(part, flat, 0)
    for (let p = 0.01; p <= 1; p += 0.01) {
      const cur = evaluateTransform(part, flat, p)
      const jump = Math.hypot(...cur.p.map((v, i) => v - prev.p[i]!))
      expect(jump).toBeLessThan(2.0)
      prev = cur
    }
  })

  it('组分离顺序符合 GROUPS.explodeStart', () => {
    const order = [...GROUPS].sort((a, b) => a.explodeStart - b.explodeStart).map((g) => g.id)
    expect(order).toEqual([
      'shell',
      'carriage',
      'ribbon',
      'typebars',
      'keys',
      'levers',
      'frame',
      'hardware',
    ])
  })

  it('平铺相机把所有零件纳入视野', () => {
    const pose = cameraPoseAt(1, layout.width, layout.depth)
    // 顶视相机应高于所有零件，且距离足以覆盖版面
    expect(pose.position[1]).toBeGreaterThan(4)
    expect(Math.abs(pose.position[0])).toBeLessThan(0.1)
  })
})

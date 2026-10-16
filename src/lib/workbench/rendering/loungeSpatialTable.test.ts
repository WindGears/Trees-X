import { Box3, BoxGeometry, Group, Mesh, MeshPhysicalMaterial, Vector3 } from 'three'
import { describe, expect, it, vi } from 'vitest'
import {
  createLoungeSpatialTable,
  loungeMotionBounds,
  loungeTableDimensions,
} from './loungeSpatialTable'

describe('finite lounge table', () => {
  it('grounds the thick slab and body without moving the product origin', () => {
    const groundY = -0.0192,
      table = createLoungeSpatialTable({ groundY }),
      top = new Box3().setFromObject(table.top),
      body = new Box3().setFromObject(table.body)
    expect(top.max.y).toBeCloseTo(groundY, 6)
    expect(top.min.y).toBeCloseTo(groundY - loungeTableDimensions.slabHeight, 6)
    expect(body.max.y).toBeCloseTo(top.min.y, 6)
    expect(body.min.y).toBeCloseTo(table.floorY, 6)
    expect(top.getSize(new Vector3()).x).toBeCloseTo(8.4, 4)
    expect(top.getSize(new Vector3()).z).toBeCloseTo(4.8, 4)
    expect(table.group.position.toArray()).toEqual([0, 0, 0])
    expect(table.top.castShadow && table.top.receiveShadow).toBe(true)
    expect(table.body.castShadow && table.body.receiveShadow).toBe(true)
    table.dispose()
  })

  it('covers the audited all-vertex motion envelope, including the lateral packing sweep', () => {
    // The extrema come from current v2 GLB POSITION data + actual bindTypewriterRig,
    // sampled at 101 progress values, not from the semantic nodes' origins.
    const table = createLoungeSpatialTable({ groundY: -0.0192 }),
      halfWidth = table.dimensions.width / 2 - table.dimensions.radius,
      halfDepth = table.dimensions.depth / 2 - table.dimensions.radius
    expect(loungeMotionBounds.samples).toBe(101)
    expect(loungeMotionBounds.max[0]).toBeGreaterThan(3.6)
    expect(loungeMotionBounds.min[0]).toBeGreaterThan(-halfWidth)
    expect(loungeMotionBounds.max[0]).toBeLessThan(halfWidth)
    expect(loungeMotionBounds.min[2]).toBeGreaterThan(-halfDepth)
    expect(loungeMotionBounds.max[2]).toBeLessThan(halfDepth)
    table.dispose()
  })

  it('gives caps normalized planar UVs and sides an independent height direction', () => {
    const table = createLoungeSpatialTable({ groundY: 0 }),
      geometry = table.top.geometry,
      position = geometry.getAttribute('position'),
      normal = geometry.getAttribute('normal'),
      uv = geometry.getAttribute('uv')
    let cap = 0,
      side = 0
    expect(new Set(geometry.groups.map((g) => g.materialIndex))).toEqual(new Set([0, 1]))
    for (let i = 0; i < position.count; i++) {
      expect(uv.getX(i)).toBeGreaterThanOrEqual(-0.001)
      expect(uv.getX(i)).toBeLessThanOrEqual(1.001)
      expect(uv.getY(i)).toBeGreaterThanOrEqual(-0.001)
      expect(uv.getY(i)).toBeLessThanOrEqual(1.001)
      if (normal.getY(i) > 0.99) {
        cap++
        expect(uv.getX(i)).toBeCloseTo(position.getX(i) / 8.4 + 0.5, 6)
      } else if (Math.abs(normal.getY(i)) < 0.1) {
        side++
        expect(uv.getY(i)).toBeCloseTo((position.getY(i) + 0.26) / 0.26, 6)
      }
    }
    expect(cap).toBeGreaterThan(0)
    expect(side).toBeGreaterThan(0)
    table.dispose()
  })

  it('releases derived geometry and owned materials once, preserving borrowed inputs', () => {
    const borrowed = new MeshPhysicalMaterial(),
      borrowedDispose = vi.spyOn(borrowed, 'dispose'),
      table = createLoungeSpatialTable({ groundY: 0, topMaterial: borrowed }),
      geometryDispose = vi.spyOn(table.top.geometry, 'dispose'),
      bodyDispose = vi.spyOn(table.body.geometry, 'dispose'),
      sideDispose = vi.spyOn(
        (Array.isArray(table.top.material) ? table.top.material : [table.top.material])[1]!,
        'dispose',
      ),
      bodyMaterialDispose = vi.spyOn(table.body.material, 'dispose'),
      host = new Group(),
      product = new Mesh(new BoxGeometry(), borrowed)
    host.add(table.group, product)
    table.dispose()
    table.dispose()
    expect(geometryDispose).toHaveBeenCalledTimes(1)
    expect(bodyDispose).toHaveBeenCalledTimes(1)
    expect(sideDispose).toHaveBeenCalledTimes(1)
    expect(bodyMaterialDispose).toHaveBeenCalledTimes(1)
    expect(borrowedDispose).not.toHaveBeenCalled()
    expect(host.children).toEqual([product])
    product.geometry.dispose()
    borrowed.dispose()
  })
})

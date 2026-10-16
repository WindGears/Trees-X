import { Box3, MeshPhysicalMaterial } from 'three'
import { describe, expect, it, vi } from 'vitest'
import { studioPalettes } from '../studio/palette'
import { createGpuStudioGeometry } from './studioGeometry'
import { createGpuStudioReflection } from './studioReflection'

describe('spatial experimental stage profile', () => {
  it('uses a grounded table only with an explicit profile and preserves source handles', () => {
    const ordinary = createGpuStudioGeometry(-0.0192),
      experimental = createGpuStudioGeometry(-0.0192, false, studioPalettes.light, true)
    try {
      expect(ordinary.table).toBeUndefined()
      expect(ordinary.floorMesh.visible).toBe(true)
      expect(experimental.table).toBeDefined()
      expect(experimental.pedestal).toBe(experimental.table!.top)
      expect(experimental.pedestal.material).toBe(experimental.surface)
      expect(experimental.surface).toBeInstanceOf(MeshPhysicalMaterial)
      expect(experimental.tableSideMaterial).toBeInstanceOf(MeshPhysicalMaterial)
      expect(experimental.floorMesh.position.y).toBeCloseTo(-2.4792, 6)
      expect(experimental.floorMesh.visible).toBe(false)
      expect(experimental.sky.visible).toBe(true)
      expect(new Box3().setFromObject(experimental.table!.body).min.y).toBeCloseTo(-2.4792, 6)
    } finally {
      ordinary.dispose()
      experimental.dispose()
    }
  })

  it('retains one owner for the borrowed table materials and all table geometries', () => {
    const geometry = createGpuStudioGeometry(-0.0192, false, studioPalettes.light, true),
      table = geometry.table!,
      releases = [
        geometry.surface,
        geometry.tableSideMaterial!,
        table.top.geometry,
        table.body.geometry,
        table.body.material,
      ].map((owner) => vi.spyOn(owner, 'dispose'))
    geometry.dispose()
    geometry.dispose()
    for (const release of releases) expect(release).toHaveBeenCalledTimes(1)
  })

  it('covers the expanded table in the same reflection plane without a new renderer', () => {
    const geometry = createGpuStudioGeometry(-0.0192, false, studioPalettes.light, true),
      reflection = createGpuStudioReflection(-0.0192, 0.5, geometry.table!.dimensions)
    reflection.mesh.updateMatrixWorld(true)
    const bounds = new Box3().setFromObject(reflection.mesh)
    expect(bounds.min.x).toBeLessThan(-4)
    expect(bounds.max.x).toBeGreaterThan(4)
    expect(bounds.min.z).toBeLessThan(-2.2)
    expect(bounds.max.z).toBeGreaterThan(2.2)
    expect(reflection.mesh.position.y).toBeCloseTo(-0.0192 + 0.00035, 6)
    reflection.dispose()
    geometry.dispose()
  })
})

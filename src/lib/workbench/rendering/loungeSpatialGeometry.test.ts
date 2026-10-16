import { BackSide, Texture, Vector3 } from 'three'
import { describe, expect, it, vi } from 'vitest'
import {
  createDepthLoungeProjection,
  createFiniteLoungeProjection,
  createRadialLoungeGeometry,
  type DepthLoungeProjectionOptions,
} from './loungeSpatialGeometry'

const input = (depth = new Float32Array(8 * 5).fill(10)): DepthLoungeProjectionOptions => ({
  depth,
  width: 8,
  height: 5,
  calibration: { origin: [0, 1.5, 0], scale: 1, minRadius: 2, maxRadius: 30, longitudeOffset: 0 },
  segments: { longitude: 8, latitude: 4 },
})

describe('finite and radial image rooms', () => {
  it('creates finite depth-writing room surfaces and borrows the panorama', () => {
    const image = new Texture(),
      imageDispose = vi.spyOn(image, 'dispose'),
      room = createFiniteLoungeProjection(image, {
        min: [-24, -2.4792, -24],
        max: [24, 18, 24],
        captureOrigin: [0, 1.5, 0],
      }),
      geometryDispose = vi.spyOn(room.mesh.geometry, 'dispose'),
      materialDispose = vi.spyOn(room.mesh.material, 'dispose')
    expect(room.bounds.min.toArray()).toEqual([-24, -2.4792, -24])
    expect(room.mesh.material.side).toBe(BackSide)
    expect(room.mesh.material.depthWrite && room.mesh.material.depthTest).toBe(true)
    expect(room.mesh.material.isMeshBasicNodeMaterial).toBe(true)
    expect(room.mesh.material.vertexNode).toBeNull()
    expect(room.mesh.position.y).toBeCloseTo((18 - 2.4792) / 2, 6)
    room.dispose()
    room.dispose()
    expect(geometryDispose).toHaveBeenCalledTimes(1)
    expect(materialDispose).toHaveBeenCalledTimes(1)
    expect(imageDispose).not.toHaveBeenCalled()
    image.dispose()
  })

  it('maps north/south and cardinal directions in the same convention as Three equirectUV', () => {
    const room = createRadialLoungeGeometry(input()),
      p = room.geometry.getAttribute('position'),
      uv = room.geometry.getAttribute('uv'),
      stride = 9,
      centre = new Vector3(0, 1.5, 0)
    const point = (x: number, y: number) =>
      new Vector3().fromBufferAttribute(p, y * stride + x).sub(centre)
    expect(point(4, 2).toArray()).toEqual([10, 0, 0])
    expect(point(6, 2).z).toBeCloseTo(10)
    expect(point(0, 2).x).toBeCloseTo(-10)
    expect(point(0, 0).y).toBeCloseTo(10)
    expect(point(0, 4).y).toBeCloseTo(-10)
    expect(uv.getY(0)).toBe(1)
    expect(uv.getY(4 * stride)).toBe(0)
    for (let y = 0; y <= 4; y++) expect(point(0, y).distanceTo(point(8, y))).toBeLessThan(1e-10)
    // Verify an equatorial triangle faces outward; BackSide sees it from inside.
    const a = point(4, 2),
      b = point(5, 2),
      c = point(4, 3)
    expect(b.clone().sub(a).cross(c.clone().sub(a)).dot(a)).toBeGreaterThan(0)
    expect(room.stats.rejectedTriangles).toBe(0)
    room.geometry.dispose()
  })

  it('uses the same longitude rotation for image sampling and depth vertices', () => {
    const config = input()
    config.calibration.longitudeOffset = 0.25
    const room = createRadialLoungeGeometry(config),
      p = room.geometry.getAttribute('position'),
      vertex = new Vector3().fromBufferAttribute(p, 2 * 9 + 4)
    expect(vertex.x).toBeCloseTo(0)
    expect(vertex.z).toBeCloseTo(-10)
    room.geometry.dispose()
  })

  it('cuts triangles spanning depth discontinuities and skips invalid samples', () => {
    const depth = new Float32Array(40).fill(5)
    for (let y = 0; y < 5; y++) for (let x = 4; x < 8; x++) depth[y * 8 + x] = 20
    depth[2 * 8 + 1] = Number.NaN
    const room = createRadialLoungeGeometry(input(depth)),
      index = room.geometry.index!,
      points = room.geometry.getAttribute('position'),
      centre = new Vector3(0, 1.5, 0),
      vertex = new Vector3()
    expect(room.stats.rejectedTriangles).toBeGreaterThan(0)
    expect(room.stats.invalidSamples).toBeGreaterThan(0)
    for (let i = 0; i < index.count; i += 3) {
      const radii = [0, 1, 2].map((j) =>
        vertex.fromBufferAttribute(points, index.getX(i + j)).distanceTo(centre),
      )
      expect(Math.max(...radii) / Math.min(...radii)).toBeLessThan(1.35001)
    }
    room.geometry.dispose()
  })

  it('owns proxies and fallback exactly once without disposing the source image', () => {
    const image = new Texture(),
      imageDispose = vi.spyOn(image, 'dispose'),
      options = input()
    options.fallbackBounds = { min: [-40, -20, -40], max: [40, 40, 40] }
    const room = createDepthLoungeProjection(image, options),
      radialDispose = vi.spyOn(room.mesh.geometry, 'dispose'),
      fallbackDispose = vi.spyOn(room.fallback!.mesh.geometry, 'dispose'),
      materialDispose = vi.spyOn(room.mesh.material, 'dispose')
    expect(room.group.children).toHaveLength(2)
    room.dispose()
    room.dispose()
    expect(radialDispose).toHaveBeenCalledTimes(1)
    expect(fallbackDispose).toHaveBeenCalledTimes(1)
    expect(materialDispose).toHaveBeenCalledTimes(1)
    expect(imageDispose).not.toHaveBeenCalled()
    image.dispose()
  })

  it('rejects impossible dimensions and calibration rather than inventing depth', () => {
    expect(() => createRadialLoungeGeometry({ ...input(), width: 9 })).toThrow()
    const options = input()
    options.calibration.scale = 0
    expect(() => createRadialLoungeGeometry(options)).toThrow()
    expect(() => createRadialLoungeGeometry(input(new Float32Array(40)))).toThrow(
      '全景深度没有有效距离',
    )
    expect(() =>
      createFiniteLoungeProjection(new Texture(), {
        min: [0, 0, 0],
        max: [0, 1, 1],
        captureOrigin: [0, 0.5, 0],
      }),
    ).toThrow()
  })
})

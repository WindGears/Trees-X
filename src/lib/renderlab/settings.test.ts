import { describe, expect, it } from 'vitest'
import { BufferAttribute, BufferGeometry, PlaneGeometry } from 'three'
import { prepareLabGeometry } from './scene'
import { labSettings, readLabRequest } from './settings'

describe('isolated shared PBR comparison request', () => {
  it('uses one fixed camera and lighting baseline regardless of renderer choice', () => {
    for (const mode of ['webgl', 'webgpu', 'pathtrace'])
      expect(readLabRequest(`?mode=${mode}&view=metal&samples=256`)).toEqual({
        mode,
        view: 'metal',
        samples: 256,
      })
    expect(labSettings.zoom).toBe(0.9375)
    expect(labSettings.viewOffset).toEqual({ x: -58, y: 16 })
    expect(labSettings.pathtrace.denoising).toBe(false)
    expect(labSettings.pathtrace.upscaling).toBe(false)
    expect(labSettings.pathtrace.generateMissingAttributes).toBe(false)
    expect(labSettings.pathtrace.clampDirect).toBe(0)
    expect(labSettings.pathtrace.clampIndirect).toBe(0)
  })

  it('rejects unsupported modes, views and unsafe or indefinite sample counts', () => {
    for (const query of [
      '?mode=fallback',
      '?view=imaginary',
      '?samples=0',
      '?samples=1.5',
      '?samples=NaN',
      '?samples=2048',
    ])
      expect(() => readLabRequest(query)).toThrow()
  })

  it('prepares actual tangents identically for every mode, without mutating UVs or duplicating geometry', async () => {
    const reports = []
    for (const mode of ['webgl', 'webgpu', 'pathtrace']) {
      expect(readLabRequest(`?mode=${mode}`).mode).toBe(mode)
      const geometry = new PlaneGeometry(),
        uv = geometry.getAttribute('uv'),
        index = geometry.index,
        normal = geometry.getAttribute('normal')
      const prepared = await prepareLabGeometry([geometry, geometry])
      expect(prepared.geometries).toBe(1)
      expect(prepared.uvGeometries).toBe(1)
      expect(prepared.created).toEqual({ indices: 0, normals: 0, tangents: 1, zeroTangents: 0 })
      expect(geometry.getAttribute('uv')).toBe(uv)
      expect(geometry.getAttribute('normal')).toBe(normal)
      expect(geometry.index).toBe(index)
      const tangent = geometry.getAttribute('tangent')
      for (let i = 0; i < tangent.count; i++) {
        expect(tangent.getX(i)).toBeCloseTo(1)
        expect(tangent.getY(i)).toBeCloseTo(0)
        expect(Math.abs(tangent.getW(i))).toBe(1)
      }
      const repeated = await prepareLabGeometry([geometry])
      expect(repeated.sha256).toBe(prepared.sha256)
      expect(repeated.created).toEqual({ indices: 0, normals: 0, tangents: 0, zeroTangents: 0 })
      expect(geometry.getAttribute('tangent')).toBe(tangent)
      reports.push(prepared)
      geometry.dispose()
    }
    expect(reports[1]).toEqual(reports[0])
    expect(reports[2]).toEqual(reports[0])
  })

  it('keeps absent UVs absent and hashes attribute bytes, including missing-attribute preparation', async () => {
    const geometry = new BufferGeometry()
    geometry.setAttribute(
      'position',
      new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3),
    )
    const prepared = await prepareLabGeometry([geometry])
    expect(prepared.created).toEqual({ indices: 1, normals: 1, tangents: 0, zeroTangents: 1 })
    expect(prepared.noUvGeometries).toBe(1)
    expect(geometry.getAttribute('uv')).toBeUndefined()
    expect([...geometry.getAttribute('tangent').array]).toEqual(new Array(12).fill(0))
    expect([...geometry.index!.array]).toEqual([0, 1, 2])
    geometry.getAttribute('position').setX(1, 2)
    expect((await prepareLabGeometry([geometry])).sha256).not.toBe(prepared.sha256)
    geometry.dispose()
  })

  it('rejects incomplete UVs instead of manufacturing texture coordinates', async () => {
    const geometry = new PlaneGeometry()
    geometry.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0]), 2))
    await expect(prepareLabGeometry([geometry])).rejects.toThrow('UV 不完整')
    expect(geometry.getAttribute('tangent')).toBeUndefined()
    geometry.dispose()
  })
})

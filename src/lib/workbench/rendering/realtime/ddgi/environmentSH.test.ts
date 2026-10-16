import { describe, expect, it, vi } from 'vitest'
import {
  DataTexture,
  DataUtils,
  EquirectangularReflectionMapping,
  Euler,
  FloatType,
  HalfFloatType,
  LinearSRGBColorSpace,
  RedFormat,
  RGBFormat,
  RGBAFormat,
  SRGBColorSpace,
  Texture,
  Vector3,
} from 'three'
import { projectEnvironmentSH } from './environmentSH'

type Radiance = readonly [number, number, number]

function source(
  radiance: (u: number, v: number) => Radiance,
  options: { half?: boolean; rgb?: boolean; flipY?: boolean; width?: number; height?: number } = {},
) {
  const width = options.width ?? 128
  const height = options.height ?? 64
  const channels = options.rgb ? 3 : 4
  const data = options.half
    ? new Uint16Array(width * height * channels)
    : new Float32Array(width * height * channels)
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      const values = [...radiance((column + 0.5) / width, (row + 0.5) / height), 0]
      for (let component = 0; component < channels; component++) {
        const value = values[component] ?? 0
        data[(row * width + column) * channels + component] = options.half
          ? DataUtils.toHalfFloat(value)
          : value
      }
    }
  }
  const texture = new DataTexture(
    data,
    width,
    height,
    options.rgb ? RGBFormat : RGBAFormat,
    options.half ? HalfFloatType : FloatType,
  )
  texture.mapping = EquirectangularReflectionMapping
  texture.colorSpace = LinearSRGBColorSpace
  texture.flipY = options.flipY ?? false
  return texture
}

describe('borrowed HDR environment radiance SH9 projection', () => {
  it.each([{ rgb: true }, { half: true }, { width: 1, height: 1 }])(
    'preserves constant HDR radiance and applies environment intensity with %o',
    (options) => {
      const texture = source(() => [2, 4, 8], options)
      const { sh, metadata } = projectEnvironmentSH(texture, 0.35)
      const constant = sh.coefficients[0]!
      const expected = Math.sqrt(4 * Math.PI) * 0.35
      expect(constant.x).toBeCloseTo(2 * expected, 4)
      expect(constant.y).toBeCloseTo(4 * expected, 4)
      expect(constant.z).toBeCloseTo(8 * expected, 4)
      for (const coefficient of sh.coefficients.slice(1))
        expect(coefficient.length()).toBeLessThan(0.003)
      const reconstructed = sh.getAt(new Vector3(1, 0, 0), new Vector3())
      expect(reconstructed.x).toBeCloseTo(0.7, 3)
      expect(Math.abs(reconstructed.z - 2.8)).toBeLessThan(0.001)
      expect(metadata).toMatchObject({
        projection: 'radiance-sh9',
        linearHDR: true,
        intensity: 0.35,
        samples: 8192,
        channels: options.rgb ? 3 : 4,
        dataType: options.half ? 'float16' : 'float32',
      })
    },
  )

  it('maps a north-first HDR row to +Y only with flipY and preserves hemisphere signs', () => {
    const texture = source((_u, rowV) => (rowV < 0.5 ? [1, 0, 0] : [0, 0, 0]))
    expect(projectEnvironmentSH(texture).sh.coefficients[1]!.x).toBeLessThan(-1.5)
    texture.flipY = true
    const { sh } = projectEnvironmentSH(texture)
    expect(sh.coefficients[1]!.x).toBeCloseTo(Math.PI * 0.488603, 3)
    expect(sh.getAt(new Vector3(0, 1, 0), new Vector3()).x).toBeGreaterThan(1)
    expect(sh.getAt(new Vector3(0, -1, 0), new Vector3()).x).toBeLessThan(0)
  })

  it.each([
    { axis: 'x', coefficient: 3 },
    { axis: 'z', coefficient: 2 },
  ] as const)(
    'preserves longitude orientation for the +$axis hemisphere',
    ({ axis, coefficient }) => {
      const texture = source((u) => {
        const angle = (u - 0.5) * 2 * Math.PI
        return (axis === 'x' ? Math.cos(angle) : Math.sin(angle)) > 0 ? [1, 0, 0] : [0, 0, 0]
      })
      const { sh } = projectEnvironmentSH(texture)
      expect(sh.coefficients[coefficient]!.x).toBeCloseTo(Math.PI * 0.488603, 3)
      expect(sh.coefficients[axis === 'x' ? 2 : 3]!.x).toBeCloseTo(0, 10)
    },
  )

  it('rotates source radiance into world space using scene.environmentRotation convention', () => {
    const texture = source((u) => (u > 0.5 ? [1, 0, 0] : [0, 0, 0]))
    const rotation = new Euler(0, Math.PI / 2, 0)
    const original = rotation.clone()
    const { sh } = projectEnvironmentSH(texture, 1, rotation)
    expect(sh.coefficients[3]!.x).toBeCloseTo(Math.PI * 0.488603, 3)
    expect(sh.coefficients[2]!.x).toBeCloseTo(0, 10)
    expect(rotation.equals(original)).toBe(true)
  })

  it('decodes HDR half floats including subnormals and ignores RGBA alpha', () => {
    const texture = source(() => [64, 0.5, 2 ** -24], { half: true })
    const { sh } = projectEnvironmentSH(texture)
    const coefficient = sh.coefficients[0]!
    expect(coefficient.x).toBeCloseTo(64 * Math.sqrt(4 * Math.PI), 3)
    expect(coefficient.y).toBeCloseTo(0.5 * Math.sqrt(4 * Math.PI), 5)
    expect(coefficient.z).toBeCloseTo(2 ** -24 * Math.sqrt(4 * Math.PI), 12)
  })

  it('bounds work for a larger source and leaves source state and ownership unchanged', () => {
    const texture = source(() => [1, 2, 3], { width: 512, height: 256, flipY: true })
    const data = texture.image.data
    if (!data) throw new Error('Missing test source data')
    const before = Array.from(data)
    const dispose = vi.spyOn(texture, 'dispose')
    const version = texture.version
    const projection = projectEnvironmentSH(texture)
    expect(projection.metadata).toMatchObject({
      width: 512,
      height: 256,
      sampleWidth: 128,
      sampleHeight: 64,
      samples: 8192,
      flipY: true,
    })
    expect(texture.image.data).toBe(data)
    expect(Array.from(data)).toEqual(before)
    expect(texture.version).toBe(version)
    expect(texture.flipY).toBe(true)
    expect(dispose).not.toHaveBeenCalled()
  })

  it('rejects unreadable, encoded, malformed and incompatible textures explicitly', () => {
    expect(() => projectEnvironmentSH(new Texture())).toThrow('CPU-readable')
    const texture = source(() => [1, 1, 1])
    texture.mapping = new Texture().mapping
    expect(() => projectEnvironmentSH(texture)).toThrow('equirectangular')
    texture.mapping = EquirectangularReflectionMapping
    texture.colorSpace = SRGBColorSpace
    expect(() => projectEnvironmentSH(texture)).toThrow('linear HDR')
    texture.colorSpace = LinearSRGBColorSpace
    texture.format = RedFormat
    expect(() => projectEnvironmentSH(texture)).toThrow('RGB or RGBA')
    texture.format = RGBAFormat
    texture.image.width = 0
    expect(() => projectEnvironmentSH(texture)).toThrow('dimensions')
    texture.image.width = 128
    texture.image.data = new Float32Array(4)
    expect(() => projectEnvironmentSH(texture)).toThrow('buffer length')
    texture.image.data = new Uint16Array(128 * 64 * 4)
    expect(() => projectEnvironmentSH(texture)).toThrow('FloatType Float32Array')
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1])('rejects invalid radiance %s', (value) => {
    const texture = source(() => [value, 1, 1])
    expect(() => projectEnvironmentSH(texture)).toThrow('sampled radiance')
  })

  it.each([0x7c00, 0x7e00, 0xbc00])('rejects invalid encoded half radiance %s', (bits) => {
    const texture = source(() => [1, 1, 1], { half: true })
    if (!texture.image.data) throw new Error('Missing test source data')
    texture.image.data[0] = bits
    expect(() => projectEnvironmentSH(texture)).toThrow('sampled radiance')
  })

  it('rejects invalid intensity and rotation while allowing an explicitly zero intensity', () => {
    const texture = source(() => [1, 1, 1])
    for (const intensity of [-1, Number.NaN, Number.POSITIVE_INFINITY])
      expect(() => projectEnvironmentSH(texture, intensity)).toThrow('intensity')
    expect(() => projectEnvironmentSH(texture, 1, new Euler(0, Number.NaN, 0))).toThrow('rotation')
    expect(
      projectEnvironmentSH(texture, 0)
        .sh.toArray()
        .every((value) => value === 0),
    ).toBe(true)
  })
})

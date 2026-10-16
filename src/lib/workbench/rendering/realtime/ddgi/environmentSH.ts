import {
  DataTexture,
  DataUtils,
  EquirectangularReflectionMapping,
  FloatType,
  HalfFloatType,
  LinearSRGBColorSpace,
  NoColorSpace,
  Quaternion,
  RGBFormat,
  RGBAFormat,
  SphericalHarmonics3,
  Vector3,
} from 'three'
import type { Euler, Texture } from 'three'

const SAMPLE_WIDTH = 128
const SAMPLE_HEIGHT = 64
const EULER_ORDERS = new Set(['XYZ', 'YZX', 'ZXY', 'XZY', 'YXZ', 'ZYX'])

export interface EnvironmentSHMetadata {
  readonly projection: 'radiance-sh9'
  readonly linearHDR: true
  readonly sourceUuid: string
  readonly width: number
  readonly height: number
  readonly channels: 3 | 4
  readonly dataType: 'float32' | 'float16'
  readonly colorSpace: typeof LinearSRGBColorSpace | typeof NoColorSpace
  readonly flipY: boolean
  readonly intensity: number
  readonly sampleWidth: number
  readonly sampleHeight: number
  readonly samples: number
}

export interface EnvironmentSHProjection {
  readonly sh: SphericalHarmonics3
  readonly metadata: EnvironmentSHMetadata
}

/**
 * One-time CPU projection of a borrowed linear HDR equirectangular source.
 * SH9 is a low-frequency radiance approximation, not irradiance or a replacement
 * for sharp environment reflections. A fixed 128 × 64 quadrature bounds work;
 * features narrower than this grid can be missed. The caller supplies the
 * scene's environmentIntensity and environmentRotation when rebuilding the sky.
 * This function never uploads, reads the GPU, mutates, or disposes the source.
 */
export function projectEnvironmentSH(
  texture: Texture,
  intensity = 1,
  rotation?: Euler,
): EnvironmentSHProjection {
  if (
    !(texture instanceof DataTexture) ||
    texture.isRenderTargetTexture ||
    texture.mapping !== EquirectangularReflectionMapping
  )
    throw new Error('DDGI sky requires a CPU-readable equirectangular DataTexture.')
  if (texture.format !== RGBFormat && texture.format !== RGBAFormat)
    throw new Error('DDGI sky requires RGB or RGBA radiance data.')
  if (texture.colorSpace !== LinearSRGBColorSpace && texture.colorSpace !== NoColorSpace)
    throw new Error('DDGI sky requires linear HDR radiance, not encoded color data.')
  if (texture.premultiplyAlpha)
    throw new Error('DDGI sky does not support premultiplied radiance data.')
  if (!Number.isFinite(intensity) || intensity < 0)
    throw new Error('DDGI sky intensity must be finite and non-negative.')
  if (
    rotation &&
    (!Number.isFinite(rotation.x) ||
      !Number.isFinite(rotation.y) ||
      !Number.isFinite(rotation.z) ||
      !EULER_ORDERS.has(rotation.order))
  )
    throw new Error('DDGI sky rotation must be a finite Euler rotation.')

  const { width, height, data } = texture.image
  const channels = texture.format === RGBFormat ? 3 : 4
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    !Number.isSafeInteger(width * height * channels) ||
    data?.length !== width * height * channels
  )
    throw new Error('DDGI sky radiance dimensions and buffer length must match.')
  const half = texture.type === HalfFloatType && data instanceof Uint16Array
  const full = texture.type === FloatType && data instanceof Float32Array
  if (!half && !full)
    throw new Error('DDGI sky requires FloatType Float32Array or HalfFloatType Uint16Array.')

  const read = (offset: number): number => {
    const stored = data[offset]
    const value =
      stored === undefined ? Number.NaN : half ? DataUtils.fromHalfFloat(stored) : stored
    if (!Number.isFinite(value) || value < 0)
      throw new Error('DDGI sky sampled radiance must be finite and non-negative.')
    return value
  }
  const sh = new SphericalHarmonics3()
  const direction = new Vector3()
  const radiance = new Vector3()
  const basis: number[] = new Array<number>(9).fill(0)
  const orientation = rotation ? new Quaternion().setFromEuler(rotation) : new Quaternion()
  const longitudeStep = (2 * Math.PI) / SAMPLE_WIDTH
  for (let row = 0; row < SAMPLE_HEIGHT; row++) {
    const v = (row + 0.5) / SAMPLE_HEIGHT
    const latitude = (v - 0.5) * Math.PI
    const cosLatitude = Math.cos(latitude)
    // Integrate each spherical cell's solid angle exactly, including polar rows.
    const weight =
      longitudeStep *
      (Math.sin(((row + 1) / SAMPLE_HEIGHT - 0.5) * Math.PI) -
        Math.sin((row / SAMPLE_HEIGHT - 0.5) * Math.PI))
    const sourceRow = texture.flipY ? height - 1 - Math.floor(v * height) : Math.floor(v * height)
    for (let column = 0; column < SAMPLE_WIDTH; column++) {
      const u = (column + 0.5) / SAMPLE_WIDTH
      const longitude = (u - 0.5) * 2 * Math.PI
      const offset = (sourceRow * width + Math.floor(u * width)) * channels
      radiance.set(read(offset), read(offset + 1), read(offset + 2))
      // Inverse of Three's equirectUV; R maps source directions into world space
      // because the native material samples the environment using inverse R.
      direction
        .set(
          cosLatitude * Math.cos(longitude),
          Math.sin(latitude),
          cosLatitude * Math.sin(longitude),
        )
        .applyQuaternion(orientation)
      SphericalHarmonics3.getBasisAt(direction, basis)
      for (const [index, coefficient] of sh.coefficients.entries()) {
        const value = basis[index]
        if (value !== undefined) coefficient.addScaledVector(radiance, value * weight * intensity)
      }
    }
  }
  return {
    sh,
    metadata: {
      projection: 'radiance-sh9',
      linearHDR: true,
      sourceUuid: texture.uuid,
      width,
      height,
      channels,
      dataType: half ? 'float16' : 'float32',
      colorSpace: texture.colorSpace,
      flipY: texture.flipY,
      intensity,
      sampleWidth: SAMPLE_WIDTH,
      sampleHeight: SAMPLE_HEIGHT,
      samples: SAMPLE_WIDTH * SAMPLE_HEIGHT,
    },
  }
}

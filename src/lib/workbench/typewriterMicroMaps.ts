import {
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RepeatWrapping,
  RGBAFormat,
  UnsignedByteType,
} from 'three'

export type MicroFinish = 'paint' | 'brush' | 'iron'
const size = 128

// Integer hashing and periodic value noise make repeatable, seamless maps;
// no per-frame noise or random texture generation in a rendering callback.
function hash(x: number, y: number, period: number, verticalPeriod = period) {
  let value =
    (Math.imul((x + period) % period, 374761393) +
      Math.imul((y + verticalPeriod) % verticalPeriod, 668265263)) |
    0
  value = Math.imul(value ^ (value >>> 13), 1274126177)
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295
}
function noise(x: number, y: number, period: number, verticalPeriod = period) {
  const ix = Math.floor(x),
    iy = Math.floor(y)
  const fx = x - ix,
    fy = y - iy
  const sx = fx * fx * (3 - 2 * fx),
    sy = fy * fy * (3 - 2 * fy)
  const a = hash(ix, iy, period, verticalPeriod),
    b = hash(ix + 1, iy, period, verticalPeriod)
  const c = hash(ix, iy + 1, period, verticalPeriod),
    d = hash(ix + 1, iy + 1, period, verticalPeriod)
  return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy
}

export function createTypewriterMicroMaps(kind: MicroFinish) {
  const normalData = new Uint8Array(size * size * 4)
  const roughData = new Uint8Array(normalData.length)
  const sample = (x: number, y: number) => {
    const u = ((x + size) % size) / size,
      v = ((y + size) % size) / size
    if (kind === 'brush') return noise(u * 48, v * 3, 48, 3)
    return noise(u * 16, v * 16, 16) * 0.7 + noise(u * 32, v * 32, 32) * 0.3
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const offset = (y * size + x) * 4
      const nx = (sample(x - 1, y) - sample(x + 1, y)) * 0.2
      const ny = (sample(x, y - 1) - sample(x, y + 1)) * 0.2
      const length = Math.hypot(nx, ny, 1)
      normalData[offset] = Math.round(((nx / length) * 0.5 + 0.5) * 255)
      normalData[offset + 1] = Math.round(((ny / length) * 0.5 + 0.5) * 255)
      normalData[offset + 2] = Math.round(((1 / length) * 0.5 + 0.5) * 255)
      normalData[offset + 3] = 255
      // Roughness reads green; keep it near white, without coarse color mottling.
      roughData[offset] = roughData[offset + 2] = 255
      roughData[offset + 1] = Math.round(250 + (sample(x, y) - 0.5) * 8)
      roughData[offset + 3] = 255
    }
  }
  function texture(data: Uint8Array, suffix: string) {
    const map = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType)
    map.name = `Trees X / ${kind} ${suffix} v1`
    map.colorSpace = NoColorSpace
    map.wrapS = map.wrapT = RepeatWrapping
    map.repeat.setScalar(kind === 'paint' ? 10 : kind === 'iron' ? 12 : 8)
    map.minFilter = LinearMipmapLinearFilter
    map.magFilter = LinearFilter
    map.generateMipmaps = true
    map.needsUpdate = true
    return map
  }
  const normal = texture(normalData, 'normal'),
    roughness = texture(roughData, 'roughness')
  let references = 0,
    disposed = false
  return {
    normal,
    roughness,
    retain() {
      if (!disposed) references++
    },
    release() {
      if (disposed || --references > 0) return
      disposed = true
      normal.dispose()
      roughness.dispose()
    },
  }
}

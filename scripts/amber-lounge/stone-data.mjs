import sharp from 'sharp'

export const STONE_DATA_RECIPE = Object.freeze({
  version: 1,
  seed: 0x5747414d,
  size: 512,
  roughnessCenter: 0.325,
  roughnessAmplitude: 0.045,
  maximumNormalSlope: 0.11,
})

function randomSequence(seed) {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x100000000
  }
}

/** Numerical microrelief only: the generated baseColor is never sampled here. */
export function createStoneData(size = STONE_DATA_RECIPE.size) {
  if (!Number.isInteger(size) || size < 32)
    throw new Error('Stone data requires at least 32 samples')
  const random = randomSequence(STONE_DATA_RECIPE.seed)
  const modes = Array.from({ length: 12 }, (_, index) => ({
    u: 3 + Math.floor(random() * 52),
    v: 3 + Math.floor(random() * 52),
    phaseU: random() * Math.PI * 2,
    phaseV: random() * Math.PI * 2,
    amplitude: 1 / (1 + index * 0.3),
  }))
  const weight = modes.reduce((sum, mode) => sum + mode.amplitude, 0)
  const slopeWeight = modes.reduce(
    (sum, mode) => sum + mode.amplitude * Math.max(mode.u, mode.v),
    0,
  )
  const normal = Buffer.alloc(size * size * 3)
  const roughness = Buffer.alloc(size * size * 3)
  const tau = Math.PI * 2
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Including the periodic endpoint gives byte-identical opposing borders.
      const u = x / (size - 1)
      const v = y / (size - 1)
      let field = 0,
        du = 0,
        dv = 0
      for (const mode of modes) {
        const angleU = tau * mode.u * u + mode.phaseU
        const angleV = tau * mode.v * v + mode.phaseV
        const sinU = Math.sin(angleU)
        const sinV = Math.sin(angleV)
        field += mode.amplitude * sinU * sinV
        du += mode.amplitude * mode.u * Math.cos(angleU) * sinV
        dv += mode.amplitude * mode.v * sinU * Math.cos(angleV)
      }
      const value = Math.round(
        255 *
          (STONE_DATA_RECIPE.roughnessCenter +
            (field / weight) * STONE_DATA_RECIPE.roughnessAmplitude),
      )
      const nx = (-du / slopeWeight) * STONE_DATA_RECIPE.maximumNormalSlope
      // PNG rows run downwards; TextureLoader.flipY=true makes UV V run upwards.
      // Invert the image-row derivative once for the OpenGL (+Y) convention.
      const ny = (dv / slopeWeight) * STONE_DATA_RECIPE.maximumNormalSlope
      const inverseLength = 1 / Math.hypot(nx, ny, 1)
      const offset = (y * size + x) * 3
      roughness.fill(value, offset, offset + 3)
      normal[offset] = Math.round((nx * inverseLength * 0.5 + 0.5) * 255)
      normal[offset + 1] = Math.round((ny * inverseLength * 0.5 + 0.5) * 255)
      normal[offset + 2] = Math.round((inverseLength * 0.5 + 0.5) * 255)
    }
  }
  return { normal, roughness, size }
}

export async function encodeDataPng(data, size) {
  // Sharp strips metadata by default. Tests additionally reject color-transfer chunks.
  return sharp(data, { raw: { width: size, height: size, channels: 3 } })
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
    .toBuffer()
}

export function pngChunkNames(bytes) {
  if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    throw new Error('Not a PNG')
  const names = []
  for (let offset = 8; offset < bytes.length;) {
    const length = bytes.readUInt32BE(offset)
    if (offset + length + 12 > bytes.length) throw new Error('Truncated PNG chunk')
    names.push(bytes.toString('ascii', offset + 4, offset + 8))
    offset += length + 12
  }
  return names
}

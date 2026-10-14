import { DataUtils } from 'three'

/** Compact actual WebGPU padded RGBA16F rows; no image reconstruction. */
export function decodeHalfFloatSignal(signal) {
  const { width, height, bytesPerRow } = signal,
    bytes = Buffer.from(signal.base64, 'base64')
  if (signal.type !== 'Uint16Array' || bytes.length !== (height - 1) * bytesPerRow + width * 8)
    throw new Error(`Unexpected native RGBA16F layout: ${signal.name}`)
  const rgba = new Float32Array(width * height * 4)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      for (let channel = 0; channel < 4; channel++)
        rgba[(y * width + x) * 4 + channel] = DataUtils.fromHalfFloat(
          bytes.readUInt16LE(y * bytesPerRow + x * 8 + channel * 2),
        )
  return { bytes, rgba }
}

export function decodeSignal(signal) {
  if (signal.type === 'Uint16Array') return decodeHalfFloatSignal(signal)
  const { width, height, bytesPerRow } = signal,
    bytes = Buffer.from(signal.base64, 'base64')
  if (signal.type !== 'Uint8Array' || bytes.length !== (height - 1) * bytesPerRow + width * 4)
    throw new Error(`Unexpected native RGBA8 layout: ${signal.name}`)
  const rgba = new Float32Array(width * height * 4)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      for (let channel = 0; channel < 4; channel++)
        rgba[(y * width + x) * 4 + channel] = bytes[y * bytesPerRow + x * 4 + channel] / 255
  return { bytes, rgba }
}

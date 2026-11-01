/** Three r185 WebGPU readbacks retain 256-byte row padding, except the last row.
 * Pure helper shared with disposable browser instrumentation; no Three imports. */
export function unpackRgbaReadback(values, width, height) {
  const bytes = values.BYTES_PER_ELEMENT
  if (![1, 2, 4].includes(bytes) || width < 1 || height < 1)
    throw new Error('Unsupported RGBA readback shape')
  const stride = (Math.ceil((width * 4 * bytes) / 256) * 256) / bytes
  if (values.length !== (height - 1) * stride + width * 4)
    throw new Error('Unexpected WebGPU readback row layout')
  const result = new values.constructor(width * height * 4)
  for (let row = 0; row < height; row++)
    result.set(values.subarray(row * stride, row * stride + width * 4), row * width * 4)
  return result
}

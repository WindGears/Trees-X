import { readGlb } from '../asset-package.mjs'

const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }
const constructors = { 5126: Float32Array, 5123: Uint16Array, 5125: Uint32Array }

export function openGlb(bytes) {
  const json = readGlb(bytes)
  const offset = 20 + bytes.readUInt32LE(12)
  const binary = bytes.subarray(offset + 8, offset + 8 + bytes.readUInt32LE(offset))
  return { json, binary }
}

export function readAccessor(doc, index) {
  const accessor = doc.json.accessors[index]
  const view = doc.json.bufferViews[accessor.bufferView]
  const Type = constructors[accessor.componentType]
  if (!Type || accessor.sparse || accessor.normalized)
    throw new Error('Unsupported source accessor layout; do not silently convert it')
  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0)
  const size = components[accessor.type]
  const stride = view.byteStride ?? size * Type.BYTES_PER_ELEMENT
  if (stride !== size * Type.BYTES_PER_ELEMENT) {
    const result = new Type(accessor.count * size)
    const data = new DataView(doc.binary.buffer, doc.binary.byteOffset, doc.binary.byteLength)
    const method =
      accessor.componentType === 5126
        ? 'getFloat32'
        : accessor.componentType === 5123
          ? 'getUint16'
          : 'getUint32'
    for (let i = 0; i < accessor.count; i++)
      for (let c = 0; c < size; c++)
        result[i * size + c] = data[method](start + i * stride + c * Type.BYTES_PER_ELEMENT, true)
    return result
  }
  const buffer = doc.binary.subarray(start, start + accessor.count * size * Type.BYTES_PER_ELEMENT)
  return new Type(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength))
}

export function appendWriter(doc) {
  const chunks = [doc.binary]
  let length = doc.binary.length
  function blob(raw) {
    const padding = (4 - (length % 4)) % 4
    if (padding) {
      chunks.push(Buffer.alloc(padding))
      length += padding
    }
    const index = doc.json.bufferViews.length
    doc.json.bufferViews.push({ buffer: 0, byteOffset: length, byteLength: raw.length })
    chunks.push(raw)
    length += raw.length
    return index
  }
  function accessor(array, type, target = 34962) {
    const padding = (4 - (length % 4)) % 4
    if (padding) {
      chunks.push(Buffer.alloc(padding))
      length += padding
    }
    const raw = Buffer.from(array.buffer, array.byteOffset, array.byteLength)
    const bufferView = doc.json.bufferViews.length
    doc.json.bufferViews.push({ buffer: 0, byteOffset: length, byteLength: raw.length, target })
    chunks.push(raw)
    length += raw.length
    const entry = {
      bufferView,
      componentType:
        array instanceof Float32Array ? 5126 : array instanceof Uint16Array ? 5123 : 5125,
      count: array.length / components[type],
      type,
    }
    if (type === 'VEC3') {
      entry.min = [Infinity, Infinity, Infinity]
      entry.max = [-Infinity, -Infinity, -Infinity]
      for (let i = 0; i < array.length; i++) {
        entry.min[i % 3] = Math.min(entry.min[i % 3], array[i])
        entry.max[i % 3] = Math.max(entry.max[i % 3], array[i])
      }
    }
    doc.json.accessors.push(entry)
    return doc.json.accessors.length - 1
  }
  function finish() {
    doc.json.buffers[0].byteLength = length
    const raw = Buffer.from(JSON.stringify(doc.json))
    const json = Buffer.concat([raw, Buffer.alloc((4 - (raw.length % 4)) % 4, 32)])
    const binary = Buffer.concat([...chunks, Buffer.alloc((4 - (length % 4)) % 4)])
    const header = Buffer.alloc(20),
      binHeader = Buffer.alloc(8)
    header.writeUInt32LE(0x46546c67, 0)
    header.writeUInt32LE(2, 4)
    header.writeUInt32LE(28 + json.length + binary.length, 8)
    header.writeUInt32LE(json.length, 12)
    header.writeUInt32LE(0x4e4f534a, 16)
    binHeader.writeUInt32LE(binary.length, 0)
    binHeader.writeUInt32LE(0x004e4942, 4)
    return Buffer.concat([header, json, binHeader, binary])
  }
  return { accessor, blob, finish }
}

export function remapArray(array, size, remap) {
  const result = new array.constructor(remap.length * size)
  for (let i = 0; i < remap.length; i++)
    for (let c = 0; c < size; c++) result[i * size + c] = array[remap[i] * size + c]
  return result
}

export function metricScale(positions, uv, indices, tile, sceneScale) {
  let area = 0,
    uvArea = 0
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i],
      b = indices[i + 1],
      c = indices[i + 2]
    const x = positions[b * 3] - positions[a * 3],
      y = positions[b * 3 + 1] - positions[a * 3 + 1],
      z = positions[b * 3 + 2] - positions[a * 3 + 2]
    const u = positions[c * 3] - positions[a * 3],
      v = positions[c * 3 + 1] - positions[a * 3 + 1],
      w = positions[c * 3 + 2] - positions[a * 3 + 2]
    area += Math.hypot(y * w - z * v, z * u - x * w, x * v - y * u) / 2
    uvArea +=
      Math.abs(
        (uv[b * 2] - uv[a * 2]) * (uv[c * 2 + 1] - uv[a * 2 + 1]) -
          (uv[c * 2] - uv[a * 2]) * (uv[b * 2 + 1] - uv[a * 2 + 1]),
      ) / 2
  }
  if (!(area > 0 && uvArea > 0)) throw new Error('Cannot calibrate zero-area UV surface')
  return (Math.sqrt(area / uvArea) * sceneScale) / tile
}

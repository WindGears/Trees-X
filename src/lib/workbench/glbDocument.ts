import { list, object, relativePath } from './validation'
import type { AssetBundle } from './assetBundle'

export function checkGlbDocument(data: ArrayBuffer, bundle: AssetBundle) {
  const header = new DataView(data)
  if (
    data.byteLength < 20 ||
    header.getUint32(0, true) !== 0x46546c67 ||
    header.getUint32(4, true) !== 2 ||
    header.getUint32(8, true) !== data.byteLength ||
    header.getUint32(16, true) !== 0x4e4f534a ||
    header.getUint32(12, true) + 20 > data.byteLength
  )
    throw new Error('模型文件不是有效的 GLB 2.0')
  const json = object(
    JSON.parse(
      new TextDecoder().decode(new Uint8Array(data, 20, header.getUint32(12, true))),
    ) as unknown,
  )
  for (const field of ['buffers', 'images'] as const) {
    for (const item of list(json[field] ?? [], object)) {
      if (item.uri == null) continue
      const path = relativePath(item.uri)
      if (!bundle.files.some((f) => f.path === path))
        throw new Error('模型引用了未登记的资源：' + path)
    }
  }
  return json
}

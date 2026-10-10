import { readFile, writeFile, mkdir, access, copyFile } from 'node:fs/promises'
import { dirname, resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
import { format, resolveConfig } from 'prettier'

export const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
export const jsonText = async (value) =>
  format(JSON.stringify(value), {
    ...(await resolveConfig(resolve('public/models/bundles/manifest.json'))),
    parser: 'json',
  })
export function readGlb(bytes) {
  if (
    bytes.length < 20 ||
    bytes.readUInt32LE(0) !== 0x46546c67 ||
    bytes.readUInt32LE(8) !== bytes.length
  )
    throw new Error('Invalid GLB')
  return JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString())
}
export function glbWithJson(original, json) {
  const raw = Buffer.from(JSON.stringify(json)),
    padding = (4 - (raw.length % 4)) % 4
  const chunk = Buffer.concat([raw, Buffer.alloc(padding, 32)])
  const tail = original.subarray(20 + original.readUInt32LE(12))
  const header = Buffer.alloc(20)
  header.writeUInt32LE(0x46546c67, 0)
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(20 + chunk.length + tail.length, 8)
  header.writeUInt32LE(chunk.length, 12)
  header.writeUInt32LE(0x4e4f534a, 16)
  return Buffer.concat([header, chunk, tail])
}
export function relativeResource(path) {
  if (
    typeof path !== 'string' ||
    !/^[a-zA-Z0-9_.\-/]+$/.test(path) ||
    path.split('/').some((p) => !p || p === '.' || p === '..')
  )
    throw new Error('Only package-relative resources are accepted')
  return path
}
/** Lossless organization only: binary geometry, names, pivots, and texture bytes stay intact. */
export async function packageAsset(input, output, options) {
  const source = resolve(input),
    destination = resolve(output)
  try {
    await access(destination)
    throw new Error('Output must be a new version directory')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  for (const key of ['author', 'source', 'license', 'redistribution'])
    if (!options.provenance?.[key]) throw new Error('Provenance is required: ' + key)
  const original = await readFile(source),
    doc = readGlb(original),
    files = [],
    content = new Map()
  const channels = []
  for (const field of ['buffers', 'images']) {
    for (const item of doc[field] ?? []) {
      if (!item.uri) continue
      const uri = relativeResource(item.uri),
        bytes = await readFile(resolve(dirname(source), uri))
      const hash = digest(bytes),
        existing = content.get(hash)
      if (existing) item.uri = existing.path
      else {
        const entry = {
          path: uri,
          bytes: bytes.length,
          sha256: hash,
          role: field === 'images' ? 'texture' : 'model',
        }
        content.set(hash, { ...entry, sourcePath: resolve(dirname(source), uri) })
        files.push(entry)
      }
    }
  }
  for (const material of doc.materials ?? []) {
    for (const [slot, info] of Object.entries({ ...material, ...material.pbrMetallicRoughness })) {
      if (!info || typeof info !== 'object' || !('index' in info)) continue
      const texture = doc.textures?.[info.index],
        image = doc.images?.[texture?.source ?? texture?.extensions?.KHR_texture_basisu?.source]
      channels.push({
        material: material.name,
        slot,
        image: image?.uri ?? 'embedded',
        colorSpace: /baseColor|emissive/.test(slot) ? 'sRGB' : 'linear',
        channels:
          slot === 'occlusionTexture'
            ? 'R'
            : slot === 'metallicRoughnessTexture'
              ? 'G=roughness,B=metalness'
              : 'RGB(A)',
      })
    }
  }
  const model = glbWithJson(original, doc)
  files.unshift({ path: 'model.glb', bytes: model.length, sha256: digest(model), role: 'model' })
  for (const extra of options.extras ?? []) {
    const path = relativeResource(extra.path),
      data = await readFile(extra.source)
    if (files.some((f) => f.path === path)) throw new Error('Duplicate extra resource')
    const file = { path, bytes: data.length, sha256: digest(data), role: extra.role }
    content.set(digest(data) + path, { ...file, sourcePath: resolve(extra.source) })
    files.push(file)
  }
  const total = files.reduce((sum, f) => sum + f.bytes, 0)
  const manifest = {
    schemaVersion: 1,
    id: options.id,
    version: options.version,
    entry: 'model.glb',
    files,
    budget: { maxBytes: total, maxTriangles: options.maxTriangles },
    provenance: options.provenance,
  }
  if (
    !manifest.id ||
    !Number.isSafeInteger(manifest.version) ||
    manifest.version <= 0 ||
    !Number.isSafeInteger(options.maxTriangles) ||
    options.maxTriangles <= 0
  )
    throw new Error('Explicit bundle identity, version, and triangle budget are required')
  await mkdir(destination, { recursive: true })
  for (const file of content.values()) {
    const target = join(destination, file.path)
    await mkdir(dirname(target), { recursive: true })
    await copyFile(file.sourcePath, target)
  }
  await writeFile(join(destination, 'model.glb'), model)
  const text = await jsonText(manifest)
  await writeFile(join(destination, 'manifest.json'), text)
  await writeFile(
    join(destination, 'production-record.json'),
    await jsonText({
      source,
      sourceSha256: digest(original),
      runtimeEntrySha256: digest(model),
      channels,
      method: 'byte-preserving dependency deduplication; geometry and image bytes unchanged',
      qualityApproved: false,
    }),
  )
  return { manifest, manifestSha256: digest(text) }
}
if (process.argv[1] && resolve(process.argv[1]) === resolve('scripts/asset-package.mjs')) {
  const [, , input, output, settings] = process.argv
  if (!input || !output || !settings)
    throw new Error('Usage: npm run asset:package -- input.glb NEW-output-directory settings.json')
  const result = await packageAsset(input, output, JSON.parse(await readFile(settings, 'utf8')))
  console.log(
    JSON.stringify(
      {
        id: result.manifest.id,
        files: result.manifest.files.length,
        bytes: result.manifest.budget.maxBytes,
        sha256: result.manifestSha256,
      },
      null,
      2,
    ),
  )
}

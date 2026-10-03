import { readFile, writeFile } from 'node:fs/promises'
import { digest, readGlb, jsonText } from './asset-package.mjs'

const original = await readFile('public/models/reventon/reventon.glb')
const runtime = await readFile('artifacts/asset-pipeline/reventon-organized-v1/model.glb')
const a = readGlb(original),
  b = readGlb(runtime)
const originalBinary = original.subarray(20 + original.readUInt32LE(12))
const runtimeBinary = runtime.subarray(20 + runtime.readUInt32LE(12))
if (!originalBinary.equals(runtimeBinary)) throw new Error('Geometry binary changed')
for (const field of ['nodes', 'meshes', 'accessors', 'bufferViews', 'materials'])
  if (JSON.stringify(a[field]) !== JSON.stringify(b[field])) throw new Error(field + ' changed')
const manifest = JSON.parse(
  await readFile('artifacts/asset-pipeline/reventon-organized-v1/manifest.json', 'utf8'),
)
let compared = 0
for (const file of manifest.files) {
  if (file.role === 'model') continue
  const source = await readFile('public/models/reventon/' + file.path)
  if (digest(source) !== file.sha256) throw new Error('Original resource differs: ' + file.path)
  compared++
}
const report = {
  geometryBinaryIdentical: true,
  nodesMaterialsUvsIdentical: true,
  unchangedResources: compared,
  originalGlbSha256: digest(original),
  organizedGlbSha256: digest(runtime),
  scope: 'No pixel processing or geometry changes; excludes separate unapproved KTX experiment',
  passed: true,
}
await writeFile('.impeccable/review/asset-ingestion/preservation.json', await jsonText(report))
console.log(JSON.stringify(report))

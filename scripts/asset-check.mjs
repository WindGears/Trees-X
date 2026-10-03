import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { validateBytes } from 'gltf-validator'
import { digest, readGlb, relativeResource, jsonText } from './asset-package.mjs'

const path = process.argv[2]
if (!path) throw new Error('Usage: npm run asset:check -- path/to/manifest.json')
const manifest = JSON.parse(await readFile(path, 'utf8')),
  directory = dirname(resolve(path))
const resources = new Map()
for (const file of manifest.files) {
  const bytes = await readFile(resolve(directory, relativeResource(file.path)))
  if (bytes.length !== file.bytes || digest(bytes) !== file.sha256)
    throw new Error('Checksum failed: ' + file.path)
  resources.set(file.path, resolve(directory, file.path))
}
if (resources.size !== manifest.files.length) throw new Error('Duplicate resource paths')
const bytes = await readFile(resources.get(manifest.entry)),
  document = readGlb(bytes)
const validation = await validateBytes(new Uint8Array(bytes), {
  uri: manifest.entry,
  maxIssues: 100,
  externalResourceFunction: async (uri) => {
    const buffer = resources.get(relativeResource(uri))
    if (!buffer) throw new Error('Unregistered resource: ' + uri)
    return new Uint8Array(await readFile(buffer))
  },
})
let triangles = 0
for (const node of document.nodes ?? [])
  for (const primitive of document.meshes?.[node.mesh]?.primitives ?? [])
    if ((primitive.mode ?? 4) === 4)
      triangles += document.accessors[primitive.indices ?? primitive.attributes.POSITION].count / 3
const report = {
  id: manifest.id,
  version: manifest.version,
  files: resources.size,
  bytes: manifest.files.reduce((sum, f) => sum + f.bytes, 0),
  triangles,
  nodes: document.nodes?.map((n) => n.name).filter(Boolean),
  materials: document.materials?.map((m) => m.name),
  errors: validation.issues.numErrors,
  warnings: validation.issues.numWarnings,
  issues: validation.issues.messages,
}
await writeFile(resolve(directory, 'validation.json'), await jsonText(report))
if (
  report.errors ||
  report.bytes > manifest.budget.maxBytes ||
  triangles > manifest.budget.maxTriangles
)
  throw new Error('Asset validation failed; see validation.json')
console.log(
  JSON.stringify({
    id: report.id,
    bytes: report.bytes,
    triangles,
    errors: report.errors,
    warnings: report.warnings,
  }),
)

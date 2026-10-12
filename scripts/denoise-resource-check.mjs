/* global URL */
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { parseTZA } from '../node_modules/oidn-web/lib/tza.js'
import { validateUNetModel } from '../node_modules/oidn-web/lib/modelSpec.js'

const root = new URL('../public/models/denoise/', import.meta.url)
const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'))
const runtime = JSON.parse(
  await readFile(new URL('../node_modules/oidn-web/package.json', import.meta.url), 'utf8'),
)
if (runtime.version !== manifest.runtime.version) throw new Error('OIDN runtime version mismatch')
let weights
for (const file of manifest.files) {
  if (!/^[a-zA-Z0-9_.-]+$/.test(file.path)) throw new Error('Invalid resource path')
  const bytes = await readFile(new URL(file.path, root))
  const digest = createHash('sha256').update(bytes).digest('hex')
  if (bytes.subarray(0, 100).toString().startsWith('version https://git-lfs')) {
    throw new Error(`${file.path}: unresolved Git LFS pointer`)
  }
  if (bytes.length !== file.bytes || digest !== file.sha256)
    throw new Error(`${file.path}: resource digest mismatch`)
  if (file.path === manifest.entry) weights = bytes
}
if (!weights) throw new Error('Missing guided HDR model')
const tensors = parseTZA(
  weights.buffer.slice(weights.byteOffset, weights.byteOffset + weights.byteLength),
)
const model = validateUNetModel(tensors)
if (
  tensors.size !== manifest.model.tensors ||
  model.spec.id !== manifest.model.topology ||
  model.inputChannels !== 9 ||
  model.outputChannels !== 3 ||
  model.tensorDataType !== 'Float16'
) {
  throw new Error('Guided OIDN model topology mismatch')
}
console.log(
  JSON.stringify(
    {
      passed: true,
      manifest: fileURLToPath(new URL('manifest.json', root)),
      bytes: weights.length,
      sha256: manifest.files.find((file) => file.path === manifest.entry).sha256,
      runtime: runtime.version,
      model: model.spec.id,
      tensors: tensors.size,
      inputChannels: model.inputChannels,
    },
    null,
    2,
  ),
)

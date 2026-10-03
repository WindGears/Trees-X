import { readFile, writeFile, access } from 'node:fs/promises'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import sharp from 'sharp'
import { availableParallelism } from 'node:os'
import { digest, jsonText } from './asset-package.mjs'

const [, , input, output, semantic] = process.argv
if (!input || !output || !['color', 'normal', 'data'].includes(semantic))
  throw new Error('Usage: npm run asset:texture -- input.png NEW-output.ktx2 color|normal|data')
if (resolve(input) === resolve(output)) throw new Error('Never overwrite a master texture')
try {
  await access(output)
  throw new Error('Choose a new output version')
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}
const tool = process.env.TREES_KTX || resolve('.tools/ktx-4.4.2/unpacked/bin/ktx.exe')
await access(tool)
const bytes = await readFile(input),
  meta = await sharp(bytes).metadata()
const srgb = semantic === 'color'
const threads = Math.min(8, availableParallelism())
const args = [
  'create',
  '--format',
  srgb ? 'R8G8B8A8_SRGB' : 'R8G8B8A8_UNORM',
  '--assign-tf',
  srgb ? 'srgb' : 'linear',
  '--assign-primaries',
  srgb ? 'bt709' : 'none',
  '--assign-texcoord-origin',
  'top-left',
  '--encode',
  'uastc',
  '--uastc-quality',
  '4',
  '--threads',
  String(threads),
  '--generate-mipmap',
  '--zstd',
  '18',
  resolve(input),
  resolve(output),
]
const run = spawnSync(tool, args, { encoding: 'utf8', windowsHide: true })
if (run.status !== 0) throw new Error(run.stderr || run.error?.message || 'KTX conversion failed')
const check = spawnSync(tool, ['validate', '--gltf-basisu', resolve(output)], {
  encoding: 'utf8',
  windowsHide: true,
})
if (check.status !== 0) throw new Error(check.stderr || 'KTX validation failed')
const packed = await readFile(output)
const report = {
  tool: 'KTX-Software 4.4.2',
  input: resolve(input),
  output: resolve(output),
  semantic,
  width: meta.width,
  height: meta.height,
  sourceDepth: meta.depth,
  inputBytes: bytes.length,
  outputBytes: packed.length,
  inputSha256: digest(bytes),
  outputSha256: digest(packed),
  method: 'UASTC quality 4; no resizing; mipmaps; no RDO',
  threads,
  qualityApproved: false,
  note: 'GPU block compression is not lossless. Browser material comparison is required before adoption.',
}
await writeFile(output + '.json', await jsonText(report))
console.log(JSON.stringify(report, null, 2))

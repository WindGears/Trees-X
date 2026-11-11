import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { clearTimeout, setTimeout } from 'node:timers'
import { TextDecoder } from 'node:util'
import { runInNewContext } from 'node:vm'
import * as zlib from 'node:zlib'
import { REVISION } from 'three'
import {
  KHR_DF_TRANSFER_LINEAR,
  KHR_DF_TRANSFER_SRGB,
  KHR_SUPERCOMPRESSION_ZSTD,
  VK_FORMAT_BC7_SRGB_BLOCK,
  VK_FORMAT_BC7_UNORM_BLOCK,
  read,
  write,
} from 'three/addons/libs/ktx-parse.module.js'

const directory = 'public/models/reventon-runtime-v2'
const registration = 'src/lib/workbench/reventonNativeTextureCache.json'
const digest = (data) => createHash('sha256').update(data).digest('hex')

async function publish(path, bytes) {
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, bytes, { flag: 'wx' })
    await rename(temporary, path)
  } finally {
    await unlink(temporary).catch((error) => {
      if (error.code !== 'ENOENT') throw error
    })
  }
}

function convert(bytes, basis) {
  const source = read(bytes),
    dfd = source.dataFormatDescriptor[0]
  assert.equal(source.vkFormat, 0)
  assert.equal(source.faceCount, 1)
  assert.equal(source.layerCount, 0)
  assert.equal(source.pixelDepth, 0)
  assert.equal(source.keyValue.KTXorientation, 'rd')
  assert.equal(dfd.flags, 0)
  assert.ok([KHR_DF_TRANSFER_LINEAR, KHR_DF_TRANSFER_SRGB].includes(dfd.transferFunction))
  assert.equal(
    source.levels.length,
    1 + Math.floor(Math.log2(Math.max(source.pixelWidth, source.pixelHeight))),
  )
  const input = new basis.KTX2File(new Uint8Array(bytes))
  try {
    assert.ok(input.isValid() && input.isUASTC() && input.startTranscoding())
    assert.equal(input.getWidth(), source.pixelWidth)
    assert.equal(input.getHeight(), source.pixelHeight)
    assert.equal(input.getLevels(), source.levels.length)
    // Three r185 selects Basis format 7 (BC7) for both UASTC RGB and alpha.
    const format = 7
    const blocks = source.levels.map((_, index) => {
      const width = Math.max(1, source.pixelWidth >> index)
      const height = Math.max(1, source.pixelHeight >> index)
      const size = input.getImageTranscodedSizeInBytes(index, 0, 0, format)
      assert.equal(size, Math.ceil(width / 4) * Math.ceil(height / 4) * 16)
      const data = new Uint8Array(size)
      assert.ok(input.transcodeImage(data, index, 0, 0, format, 0, -1, -1))
      return data
    })
    const vkFormat =
      dfd.transferFunction === KHR_DF_TRANSFER_SRGB
        ? VK_FORMAT_BC7_SRGB_BLOCK
        : VK_FORMAT_BC7_UNORM_BLOCK
    const encoded = write({
      ...source,
      vkFormat,
      supercompressionScheme: KHR_SUPERCOMPRESSION_ZSTD,
      levels: blocks.map((data) => ({
        levelData: zlib.zstdCompressSync(data, {
          params: { [zlib.constants.ZSTD_c_compressionLevel]: 1 },
        }),
        uncompressedByteLength: data.byteLength,
      })),
      dataFormatDescriptor: [
        { ...dfd, colorModel: 134, samples: [{ ...dfd.samples[0], channelType: 0 }] },
      ],
      keyValue: { KTXorientation: 'rd' },
      globalData: null,
    })
    const output = read(encoded)
    assert.equal(output.vkFormat, vkFormat)
    assert.equal(output.pixelWidth, source.pixelWidth)
    assert.equal(output.pixelHeight, source.pixelHeight)
    assert.equal(output.dataFormatDescriptor[0].transferFunction, dfd.transferFunction)
    assert.equal(output.dataFormatDescriptor[0].colorPrimaries, dfd.colorPrimaries)
    assert.equal(output.levels.length, blocks.length)
    for (const [index, level] of output.levels.entries()) {
      assert.equal(level.uncompressedByteLength, blocks[index].byteLength)
      assert.equal(Buffer.compare(zlib.zstdDecompressSync(level.levelData), blocks[index]), 0)
    }
    return encoded
  } finally {
    input.close()
    input.delete()
  }
}

async function prepare() {
  assert.equal(REVISION, '185', 'Review the Basis transcode selection after a Three upgrade')
  assert.equal(
    typeof zlib.zstdCompressSync,
    'function',
    'This preparation tool needs Node 22.15+ with zstd',
  )
  const [reference, manifest, wrapper, wasm] = await Promise.all([
    readFile('src/lib/workbench/reventonRuntimeBundle.json', 'utf8').then(JSON.parse),
    readFile(join(directory, 'workbench-manifest.json')),
    readFile('public/basis/basis_transcoder.js', 'utf8'),
    readFile('public/basis/basis_transcoder.wasm'),
  ])
  assert.equal(reference.manifest, '/models/reventon-runtime-v2/workbench-manifest.json')
  assert.equal(reference.id, 'reventon-workbench')
  assert.equal(reference.version, 2)
  assert.equal(reference.sha256, digest(manifest))
  const bundle = JSON.parse(manifest)
  assert.equal(bundle.id, reference.id)
  assert.equal(bundle.version, reference.version)
  const createBasis = runInNewContext(`${wrapper}\nBASIS`, {
    WebAssembly: globalThis.WebAssembly,
    TextDecoder,
    Uint8Array,
    performance,
    setTimeout,
    clearTimeout,
  })
  const basis = await createBasis({ wasmBinary: new Uint8Array(wasm) })
  basis.initializeBasis()
  const target = join(directory, 'native-bc7', reference.sha256)
  await mkdir(target, { recursive: true })
  const files = Object.create(null)
  for (const file of bundle.files) {
    if (file.role !== 'texture' || !file.path.endsWith('.ktx2')) continue
    assert.match(file.path, /^texture-\d+-(linear|srgb)\.ktx2$/)
    const bytes = await readFile(join(directory, file.path))
    assert.equal(bytes.byteLength, file.bytes)
    assert.equal(digest(bytes), file.sha256)
    const result = convert(bytes, basis)
    await publish(join(target, file.path), result)
    files[file.path] = {
      bytes: result.byteLength,
      sha256: digest(result),
      sourceSha256: file.sha256,
    }
  }
  assert.ok(Object.keys(files).length)
  await publish(
    registration,
    `${JSON.stringify({ version: 1, bundleSha256: reference.sha256, basisWasmSha256: digest(wasm), files }, null, 2)}\n`,
  )
  console.log(
    JSON.stringify({
      files: Object.keys(files).length,
      bytes: Object.values(files).reduce((total, file) => total + file.bytes, 0),
    }),
  )
}

await prepare().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

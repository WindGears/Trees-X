/* global structuredClone */
import assert from 'node:assert/strict'
import test from 'node:test'
import { digest } from '../asset-package.mjs'
import { deriveRuntimeDocument } from './build-runtime-model.mjs'
import { createTraceTextureRecord, traceTexturePath } from './runtime-trace-model.mjs'
import {
  reviewedSourceIdentity,
  verifyRuntimeMetadata,
  verifyRuntimePolicy,
  verifySourceIdentity,
  verifySourcePng,
  verifyTextureCommand,
  verifyTextureHeader,
} from './build-runtime-verify.mjs'

function policy(threads = 16) {
  return {
    encoding: 'UASTC',
    quality: 4,
    rdo: false,
    maxDimension: 4096,
    fullMipChain: true,
    zstd: 18,
    sequentialFiles: true,
    threads,
    rgbNormalPackingUnchanged: true,
    mipmapFilter: 'lanczos4',
    mipmapWrap: 'clamp',
    traceTextureSize: 256,
  }
}

function png() {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aFioAAAAASUVORK5CYII=',
    'base64',
  )
}

function sourceFile(bytes) {
  return { path: 'color.png', role: 'texture', bytes: bytes.length, sha256: digest(bytes) }
}

function commandFixture(changes = {}) {
  const expected = {
    transfer: 'linear',
    source: 'normal.png',
    sourceWidth: 4096,
    sourceHeight: 4096,
    width: 4096,
    height: 4096,
    commandOutput: 'public/models/reventon-runtime-v2/texture-000-linear.ktx2.partial.ktx2',
    ...changes,
  }
  const command = {
    executable: '.tools/ktx-4.4.2/unpacked/bin/ktx.exe',
    args: [
      'create',
      '--format',
      expected.transfer === 'srgb' ? 'R8G8B8A8_SRGB' : 'R8G8B8A8_UNORM',
      '--assign-tf',
      expected.transfer,
      '--assign-primaries',
      expected.transfer === 'srgb' ? 'bt709' : 'none',
      '--assign-texcoord-origin',
      'top-left',
      '--encode',
      'uastc',
      '--uastc-quality',
      '4',
      '--threads',
      '16',
      '--generate-mipmap',
      '--mipmap-filter',
      'lanczos4',
      '--mipmap-wrap',
      'clamp',
      '--zstd',
      '18',
      '--warn-on-color-conversions',
    ],
  }
  if (expected.width !== expected.sourceWidth || expected.height !== expected.sourceHeight)
    command.args.push('--width', String(expected.width), '--height', String(expected.height))
  command.args.push(
    'I:\\fixture\\public\\models\\reventon\\' + expected.source,
    'I:/fixture/' + expected.commandOutput,
  )
  return { command, expected }
}

function metadataFixture() {
  const derived = deriveRuntimeDocument({
    asset: { version: '2.0' },
    materials: [
      {
        name: 'Body',
        pbrMetallicRoughness: {
          baseColorTexture: { index: 0 },
          metallicRoughnessTexture: { index: 1 },
        },
        normalTexture: { index: 1, texCoord: 1 },
      },
    ],
    textures: [{ source: 0 }, { source: 1 }],
    images: [{ uri: 'color.png' }, { uri: 'normal.png' }],
  })
  const sourceManifest = {
    schemaVersion: 1,
    id: 'reventon-workbench',
    version: 1,
    entry: 'reventon.glb',
    files: [],
    budget: { maxBytes: 1000, maxTriangles: 1 },
    profile: { textures: 2 },
    provenance: { license: 'No redistribution license supplied' },
  }
  const manifest = {
    ...sourceManifest,
    version: 2,
    files: [
      { path: 'reventon.glb', role: 'model' },
      ...derived.tasks.map((task) => ({ path: task.output, role: 'texture' })),
      { path: 'studio.exr', role: 'environment' },
      ...derived.tasks.map((task) => ({ path: traceTexturePath(task.output), role: 'texture' })),
    ].map((file) => ({ ...file, bytes: 10, sha256: '1'.repeat(64) })),
    budget: { ...sourceManifest.budget, maxBytes: 60 },
    profile: { ...sourceManifest.profile, traceTextures: derived.tasks.length },
  }
  const record = {
    schemaVersion: 1,
    sourceModel: 'public/models/reventon/reventon.glb',
    toolSha256: '2'.repeat(64),
    provenance: sourceManifest.provenance,
    repairs: derived.repairs,
    excludedImages: derived.excludedImages,
    bindings: derived.mappings,
    textures: structuredClone(derived.tasks),
    traceFinalized: true,
    traceTextures: derived.tasks.map((task) =>
      createTraceTextureRecord(task, {}, Buffer.from('metadata fixture')),
    ),
  }
  return { manifest, record, derived, sourceManifest }
}

test('anchors both source hashes independently of self-consistent production records', () => {
  verifySourceIdentity(reviewedSourceIdentity, reviewedSourceIdentity)
  for (const key of ['sourceSha256', 'sourceManifestSha256']) {
    const changed = { ...reviewedSourceIdentity, [key]: '0'.repeat(64) }
    assert.throws(() => verifySourceIdentity(changed, changed), /Reviewed original/)
    assert.throws(() => verifySourceIdentity(reviewedSourceIdentity, changed), /Production record/)
  }
  const fixtureIdentity = { sourceSha256: '1'.repeat(64), sourceManifestSha256: '2'.repeat(64) }
  verifySourceIdentity(fixtureIdentity, fixtureIdentity, fixtureIdentity)
  assert.throws(() => verifySourceIdentity(fixtureIdentity, fixtureIdentity))
})

test('locks q4, no RDO, 4K, full mip/filter/wrap/zstd and unchanged RGB normal packing', () => {
  for (const threads of [8, 16]) verifyRuntimePolicy(policy(threads))
  for (const change of [
    { encoding: 'ETC1S' },
    { quality: 3 },
    { rdo: true },
    { maxDimension: 8192 },
    { fullMipChain: false },
    { zstd: 10 },
    { sequentialFiles: false },
    { rgbNormalPackingUnchanged: false },
    { mipmapFilter: 'box' },
    { mipmapWrap: 'wrap' },
    { threads: 2 },
    { threads: '16' },
    { normalMode: true },
    { traceTextureSize: 128 },
  ])
    assert.throws(() => verifyRuntimePolicy({ ...policy(), ...change }))
})

test('verifies source PNG byte/hash identity before deriving dimensions or bit depth', () => {
  const bytes = png(),
    file = sourceFile(bytes)
  assert.deepEqual(verifySourcePng(bytes, file), {
    sourceWidth: 1,
    sourceHeight: 1,
    sourceBitDepth: 8,
    inputBytes: bytes.length,
    inputSha256: digest(bytes),
    width: 1,
    height: 1,
  })
  assert.throws(() => verifySourcePng(Buffer.concat([bytes, Buffer.from('extra')]), file), /bytes/)
  const changed = Buffer.from(bytes)
  changed[changed.length - 1] ^= 1
  assert.throws(() => verifySourcePng(changed, file), /hash/)
  assert.throws(() => verifySourcePng(bytes, { ...file, role: 'environment' }), /texture role/)
  const invalid = Buffer.from(bytes)
  invalid[0] = 0
  assert.throws(() => verifySourcePng(invalid, sourceFile(invalid)), /PNG source/)
  const large = Buffer.from(bytes)
  large.writeUInt32BE(8192, 16)
  large.writeUInt32BE(2048, 20)
  large[24] = 16
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(verifySourcePng(large, sourceFile(large))).filter(([key]) =>
        ['sourceWidth', 'sourceHeight', 'sourceBitDepth', 'width', 'height'].includes(key),
      ),
    ),
    { sourceWidth: 8192, sourceHeight: 2048, sourceBitDepth: 16, width: 4096, height: 1024 },
  )
})

test('checks actual new encoding arguments for both color and linear material roles', () => {
  for (const transfer of ['srgb', 'linear']) {
    const { command, expected } = commandFixture({ transfer })
    verifyTextureCommand(command, expected)
    command.args[command.args.indexOf('--threads') + 1] = '8'
    verifyTextureCommand(command, expected)
  }
  const { command, expected } = commandFixture()
  for (const [flag, value] of [
    ['--encode', 'etc1s'],
    ['--uastc-quality', '3'],
    ['--format', 'R8G8B8A8_SRGB'],
    ['--assign-tf', 'srgb'],
    ['--assign-primaries', 'bt709'],
    ['--assign-texcoord-origin', 'bottom-left'],
    ['--mipmap-filter', 'box'],
    ['--mipmap-wrap', 'wrap'],
    ['--zstd', '10'],
    ['--threads', '2'],
  ]) {
    const bad = structuredClone(command)
    bad.args[bad.args.indexOf(flag) + 1] = value
    assert.throws(() => verifyTextureCommand(bad, expected), flag)
  }
})

test('rejects missing, repeated and unknown options, RDO and normal transformations', () => {
  const { command, expected } = commandFixture()
  for (const extra of [
    ['--normal-mode'],
    ['--normalize'],
    ['--uastc-rdo'],
    ['--uastc-rdo-l', '1'],
    ['--uastc-rdo=1'],
    ['--runtime-mipmap'],
    ['--scale', '0.5'],
    ['--uastc-quality', '1'],
    ['--generate-mipmap'],
  ]) {
    const bad = structuredClone(command)
    bad.args.splice(-2, 0, ...extra)
    assert.throws(() => verifyTextureCommand(bad, expected), extra.join(' '))
  }
  for (const flag of ['--generate-mipmap', '--uastc-quality', '--mipmap-wrap']) {
    const bad = structuredClone(command)
    bad.args.splice(bad.args.indexOf(flag), flag === '--generate-mipmap' ? 1 : 2)
    assert.throws(() => verifyTextureCommand(bad, expected), flag)
  }
  const otherInput = structuredClone(command)
  otherInput.args[otherInput.args.length - 2] = 'public/models/reventon/unrelated.png'
  assert.throws(() => verifyTextureCommand(otherInput, expected), /reviewed source PNG/)
  assert.throws(() => verifyTextureCommand(null, expected), /Recorded encoder command/)
})

test('requires precisely capped resize dimensions and keeps audited reuse thread evidence distinct', () => {
  const resized = commandFixture({ sourceWidth: 8192, sourceHeight: 2048, height: 1024 })
  verifyTextureCommand(resized.command, resized.expected)
  resized.command.args[resized.command.args.indexOf('--width') + 1] = '2048'
  assert.throws(() => verifyTextureCommand(resized.command, resized.expected), /--width/)
  const unchanged = commandFixture()
  unchanged.command.args.splice(-2, 0, '--width', '4096')
  assert.throws(() => verifyTextureCommand(unchanged.command, unchanged.expected), /--width/)
  const reused = commandFixture({
    reused: true,
    commandOutput: 'artifacts/car-runtime-v2/representative-uastc-q4/seat-normal.ktx2',
  })
  reused.command.args[reused.command.args.indexOf('--threads') + 1] = '2'
  verifyTextureCommand(reused.command, reused.expected)
  reused.command.args[reused.command.args.length - 1] = 'I:/fixture/artifacts/wrong.ktx2'
  assert.throws(() => verifyTextureCommand(reused.command, reused.expected), /Encoder output/)
})

test('metadata requires every original role image, including shared data/normal bindings', () => {
  const sample = metadataFixture()
  const { resources, images } = verifyRuntimeMetadata(
    sample.manifest,
    sample.record,
    sample.derived,
    sample.sourceManifest,
  )
  assert.equal(resources.size, 6)
  assert.equal(images.size, 2)
  assert.deepEqual(sample.record.textures[1].semantics, ['data', 'normal'])
})

test('rejects resource omissions and forged roles even when counts and metadata agree', () => {
  for (const change of [
    ({ manifest, record }) => {
      manifest.files[1].path = 'replacement.ktx2'
      manifest.files[1].role = 'environment'
      record.textures[0].output = 'replacement.ktx2'
    },
    ({ manifest }) => {
      manifest.files[1].role = 'model'
    },
    ({ manifest }) => {
      manifest.files[3].path = 'different.exr'
    },
    ({ record }) => {
      record.textures[1] = structuredClone(record.textures[0])
    },
    ({ record }) => {
      record.textures.pop()
    },
  ]) {
    const sample = metadataFixture()
    change(sample)
    assert.throws(() =>
      verifyRuntimeMetadata(sample.manifest, sample.record, sample.derived, sample.sourceManifest),
    )
  }
})

test('rejects fabricated texture source, transfer, semantics, slots and bundle provenance', () => {
  for (const change of [
    ({ record }) => {
      record.textures[0].source = 'other.png'
    },
    ({ record }) => {
      record.textures[0].transfer = 'linear'
    },
    ({ record }) => {
      record.textures[1].semantics = ['data']
    },
    ({ record }) => {
      record.textures[1].slots[0].texCoord = 2
    },
    ({ record }) => {
      record.bindings = []
    },
    ({ manifest, record }) => {
      manifest.provenance = { license: 'Public domain' }
      record.provenance = manifest.provenance
    },
    ({ manifest }) => {
      manifest.profile = { textures: 1 }
    },
  ]) {
    const sample = metadataFixture()
    change(sample)
    assert.throws(() =>
      verifyRuntimeMetadata(sample.manifest, sample.record, sample.derived, sample.sourceManifest),
    )
  }
})

function texture({ width = 4096, height = 4096, levels = 13, transfer = 1, flags = 0 } = {}) {
  const bytes = Buffer.alloc(120)
  Buffer.from('ab4b5458203230bb0d0a1a0a', 'hex').copy(bytes)
  bytes.writeUInt32LE(width, 20)
  bytes.writeUInt32LE(height, 24)
  bytes.writeUInt32LE(levels, 40)
  bytes.writeUInt32LE(80, 48)
  bytes[94] = transfer
  bytes[95] = flags
  return bytes
}

test('checks full 4K mip chain and separate color/linear transfer declarations', () => {
  assert.equal(
    verifyTextureHeader(texture(), { width: 4096, height: 4096, transfer: 'linear' }).levels,
    13,
  )
  assert.equal(
    verifyTextureHeader(texture({ transfer: 2 }), { width: 4096, height: 4096, transfer: 'srgb' })
      .transfer,
    'srgb',
  )
})

test('rejects wrong dimensions, missing mips, transfer confusion and premultiplied alpha', () => {
  const expected = { width: 4096, height: 4096, transfer: 'linear' }
  for (const changes of [{ width: 8192 }, { levels: 1 }, { transfer: 2 }, { flags: 1 }])
    assert.throws(() => verifyTextureHeader(texture(changes), expected))
  const bytes = texture()
  bytes[0] = 0
  assert.throws(() => verifyTextureHeader(bytes, expected), /identifier/)
})

/* global structuredClone */
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import test from 'node:test'
import sharp from 'sharp'
import { digest, readGlb } from '../asset-package.mjs'
import { createRuntimeGlb, deriveRuntimeDocument } from './build-runtime-model.mjs'
import { verifyRuntime, verifySourcePng } from './build-runtime-verify.mjs'
import {
  encodeTracePng,
  finalizeRuntimeTrace,
  prepareTraceTextures,
} from './finalize-runtime-trace.mjs'
import {
  createTraceTextureRecord,
  traceTexturePath,
  verifyTraceTextureHeader,
  withTraceImages,
} from './runtime-trace-model.mjs'

function glb(document) {
  const raw = Buffer.from(JSON.stringify(document)),
    json = Buffer.concat([raw, Buffer.alloc((4 - (raw.length % 4)) % 4, 32)]),
    header = Buffer.alloc(20)
  header.writeUInt32LE(0x46546c67, 0)
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(20 + json.length, 8)
  header.writeUInt32LE(json.length, 12)
  header.writeUInt32LE(0x4e4f534a, 16)
  return Buffer.concat([header, json])
}

function policy() {
  return {
    encoding: 'UASTC',
    quality: 4,
    rdo: false,
    maxDimension: 4096,
    fullMipChain: true,
    zstd: 18,
    sequentialFiles: true,
    threads: 8,
    rgbNormalPackingUnchanged: true,
    mipmapFilter: 'lanczos4',
    mipmapWrap: 'clamp',
  }
}

function ktx() {
  const bytes = Buffer.alloc(120)
  Buffer.from('ab4b5458203230bb0d0a1a0a', 'hex').copy(bytes)
  bytes.writeUInt32LE(1, 20)
  bytes.writeUInt32LE(1, 24)
  bytes.writeUInt32LE(1, 40)
  bytes.writeUInt32LE(80, 48)
  bytes[94] = 2
  return bytes
}

async function pixelPng(pixel = [64, 128, 192, 255]) {
  return sharp(Buffer.from(pixel), { raw: { width: 1, height: 1, channels: 4 } })
    .png()
    .toBuffer()
}

const file = (path, role, bytes) => ({ path, role, bytes: bytes.length, sha256: digest(bytes) })

async function fixture(t, { completed = true } = {}) {
  const root = await mkdtemp(resolve(tmpdir(), 'trees-trace-finalizer-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const sourceDirectory = resolve(root, 'public/models/reventon'),
    outputDirectory = resolve(root, 'public/models/reventon-runtime-v2')
  await mkdir(sourceDirectory, { recursive: true })
  await mkdir(resolve(outputDirectory, 'records'), { recursive: true })
  const source = {
    asset: { version: '2.0' },
    nodes: [{ name: 'unchanged-pivot', translation: [1, 2, 3] }],
    scenes: [{ nodes: [0] }],
    scene: 0,
    materials: [{ name: 'Fixture', pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
    textures: [{ source: 0 }],
    images: [{ uri: 'color.png', extras: { sourceNote: 'preserved' } }],
  }
  const original = glb(source),
    input = await pixelPng(),
    environment = Buffer.from('fixture EXR'),
    motion = Buffer.from('{"schemaVersion":1}'),
    sourceFiles = [
      file('reventon.glb', 'model', original),
      file('color.png', 'texture', input),
      file('studio.exr', 'environment', environment),
    ],
    sourceManifest = {
      schemaVersion: 1,
      id: 'reventon-workbench',
      version: 1,
      entry: 'reventon.glb',
      files: sourceFiles,
      budget: { maxBytes: sourceFiles.reduce((sum, item) => sum + item.bytes, 0) },
      profile: { textures: 1, motionSource: { sha256: digest(motion) } },
      provenance: { license: 'No redistribution license supplied' },
    },
    sourceManifestText = JSON.stringify(sourceManifest),
    sourceIdentity = {
      sourceSha256: digest(original),
      sourceManifestSha256: digest(sourceManifestText),
    },
    identity = { ...sourceIdentity, toolSha256: '1'.repeat(64), policy: policy() },
    derived = deriveRuntimeDocument(source),
    runtime = createRuntimeGlb(original, derived.document),
    task = derived.tasks[0],
    compressed = ktx(),
    image = {
      ...task,
      ...verifySourcePng(input, sourceFiles[1]),
      transfer: task.transfer,
      outputBytes: compressed.length,
      outputSha256: digest(compressed),
      mipLevels: 1,
      reusedFrom: null,
      command: {
        executable: '.tools/ktx-4.4.2/unpacked/bin/ktx.exe',
        args: [
          'create',
          '--format',
          'R8G8B8A8_SRGB',
          '--assign-tf',
          'srgb',
          '--assign-primaries',
          'bt709',
          '--assign-texcoord-origin',
          'top-left',
          '--encode',
          'uastc',
          '--uastc-quality',
          '4',
          '--threads',
          '8',
          '--generate-mipmap',
          '--mipmap-filter',
          'lanczos4',
          '--mipmap-wrap',
          'clamp',
          '--zstd',
          '18',
          '--warn-on-color-conversions',
          resolve(sourceDirectory, 'color.png'),
          resolve(outputDirectory, task.output) + '.partial.ktx2',
        ],
      },
    },
    files = [
      file('reventon.glb', 'model', runtime),
      file(task.output, 'texture', compressed),
      file('studio.exr', 'environment', environment),
    ],
    manifest = {
      ...sourceManifest,
      version: 2,
      files,
      budget: {
        ...sourceManifest.budget,
        maxBytes: files.reduce((sum, item) => sum + item.bytes, 0),
      },
    },
    manifestText = JSON.stringify(manifest),
    bundle = {
      id: manifest.id,
      version: 2,
      manifest: '/models/reventon-runtime-v2/workbench-manifest.json',
      sha256: digest(manifestText),
    },
    record = {
      schemaVersion: 1,
      ...identity,
      bundle,
      provenance: sourceManifest.provenance,
      sourceModel: 'public/models/reventon/reventon.glb',
      runtimeModelSha256: digest(runtime),
      motion: { file: 'motion.json', sha256: digest(motion), requestedAtRuntime: false },
      method: 'Fixture encoded package',
      repairs: derived.repairs,
      excludedImages: derived.excludedImages,
      bindings: derived.mappings,
      textures: [image],
    }
  for (const [path, bytes] of Object.entries({
    'reventon.glb': original,
    'color.png': input,
    'studio.exr': environment,
    'motion.json': motion,
    'workbench-manifest.json': sourceManifestText,
  }))
    await writeFile(resolve(sourceDirectory, path), bytes)
  await writeFile(resolve(outputDirectory, 'build-identity.json'), JSON.stringify(identity))
  if (completed) {
    for (const [path, bytes] of Object.entries({
      'reventon.glb': runtime,
      [task.output]: compressed,
      'studio.exr': environment,
      'motion.json': motion,
      'workbench-manifest.json': manifestText,
      'bundle-reference.json': JSON.stringify(bundle),
      'production-record.json': JSON.stringify(record),
      ['records/' + task.output + '.json']: JSON.stringify(image),
    }))
      await writeFile(resolve(outputDirectory, path), bytes)
  }
  return {
    root,
    sourceDirectory,
    outputDirectory,
    sourceIdentity,
    original,
    input,
    task,
    record,
    sourceManifest,
  }
}

async function metadataBytes(directory) {
  return Object.fromEntries(
    await Promise.all(
      [
        'reventon.glb',
        'workbench-manifest.json',
        'bundle-reference.json',
        'production-record.json',
      ].map(async (path) => [path, await readFile(resolve(directory, path))]),
    ),
  )
}

test('trace extras are image-only metadata and preserve original extras, nodes and visible texture URIs', () => {
  const original = {
      images: [{ uri: 'texture-001-linear.ktx2', extras: { note: 'source' } }],
      nodes: [{ name: 'pivot', translation: [1, 2, 3] }],
      materials: [{ normalTexture: { index: 0 } }],
    },
    before = structuredClone(original),
    tasks = [{ output: original.images[0].uri }]
  const next = withTraceImages(original, tasks)
  assert.deepEqual(original, before)
  assert.deepEqual(next.images[0], {
    ...original.images[0],
    extras: { note: 'source', treesTraceImage: 'trace/texture-001-linear.png' },
  })
  assert.deepEqual(next.nodes, original.nodes)
  assert.deepEqual(next.materials, original.materials)
  assert.throws(() => withTraceImages(next, tasks), /overwrite/)
  for (const path of ['../outside.ktx2', 'nested/texture.ktx2', 'source.png'])
    assert.throws(() => traceTexturePath(path))
})

test('numeric sidecar resampling preserves flat RGB/normal samples, alpha and explicit RGBA8 output', async () => {
  for (const pixel of [
    [64, 128, 192, 255],
    [128, 128, 255, 128],
  ]) {
    const output = await encodeTracePng(await pixelPng(pixel)),
      decoded = await sharp(output).raw().toBuffer({ resolveWithObject: true })
    assert.deepEqual(verifyTraceTextureHeader(output), {
      width: 256,
      height: 256,
      channels: 4,
      bitDepth: 8,
    })
    assert.deepEqual([...decoded.data.subarray(0, 4)], pixel)
    assert.equal(decoded.data.length, 256 ** 2 * 4)
    assert.equal((await sharp(output).metadata()).hasProfile, false)
  }
  const input16 = await sharp(await pixelPng())
    .toColourspace('rgb16')
    .png()
    .toBuffer()
  assert.equal(input16[24], 16)
  const result16 = await sharp(await encodeTracePng(input16))
    .raw()
    .toBuffer()
  assert.deepEqual([...result16.subarray(0, 4)], [64, 128, 192, 255])
})

test('sidecar header rejects wrong dimensions, bit depth, missing alpha and truncated data', async () => {
  const valid = await encodeTracePng(await pixelPng())
  for (const mutate of [
    (bytes) => bytes.writeUInt32BE(255, 16),
    (bytes) => bytes.writeUInt32BE(128, 20),
    (bytes) => {
      bytes[24] = 16
    },
    (bytes) => {
      bytes[25] = 2
    },
  ]) {
    const bytes = Buffer.from(valid)
    mutate(bytes)
    assert.throws(() => verifyTraceTextureHeader(bytes))
  }
  assert.throws(() => verifyTraceTextureHeader(valid.subarray(0, 20)))
})

test('preparation works while encoder is incomplete without publishing model or package metadata', async (t) => {
  const sample = await fixture(t, { completed: false }),
    options = { sourceIdentity: sample.sourceIdentity }
  assert.equal((await prepareTraceTextures(sample.root, options)).status, 'prepared')
  const tracePath = resolve(sample.outputDirectory, traceTexturePath(sample.task.output)),
    previous = await stat(tracePath)
  assert.equal((await prepareTraceTextures(sample.root, options)).textures, 1)
  assert.equal((await stat(tracePath)).mtimeMs, previous.mtimeMs)
  for (const path of [
    'reventon.glb',
    'workbench-manifest.json',
    'production-record.json',
    'bundle-reference.json',
  ])
    await assert.rejects(stat(resolve(sample.outputDirectory, path)), { code: 'ENOENT' })
  await assert.rejects(finalizeRuntimeTrace(sample.root, options), { code: 'ENOENT' })
  assert.deepEqual(await readFile(resolve(sample.sourceDirectory, 'reventon.glb')), sample.original)
  const preparation = JSON.parse(
    await readFile(resolve(sample.outputDirectory, 'trace-preparation.json')),
  )
  assert.equal(preparation.completed, true)
  assert.deepEqual(
    preparation.textures[0],
    createTraceTextureRecord(
      sample.task,
      verifySourcePng(sample.input, sample.sourceManifest.files[1]),
      await readFile(tracePath),
    ),
  )
})

test('finalizes the complete unregistered package and passes normal strict verification', async (t) => {
  const sample = await fixture(t),
    options = { sourceIdentity: sample.sourceIdentity },
    before = await metadataBytes(sample.outputDirectory)
  await assert.rejects(verifyRuntime(sample.root, options))
  const result = await finalizeRuntimeTrace(sample.root, options)
  assert.equal(result.status, 'finalized')
  assert.equal(result.textures, 1)
  const runtime = readGlb(await readFile(resolve(sample.outputDirectory, 'reventon.glb'))),
    record = JSON.parse(await readFile(resolve(sample.outputDirectory, 'production-record.json'))),
    manifest = JSON.parse(
      await readFile(resolve(sample.outputDirectory, 'workbench-manifest.json')),
    ),
    report = await verifyRuntime(sample.root, options)
  assert.equal(runtime.images[0].extras.treesTraceImage, traceTexturePath(sample.task.output))
  assert.deepEqual(runtime.nodes, readGlb(sample.original).nodes)
  assert.equal(record.traceFinalized, true)
  assert.equal(record.policy.traceTextureSize, 256)
  assert.equal(manifest.profile.textures, 1)
  assert.equal(manifest.profile.traceTextures, 1)
  assert.equal(manifest.files.length, 4)
  assert.equal(report.traceTextures.length, 1)
  assert.equal(report.traceFinalized, true)
  assert.equal(report.qualityApproved, false)
  assert.notEqual(result.bundle.sha256, digest(before['workbench-manifest.json']))
  assert.deepEqual(await readFile(resolve(sample.sourceDirectory, 'color.png')), sample.input)
  const finalized = await metadataBytes(sample.outputDirectory)
  const preparationTime = (await stat(resolve(sample.outputDirectory, 'trace-preparation.json')))
    .mtimeMs
  const validationTime = (await stat(resolve(sample.outputDirectory, 'validation.json'))).mtimeMs
  assert.equal((await finalizeRuntimeTrace(sample.root, options)).status, 'unchanged')
  assert.equal((await prepareTraceTextures(sample.root, options)).status, 'unchanged')
  assert.deepEqual(await metadataBytes(sample.outputDirectory), finalized)
  assert.equal(
    (await stat(resolve(sample.outputDirectory, 'trace-preparation.json'))).mtimeMs,
    preparationTime,
  )
  assert.equal(
    (await stat(resolve(sample.outputDirectory, 'validation.json'))).mtimeMs,
    validationTime,
  )
})

test('rejects changed source identity and inconsistent individual encoder records before finalization', async (t) => {
  const sample = await fixture(t),
    options = { sourceIdentity: sample.sourceIdentity },
    before = await metadataBytes(sample.outputDirectory),
    recordPath = resolve(sample.outputDirectory, 'records', sample.task.output + '.json')
  await writeFile(
    resolve(sample.sourceDirectory, 'color.png'),
    Buffer.concat([sample.input, Buffer.from('changed')]),
  )
  await assert.rejects(prepareTraceTextures(sample.root, options), /PNG bytes/)
  await writeFile(resolve(sample.sourceDirectory, 'color.png'), sample.input)
  await writeFile(recordPath, JSON.stringify({ ...sample.record.textures[0], width: 2 }))
  await assert.rejects(finalizeRuntimeTrace(sample.root, options), /original encoder record/)
  assert.deepEqual(await metadataBytes(sample.outputDirectory), before)
})

test('rolls back all package metadata after a late replacement failure and can retry', async (t) => {
  const sample = await fixture(t),
    options = { sourceIdentity: sample.sourceIdentity },
    before = await metadataBytes(sample.outputDirectory)
  await assert.rejects(
    finalizeRuntimeTrace(sample.root, {
      ...options,
      beforeReplace: (_path, index) => {
        if (index === 3) throw new Error('injected replacement failure')
      },
    }),
    /injected replacement failure/,
  )
  assert.deepEqual(await metadataBytes(sample.outputDirectory), before)
  assert.ok(!(await readdir(sample.outputDirectory)).some((path) => path.startsWith('.trace-')))
  assert.equal((await finalizeRuntimeTrace(sample.root, options)).status, 'finalized')
})

test('recovers an interrupted unregistered transaction before validating and finalizing again', async (t) => {
  const sample = await fixture(t),
    previous = await metadataBytes(sample.outputDirectory),
    stageName = '.trace-transaction-00000000-0000-0000-0000-000000000000',
    stage = resolve(sample.outputDirectory, stageName),
    files = []
  await mkdir(resolve(stage, 'previous'), { recursive: true })
  for (const [path, bytes] of Object.entries(previous)) {
    const pending = Buffer.concat([bytes, Buffer.from('interrupted replacement')])
    await writeFile(resolve(stage, 'previous', path), bytes)
    files.push({ path, previousSha256: digest(bytes), nextSha256: digest(pending) })
    if (path === 'reventon.glb') await writeFile(resolve(sample.outputDirectory, path), pending)
  }
  await writeFile(
    resolve(sample.outputDirectory, '.trace-transaction.json'),
    JSON.stringify({ schemaVersion: 1, stage: stageName, files }),
  )
  assert.equal(
    (await finalizeRuntimeTrace(sample.root, { sourceIdentity: sample.sourceIdentity })).status,
    'finalized',
  )
  assert.ok(!(await readdir(sample.outputDirectory)).some((path) => path.startsWith('.trace-')))
  assert.deepEqual(
    readGlb(await readFile(resolve(sample.outputDirectory, 'reventon.glb'))).nodes,
    readGlb(sample.original).nodes,
  )
})

test('transaction recovery preserves unrelated user edits instead of overwriting them', async (t) => {
  const sample = await fixture(t),
    previous = await metadataBytes(sample.outputDirectory),
    stageName = '.trace-transaction-00000000-0000-0000-0000-000000000000',
    stage = resolve(sample.outputDirectory, stageName),
    files = []
  await mkdir(resolve(stage, 'previous'), { recursive: true })
  for (const [path, bytes] of Object.entries(previous)) {
    await writeFile(resolve(stage, 'previous', path), bytes)
    files.push({ path, previousSha256: digest(bytes), nextSha256: '2'.repeat(64) })
  }
  await writeFile(
    resolve(sample.outputDirectory, '.trace-transaction.json'),
    JSON.stringify({ schemaVersion: 1, stage: stageName, files }),
  )
  const userBytes = Buffer.from('unrelated local edit')
  await writeFile(resolve(sample.outputDirectory, 'reventon.glb'), userBytes)
  await assert.rejects(
    finalizeRuntimeTrace(sample.root, { sourceIdentity: sample.sourceIdentity }),
    /unrelated user edits/,
  )
  assert.deepEqual(await readFile(resolve(sample.outputDirectory, 'reventon.glb')), userBytes)
  assert.ok((await readdir(sample.outputDirectory)).includes('.trace-transaction.json'))
  assert.ok(!(await readdir(sample.outputDirectory)).includes('.trace-finalize.lock'))
})

test('refuses every preparation or mutation after a package descriptor exists', async (t) => {
  const sample = await fixture(t),
    options = { sourceIdentity: sample.sourceIdentity }
  await finalizeRuntimeTrace(sample.root, options)
  const before = await metadataBytes(sample.outputDirectory),
    descriptorDirectory = resolve(sample.root, 'src/lib/workbench')
  await mkdir(descriptorDirectory, { recursive: true })
  await writeFile(resolve(descriptorDirectory, 'reventonRuntimeBundle.json'), '{}')
  await assert.rejects(prepareTraceTextures(sample.root, options), /unregistered local package/)
  await assert.rejects(finalizeRuntimeTrace(sample.root, options), /unregistered local package/)
  assert.deepEqual(await metadataBytes(sample.outputDirectory), before)
})

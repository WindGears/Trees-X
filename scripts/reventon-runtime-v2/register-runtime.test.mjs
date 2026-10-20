import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import sharp from 'sharp'
import { digest, readGlb } from '../asset-package.mjs'
import { createRuntimeGlb, deriveRuntimeDocument } from './build-runtime-model.mjs'
import { verifyRuntime, verifySourcePng } from './build-runtime-verify.mjs'
import { createRuntimeRegistrar, registerRuntime } from './register-runtime.mjs'
import {
  TRACE_TEXTURE_SIZE,
  createTraceTextureRecord,
  traceTexturePath,
  withTraceImages,
} from './runtime-trace-model.mjs'

const fixtureIdentities = new Map()
const registerFixture = createRuntimeRegistrar((root) =>
  verifyRuntime(root, { sourceIdentity: fixtureIdentities.get(root) }),
)

function glb(document) {
  const raw = Buffer.from(JSON.stringify(document))
  const json = Buffer.concat([raw, Buffer.alloc((4 - (raw.length % 4)) % 4, 32)])
  const header = Buffer.alloc(20)
  header.writeUInt32LE(0x46546c67, 0)
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(20 + json.length, 8)
  header.writeUInt32LE(json.length, 12)
  header.writeUInt32LE(0x4e4f534a, 16)
  return Buffer.concat([header, json])
}

function texture({ width = 1, height = 1, levels = 1, transfer = 2 } = {}) {
  const bytes = Buffer.alloc(120)
  Buffer.from('ab4b5458203230bb0d0a1a0a', 'hex').copy(bytes)
  bytes.writeUInt32LE(width, 20)
  bytes.writeUInt32LE(height, 24)
  bytes.writeUInt32LE(levels, 40)
  bytes.writeUInt32LE(80, 48)
  bytes[94] = transfer
  return bytes
}

async function fixture(t, options = {}) {
  const root = await mkdtemp(resolve(tmpdir(), 'trees-runtime-registration-'))
  t.after(async () => {
    fixtureIdentities.delete(root)
    await rm(root, { recursive: true, force: true })
  })
  const sourceDirectory = resolve(root, 'public/models/reventon')
  const outputDirectory = resolve(root, 'public/models/reventon-runtime-v2')
  const descriptor = resolve(root, 'src/lib/workbench/reventonRuntimeBundle.json')
  const put = async (directory, name, bytes) => {
    const path = resolve(directory, name)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, bytes)
  }
  const source = {
    asset: { version: '2.0' },
    materials: [
      { name: 'fixture-material', pbrMetallicRoughness: { baseColorTexture: { index: 0 } } },
    ],
    textures: [{ source: 0 }],
    images: [{ uri: 'color.png' }],
  }
  const original = glb(source)
  const { document, tasks, mappings, repairs, excludedImages } = deriveRuntimeDocument(source)
  const runtime = createRuntimeGlb(original, withTraceImages(document, tasks))
  const input = await sharp({
    create: {
      width: 1,
      height: 1,
      channels: 4,
      background: { r: 60, g: 120, b: 180, alpha: 0.5 },
    },
  })
    .png()
    .toBuffer()
  const tracePixels = await sharp(input)
    .ensureAlpha()
    .resize(TRACE_TEXTURE_SIZE, TRACE_TEXTURE_SIZE, { fit: 'fill' })
    .raw({ depth: 'uchar' })
    .toBuffer()
  const tracePng = await sharp(tracePixels, {
    raw: { width: TRACE_TEXTURE_SIZE, height: TRACE_TEXTURE_SIZE, channels: 4 },
  })
    .png()
    .toBuffer()
  const trace = traceTexturePath(tasks[0].output)
  const motion = Buffer.from('{"schemaVersion":1}')
  const environment = Buffer.from('fixture-environment')
  const ktx = texture(options.texture)
  const originalFiles = [
    { path: 'reventon.glb', role: 'model', data: original },
    { path: 'color.png', role: 'texture', data: input },
    { path: 'studio.exr', role: 'environment', data: environment },
  ]
  const files = [
    { path: 'reventon.glb', role: 'model', data: runtime },
    { path: tasks[0].output, role: 'texture', data: ktx },
    { path: 'studio.exr', role: 'environment', data: environment },
    { path: trace, role: 'texture', data: tracePng },
  ]
  const sourceManifest = {
    schemaVersion: 1,
    id: 'reventon-workbench',
    version: 1,
    entry: 'reventon.glb',
    files: originalFiles.map(({ path, role, data }) => ({
      path,
      role,
      bytes: data.length,
      sha256: digest(data),
    })),
    profile: { textures: 1, motionSource: { sha256: digest(motion) } },
    provenance: {
      author: 'synthetic-test-fixture',
      source: 'temporary test data',
      license: 'test fixture',
      redistribution: 'test fixture only',
    },
    budget: { maxBytes: originalFiles.reduce((sum, file) => sum + file.data.length, 0) },
  }
  const sourceManifestBytes = JSON.stringify(sourceManifest)
  const sourceIdentity = {
    sourceSha256: digest(original),
    sourceManifestSha256: digest(sourceManifestBytes),
  }
  fixtureIdentities.set(root, sourceIdentity)
  const manifest = {
    ...sourceManifest,
    version: 2,
    profile: { ...sourceManifest.profile, traceTextures: tasks.length },
    files: files.map(({ path, role, data }) => ({
      path,
      role,
      bytes: data.length,
      sha256: digest(data),
    })),
    budget: { maxBytes: files.reduce((sum, file) => sum + file.data.length, 0) },
  }
  const manifestBytes = JSON.stringify(manifest)
  const bundle = {
    id: manifest.id,
    version: manifest.version,
    manifest: '/models/reventon-runtime-v2/workbench-manifest.json',
    sha256: digest(manifestBytes),
  }
  await mkdir(sourceDirectory, { recursive: true })
  await mkdir(outputDirectory, { recursive: true })
  await put(sourceDirectory, 'reventon.glb', original)
  await put(sourceDirectory, 'color.png', input)
  await put(sourceDirectory, 'studio.exr', environment)
  await put(sourceDirectory, 'motion.json', motion)
  await put(sourceDirectory, 'workbench-manifest.json', sourceManifestBytes)
  for (const file of files) await put(outputDirectory, file.path, file.data)
  await put(outputDirectory, 'motion.json', motion)
  await put(outputDirectory, 'workbench-manifest.json', manifestBytes)
  await put(outputDirectory, 'bundle-reference.json', JSON.stringify(bundle))
  await put(
    outputDirectory,
    'production-record.json',
    JSON.stringify({
      schemaVersion: 1,
      ...sourceIdentity,
      toolSha256: 'b'.repeat(64),
      runtimeModelSha256: digest(runtime),
      provenance: sourceManifest.provenance,
      sourceModel: 'public/models/reventon/reventon.glb',
      bundle,
      motion: { file: 'motion.json', sha256: digest(motion), requestedAtRuntime: false },
      bindings: mappings,
      repairs,
      excludedImages,
      traceFinalized: true,
      traceTextures: [
        createTraceTextureRecord(
          tasks[0],
          verifySourcePng(
            input,
            sourceManifest.files.find((file) => file.path === 'color.png'),
          ),
          tracePng,
        ),
      ],
      policy: {
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
        traceTextureSize: TRACE_TEXTURE_SIZE,
      },
      textures: [
        {
          ...tasks[0],
          inputBytes: input.length,
          inputSha256: digest(input),
          sourceWidth: 1,
          sourceHeight: 1,
          sourceBitDepth: input[24],
          width: 1,
          height: 1,
          outputBytes: ktx.length,
          outputSha256: digest(ktx),
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
              `${resolve(outputDirectory, tasks[0].output)}.partial.ktx2`,
            ],
          },
        },
      ],
    }),
  )
  return {
    root,
    sourceDirectory,
    outputDirectory,
    descriptor,
    bundle,
    texture: tasks[0].output,
    trace,
  }
}

async function rewriteMetadata(sample, change) {
  const manifestPath = resolve(sample.outputDirectory, 'workbench-manifest.json')
  const recordPath = resolve(sample.outputDirectory, 'production-record.json')
  const manifest = JSON.parse(await readFile(manifestPath))
  const record = JSON.parse(await readFile(recordPath))
  await change(manifest, record)
  manifest.budget.maxBytes = manifest.files.reduce((sum, file) => sum + file.bytes, 0)
  const manifestBytes = JSON.stringify(manifest)
  const bundle = { ...sample.bundle, sha256: digest(manifestBytes) }
  record.bundle = bundle
  await writeFile(manifestPath, manifestBytes)
  await writeFile(recordPath, JSON.stringify(record))
  await writeFile(resolve(sample.outputDirectory, 'bundle-reference.json'), JSON.stringify(bundle))
}

async function absent(path) {
  await assert.rejects(stat(path), { code: 'ENOENT' })
}

test('registers only after real whole-package verification and publishes exact reference', async (t) => {
  const sample = await fixture(t)
  const result = await registerFixture(sample.root)
  assert.equal(result.status, 'registered')
  assert.equal(result.textures, 1)
  const runtime = readGlb(await readFile(resolve(sample.outputDirectory, 'reventon.glb')))
  assert.equal(runtime.images[0].extras.treesTraceImage, sample.trace)
  const traceMetadata = await sharp(resolve(sample.outputDirectory, sample.trace)).metadata()
  assert.equal(traceMetadata.width, TRACE_TEXTURE_SIZE)
  assert.equal(traceMetadata.height, TRACE_TEXTURE_SIZE)
  assert.equal(traceMetadata.channels, 4)
  assert.equal(traceMetadata.bitsPerSample, 8)
  assert.deepEqual(JSON.parse(await readFile(sample.descriptor)), sample.bundle)
  assert.deepEqual(await readdir(dirname(sample.descriptor)), ['reventonRuntimeBundle.json'])
  const validation = JSON.parse(await readFile(resolve(sample.outputDirectory, 'validation.json')))
  assert.equal(validation.passed, true)
  assert.equal(validation.traceFinalized, true)
  assert.deepEqual(
    validation.traceTextures.map((image) => image.path),
    [sample.trace],
  )
})

test('production registration always requires the audited original source identity', async (t) => {
  const sample = await fixture(t)
  await assert.rejects(registerRuntime(sample.root))
  await absent(sample.descriptor)
})

test('waits for successful verification before publishing any descriptor', async (t) => {
  const sample = await fixture(t)
  let finishVerification
  const verification = new Promise((accept) => {
    finishVerification = accept
  })
  const delayed = createRuntimeRegistrar(async (root) => {
    await verification
    return verifyRuntime(root, { sourceIdentity: fixtureIdentities.get(root) })
  })
  const registration = delayed(sample.root)
  await absent(sample.descriptor)
  finishVerification()
  assert.equal((await registration).status, 'registered')
})

test('held trace finalization lock blocks registration before verification', async (t) => {
  const sample = await fixture(t)
  const lock = resolve(sample.outputDirectory, '.trace-finalize.lock')
  const owner = JSON.stringify({ pid: process.pid, purpose: 'fixture-finalization' })
  await writeFile(lock, owner)
  let verified = false
  const registrar = createRuntimeRegistrar(async (root) => {
    verified = true
    return verifyRuntime(root, { sourceIdentity: fixtureIdentities.get(root) })
  })
  await assert.rejects(registrar(sample.root), /trace finalization \(.trace-finalize.lock\)/)
  assert.equal(verified, false)
  await absent(sample.descriptor)
  await absent(resolve(sample.outputDirectory, 'validation.json'))
  assert.equal(await readFile(lock, 'utf8'), owner)
})

test('a trace finalization lock acquired during verification blocks publication', async (t) => {
  const sample = await fixture(t)
  const lock = resolve(sample.outputDirectory, '.trace-finalize.lock')
  const owner = JSON.stringify({ pid: process.pid, purpose: 'fixture-finalization' })
  const registrar = createRuntimeRegistrar(async (root) => {
    const report = await verifyRuntime(root, { sourceIdentity: fixtureIdentities.get(root) })
    await writeFile(lock, owner)
    return report
  })
  await assert.rejects(registrar(sample.root), /trace finalization \(.trace-finalize.lock\)/)
  await absent(sample.descriptor)
  assert.deepEqual(await readdir(dirname(sample.descriptor)), [])
  assert.equal(await readFile(lock, 'utf8'), owner)
})

test('same descriptor preserves existing bytes and modification time', async (t) => {
  const sample = await fixture(t)
  await mkdir(dirname(sample.descriptor), { recursive: true })
  const bytes = Buffer.from(`  ${JSON.stringify(sample.bundle)}\n\n`)
  await writeFile(sample.descriptor, bytes)
  await utimes(sample.descriptor, new Date('2001-01-01'), new Date('2001-01-01'))
  const before = await stat(sample.descriptor)
  assert.equal((await registerFixture(sample.root)).status, 'unchanged')
  assert.deepEqual(await readFile(sample.descriptor), bytes)
  assert.equal((await stat(sample.descriptor)).mtimeMs, before.mtimeMs)
})

test('different or malformed descriptors are never overwritten', async (t) => {
  const sample = await fixture(t)
  await mkdir(dirname(sample.descriptor), { recursive: true })
  for (const bytes of [
    JSON.stringify({ ...sample.bundle, sha256: '0'.repeat(64) }),
    JSON.stringify({ ...sample.bundle, id: 'different-with-same-hash' }),
    '{unfinished',
  ]) {
    await writeFile(sample.descriptor, bytes)
    await assert.rejects(registerFixture(sample.root))
    assert.equal(await readFile(sample.descriptor, 'utf8'), bytes)
    assert.deepEqual(await readdir(dirname(sample.descriptor)), ['reventonRuntimeBundle.json'])
  }
})

test('concurrent registration atomically publishes once and removes staging files', async (t) => {
  const sample = await fixture(t)
  const results = await Promise.all([registerFixture(sample.root), registerFixture(sample.root)])
  assert.deepEqual(results.map((result) => result.status).sort(), ['registered', 'unchanged'])
  assert.deepEqual(JSON.parse(await readFile(sample.descriptor)), sample.bundle)
  assert.deepEqual(await readdir(dirname(sample.descriptor)), ['reventonRuntimeBundle.json'])
})

test('missing or incomplete production package cannot create a descriptor', async (t) => {
  const sample = await fixture(t)
  for (const path of ['production-record.json', 'motion.json', sample.texture, sample.trace]) {
    const file = resolve(sample.outputDirectory, path)
    const bytes = await readFile(file)
    await rm(file)
    await assert.rejects(registerFixture(sample.root), { code: 'ENOENT' })
    await absent(sample.descriptor)
    await writeFile(file, bytes)
  }
  await assert.rejects(registerFixture(resolve(sample.root, 'absent')), { code: 'ENOENT' })
})

test('an existing matching descriptor cannot bypass fresh package verification', async (t) => {
  const sample = await fixture(t)
  await registerFixture(sample.root)
  const bytes = await readFile(sample.descriptor)
  for (const resource of [sample.texture, sample.trace]) {
    const path = resolve(sample.outputDirectory, resource)
    const resourceBytes = await readFile(path)
    await rm(path)
    await assert.rejects(registerFixture(sample.root), { code: 'ENOENT' })
    assert.deepEqual(await readFile(sample.descriptor), bytes)
    await writeFile(path, resourceBytes)
  }
})

test('source, model and resource hash failures cannot be bypassed by a saved passed report', async (t) => {
  const sample = await fixture(t)
  await writeFile(
    resolve(sample.outputDirectory, 'validation.json'),
    JSON.stringify({ passed: true, bundle: sample.bundle }),
  )
  for (const file of [
    resolve(sample.sourceDirectory, 'reventon.glb'),
    resolve(sample.sourceDirectory, 'color.png'),
    resolve(sample.outputDirectory, 'reventon.glb'),
    resolve(sample.outputDirectory, sample.texture),
    resolve(sample.outputDirectory, sample.trace),
    resolve(sample.outputDirectory, 'motion.json'),
  ]) {
    const bytes = await readFile(file)
    await writeFile(file, Buffer.concat([bytes, Buffer.from('corrupt')]))
    await assert.rejects(registerFixture(sample.root))
    await absent(sample.descriptor)
    await writeFile(file, bytes)
  }
})

test('manifest hashes cannot bypass dimensions, full mip and transfer validation', async (t) => {
  for (const texture of [{ width: 8192 }, { levels: 2 }, { transfer: 1 }]) {
    const sample = await fixture(t, { texture })
    await assert.rejects(registerFixture(sample.root))
    await absent(sample.descriptor)
  }
})

test('registration requires finalized CPU trace metadata, profile and the 256 pixel policy', async (t) => {
  for (const change of [
    (_manifest, record) => (record.traceFinalized = false),
    (_manifest, record) => delete record.traceFinalized,
    (_manifest, record) => delete record.traceTextures,
    (_manifest, record) => (record.traceTextures = []),
    (_manifest, record) => (record.policy.traceTextureSize = 128),
    (_manifest, record) => delete record.policy.traceTextureSize,
    (manifest) => delete manifest.profile.traceTextures,
  ]) {
    const sample = await fixture(t)
    await rewriteMetadata(sample, change)
    await assert.rejects(registerFixture(sample.root))
    await absent(sample.descriptor)
  }
})

test('trace sidecars must be present in the manifest with the required texture role', async (t) => {
  for (const omit of [true, false]) {
    const sample = await fixture(t)
    await rewriteMetadata(sample, (manifest) => {
      if (omit) manifest.files = manifest.files.filter((file) => file.path !== sample.trace)
      else manifest.files.find((file) => file.path === sample.trace).role = 'model'
    })
    await assert.rejects(registerFixture(sample.root))
    await absent(sample.descriptor)
  }
})

test('consistent hashes cannot hide a missing GLB trace image reference', async (t) => {
  const sample = await fixture(t)
  const path = resolve(sample.outputDirectory, 'reventon.glb')
  const document = readGlb(await readFile(path))
  delete document.images[0].extras.treesTraceImage
  const bytes = glb(document)
  await writeFile(path, bytes)
  await rewriteMetadata(sample, (manifest, record) => {
    const file = manifest.files.find((entry) => entry.path === 'reventon.glb')
    file.bytes = bytes.length
    file.sha256 = digest(bytes)
    record.runtimeModelSha256 = file.sha256
  })
  await assert.rejects(registerFixture(sample.root))
  await absent(sample.descriptor)
})

test('consistent hashes cannot authorize trace PNGs with wrong dimensions or lost alpha', async (t) => {
  for (const resize of [true, false]) {
    const sample = await fixture(t)
    const path = resolve(sample.outputDirectory, sample.trace)
    const image = sharp(await readFile(path))
    const bytes = await (resize ? image.resize(128, 128) : image.removeAlpha()).png().toBuffer()
    await writeFile(path, bytes)
    await rewriteMetadata(sample, (manifest, record) => {
      const file = manifest.files.find((entry) => entry.path === sample.trace)
      file.bytes = bytes.length
      file.sha256 = digest(bytes)
      record.traceTextures[0].outputBytes = file.bytes
      record.traceTextures[0].outputSha256 = file.sha256
    })
    await assert.rejects(registerFixture(sample.root))
    await absent(sample.descriptor)
  }
})

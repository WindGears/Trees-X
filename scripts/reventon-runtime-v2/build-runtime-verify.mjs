import assert from 'node:assert/strict'
import { readFile, writeFile, copyFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { validateBytes } from 'gltf-validator'
import sharp from 'sharp'
import { digest, jsonText, readGlb, relativeResource } from '../asset-package.mjs'
import {
  cappedDimensions,
  createRuntimeGlb,
  deriveRuntimeDocument,
  matchesReusableKtxSample,
} from './build-runtime-model.mjs'
import {
  TRACE_TEXTURE_SIZE,
  createTraceTextureRecord,
  traceTexturePath,
  verifyTraceTextureHeader,
  withTraceImages,
} from './runtime-trace-model.mjs'

export const reviewedSourceIdentity = Object.freeze({
  sourceSha256: '656630b71c3579bfe5a07dc9b2f6a31ecf945746273a1a9a509bfbd93df229b6',
  sourceManifestSha256: '28031a60c0e0ce12c6f9e6ba5fdb5ba5b9bf0f17ba0cd8890bba3a46d96f739d',
})

const runtimePolicy = Object.freeze({
  encoding: 'UASTC',
  quality: 4,
  rdo: false,
  maxDimension: 4096,
  fullMipChain: true,
  zstd: 18,
  sequentialFiles: true,
  rgbNormalPackingUnchanged: true,
  mipmapFilter: 'lanczos4',
  mipmapWrap: 'clamp',
})

export function verifySourceIdentity(actual, record, expected = reviewedSourceIdentity) {
  for (const key of ['sourceSha256', 'sourceManifestSha256']) {
    assert.match(expected[key], /^[a-f0-9]{64}$/, 'Explicit source identity must be a SHA-256')
    assert.equal(actual[key], expected[key], `Reviewed original ${key}`)
    assert.equal(record[key], expected[key], `Production record ${key}`)
  }
}

export function verifyRuntimePolicy(policy, { traceRequired = true } = {}) {
  assert.ok(policy, 'Encoder policy is required')
  const { threads, ...semanticPolicy } = policy
  assert.ok([8, 16].includes(threads), 'Reviewed encoder thread count is 8 or 16')
  assert.deepEqual(
    semanticPolicy,
    { ...runtimePolicy, ...(traceRequired ? { traceTextureSize: TRACE_TEXTURE_SIZE } : {}) },
    'Reviewed UASTC q4/no-RDO/4K/mipmap/CPU GI policy',
  )
}

function fileRecords(files, label) {
  assert.ok(Array.isArray(files), `${label} files are required`)
  const records = new Map()
  for (const file of files) {
    const path = relativeResource(file.path)
    assert.ok(!records.has(path), `${label} resource paths must be unique`)
    assert.ok(Number.isSafeInteger(file.bytes) && file.bytes > 0, `${label} byte count`)
    assert.match(file.sha256, /^[a-f0-9]{64}$/, `${label} SHA-256`)
    records.set(path, file)
  }
  return records
}

/** Compare sets to the original material graph, before trusting any file's declared role. */
export function verifyRuntimeMetadata(
  manifest,
  record,
  derived,
  sourceManifest,
  { traceRequired = true } = {},
) {
  const required = new Map([
    ['reventon.glb', 'model'],
    ...derived.tasks.map((task) => [task.output, 'texture']),
    ...(traceRequired
      ? derived.tasks.map((task) => [traceTexturePath(task.output), 'texture'])
      : []),
    ['studio.exr', 'environment'],
  ])
  const resources = fileRecords(manifest.files, 'Runtime')
  assert.equal(resources.size, required.size, 'Every required runtime resource must be registered')
  for (const [path, role] of required)
    assert.equal(resources.get(path)?.role, role, `Required resource role: ${path}`)
  assert.deepEqual(
    manifest,
    {
      ...sourceManifest,
      version: 2,
      files: manifest.files,
      budget: {
        ...sourceManifest.budget,
        maxBytes: manifest.files.reduce((sum, file) => sum + file.bytes, 0),
      },
      profile: {
        ...sourceManifest.profile,
        textures: derived.tasks.length,
        ...(traceRequired ? { traceTextures: derived.tasks.length } : {}),
      },
    },
    'Runtime metadata must preserve the reviewed source manifest',
  )
  assert.equal(record.schemaVersion, 1)
  assert.equal(record.sourceModel, 'public/models/reventon/reventon.glb')
  assert.deepEqual(record.provenance, sourceManifest.provenance)
  assert.deepEqual(record.repairs, derived.repairs, 'Only reviewed material repairs')
  assert.deepEqual(record.excludedImages, derived.excludedImages, 'Only unused images are excluded')
  assert.deepEqual(record.bindings, derived.mappings, 'Every original texture binding is recorded')
  assert.match(record.toolSha256, /^[a-f0-9]{64}$/, 'Encoder identity must be recorded')
  assert.ok(Array.isArray(record.textures), 'Texture production records are required')
  assert.equal(record.textures.length, derived.tasks.length, 'One record per required texture')
  const images = new Map()
  for (const image of record.textures) {
    assert.ok(!images.has(image.output), 'Texture production records must be unique')
    images.set(image.output, image)
  }
  for (const task of derived.tasks) {
    const image = images.get(task.output)
    assert.ok(image, `Required texture production record: ${task.output}`)
    for (const key of ['key', 'sourceImage', 'source', 'transfer', 'output', 'slots', 'semantics'])
      assert.deepEqual(image[key], task[key], `Original texture ${key}: ${task.output}`)
  }
  const traceImages = new Map()
  if (traceRequired) {
    assert.equal(record.traceFinalized, true, 'CPU GI trace sidecars must be finalized before use')
    assert.ok(Array.isArray(record.traceTextures), 'CPU GI trace production records are required')
    assert.equal(record.traceTextures.length, derived.tasks.length, 'One CPU GI image per KTX2')
    for (const image of record.traceTextures) {
      assert.ok(!traceImages.has(image.output), 'CPU GI trace records must be unique')
      traceImages.set(image.output, image)
    }
    for (const task of derived.tasks) {
      const image = traceImages.get(traceTexturePath(task.output))
      assert.ok(image, `Required CPU GI image: ${task.output}`)
      assert.equal(image.texture, task.output, 'CPU GI image matches its visible KTX2')
    }
  } else {
    assert.notEqual(
      record.traceFinalized,
      true,
      'Encoded package must not claim trace finalization',
    )
    assert.equal(record.traceTextures, undefined, 'Trace finalization must be a separate step')
  }
  return { resources, images, traceImages }
}

export function verifySourcePng(bytes, file) {
  assert.equal(file.role, 'texture', 'Original PNG must have a texture role')
  assert.equal(bytes.length, file.bytes, 'Original PNG bytes match the reviewed source manifest')
  const inputSha256 = digest(bytes)
  assert.equal(inputSha256, file.sha256, 'Original PNG hash matches the reviewed source manifest')
  assert.ok(bytes.length >= 33, 'PNG header is complete')
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'PNG source expected')
  assert.equal(bytes.readUInt32BE(8), 13, 'PNG IHDR length')
  assert.equal(bytes.toString('ascii', 12, 16), 'IHDR', 'PNG starts with IHDR')
  const sourceWidth = bytes.readUInt32BE(16),
    sourceHeight = bytes.readUInt32BE(20)
  return {
    sourceWidth,
    sourceHeight,
    sourceBitDepth: bytes[24],
    inputBytes: bytes.length,
    inputSha256,
    ...cappedDimensions(sourceWidth, sourceHeight),
  }
}

/** Strict option parsing rejects duplicate/unknown flags as well as explicit RDO/normal changes. */
export function verifyTextureCommand(command, expected) {
  assert.ok(command && typeof command.executable === 'string', 'Recorded encoder command required')
  relativeResource(command.executable)
  const args = command.args
  assert.ok(
    Array.isArray(args) && args.every((arg) => typeof arg === 'string'),
    'Recorded arguments',
  )
  assert.equal(args[0], 'create', 'KTX create command')
  const values = new Map([
    ['--format', expected.transfer === 'srgb' ? 'R8G8B8A8_SRGB' : 'R8G8B8A8_UNORM'],
    ['--assign-tf', expected.transfer],
    ['--assign-primaries', expected.transfer === 'srgb' ? 'bt709' : 'none'],
    ['--assign-texcoord-origin', 'top-left'],
    ['--encode', 'uastc'],
    ['--uastc-quality', '4'],
    ['--mipmap-filter', 'lanczos4'],
    ['--mipmap-wrap', 'clamp'],
    ['--zstd', '18'],
  ])
  if (expected.width !== expected.sourceWidth || expected.height !== expected.sourceHeight) {
    values.set('--width', String(expected.width))
    values.set('--height', String(expected.height))
  }
  const switches = new Set(['--generate-mipmap', '--warn-on-color-conversions']),
    seen = new Set()
  for (let index = 1; index < args.length - 2; index++) {
    const flag = args[index]
    assert.ok(!seen.has(flag), `Duplicate KTX option: ${flag}`)
    seen.add(flag)
    if (switches.has(flag)) continue
    assert.ok(values.has(flag) || flag === '--threads', `Unreviewed KTX option: ${flag}`)
    assert.ok(index + 1 < args.length - 2, `KTX option value: ${flag}`)
    const value = args[++index]
    if (flag === '--threads')
      assert.ok(
        expected.reused ? /^(?:[1-9]|1[0-6])$/.test(value) : ['8', '16'].includes(value),
        'Reviewed encoder command thread count',
      )
    else assert.equal(value, values.get(flag), `Reviewed KTX option: ${flag}`)
  }
  for (const flag of [...values.keys(), ...switches, '--threads'])
    assert.ok(seen.has(flag), `Required KTX option: ${flag}`)
  const matchesPath = (path, suffix) => {
    const normalized = path?.replaceAll('\\', '/')
    return normalized === suffix || normalized?.endsWith('/' + suffix)
  }
  assert.ok(
    matchesPath(args.at(-2), 'public/models/reventon/' + relativeResource(expected.source)),
    'Encoder input must be the reviewed source PNG',
  )
  assert.ok(
    matchesPath(args.at(-1), relativeResource(expected.commandOutput)),
    'Encoder output must match its production record',
  )
}

async function optionalJson(path) {
  try {
    const bytes = await readFile(path)
    return { document: JSON.parse(bytes), sha256: digest(bytes) }
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

export function verifyTextureHeader(bytes, expected) {
  assert.ok(bytes.length >= 80, 'KTX2 header is complete')
  assert.equal(bytes.subarray(0, 12).toString('hex'), 'ab4b5458203230bb0d0a1a0a', 'KTX2 identifier')
  const width = bytes.readUInt32LE(20),
    height = bytes.readUInt32LE(24),
    levels = bytes.readUInt32LE(40)
  assert.equal(width, expected.width)
  assert.equal(height, expected.height)
  assert.ok(width <= 4096 && height <= 4096 && width > 0 && height > 0, 'Maximum 4K runtime image')
  assert.equal(levels, Math.floor(Math.log2(Math.max(width, height))) + 1, 'Complete mip chain')
  const descriptor = bytes.readUInt32LE(48)
  assert.ok(descriptor >= 80 && descriptor + 16 <= bytes.length, 'Valid format descriptor bounds')
  assert.equal(
    bytes[descriptor + 14],
    expected.transfer === 'srgb' ? 2 : 1,
    'Transfer matches material role',
  )
  assert.equal(bytes[descriptor + 15] & 1, 0, 'Runtime keeps straight alpha')
  return { width, height, levels, transfer: expected.transfer }
}

async function verifyRuntimeStage(root, options, traceRequired) {
  const sourceDirectory = resolve(root, 'public/models/reventon'),
    outputDirectory = resolve(root, 'public/models/reventon-runtime-v2')
  const manifestBytes = await readFile(resolve(outputDirectory, 'workbench-manifest.json')),
    manifest = JSON.parse(manifestBytes),
    record = JSON.parse(await readFile(resolve(outputDirectory, 'production-record.json'))),
    original = await readFile(resolve(sourceDirectory, 'reventon.glb')),
    sourceManifestBytes = await readFile(resolve(sourceDirectory, 'workbench-manifest.json')),
    sourceManifest = JSON.parse(sourceManifestBytes)
  // The CLI always uses the reviewed identity. Explicit injection is only for small local fixtures.
  verifySourceIdentity(
    { sourceSha256: digest(original), sourceManifestSha256: digest(sourceManifestBytes) },
    record,
    options.sourceIdentity,
  )
  verifyRuntimePolicy(record.policy, { traceRequired })
  const sourceFiles = fileRecords(sourceManifest.files, 'Original'),
    source = readGlb(original),
    derived = deriveRuntimeDocument(source),
    runtime = await readFile(resolve(outputDirectory, 'reventon.glb')),
    { resources, images, traceImages } = verifyRuntimeMetadata(
      manifest,
      record,
      derived,
      sourceManifest,
      { traceRequired },
    )
  assert.equal(original.length, sourceFiles.get('reventon.glb')?.bytes)
  assert.equal(record.sourceSha256, sourceFiles.get('reventon.glb')?.sha256)
  assert.equal(sourceFiles.get('reventon.glb')?.role, 'model')
  assert.equal(record.runtimeModelSha256, digest(runtime))
  assert.deepEqual(
    runtime,
    createRuntimeGlb(
      original,
      traceRequired ? withTraceImages(derived.document, derived.tasks) : derived.document,
    ),
    'Exact intended JSON rewrite and unchanged BIN',
  )
  const textureHeaders = [],
    traceHeaders = [],
    sourceImages = new Map(),
    reusedSamples = []
  // Check even the excluded PNG against the fixed manifest; keep only tiny metadata in memory.
  for (const [path, file] of sourceFiles) {
    if (file.role !== 'texture') continue
    sourceImages.set(path, verifySourcePng(await readFile(resolve(sourceDirectory, path)), file))
  }
  let previousEvidence = null
  for (const file of manifest.files) {
    const path = relativeResource(file.path)
    const bytes = await readFile(resolve(outputDirectory, path))
    assert.equal(bytes.length, file.bytes)
    assert.equal(digest(bytes), file.sha256)
    if (file.role === 'environment') {
      assert.equal(
        file.bytes,
        sourceFiles.get(path)?.bytes,
        'Environment source bytes are unchanged',
      )
      assert.equal(
        file.sha256,
        sourceFiles.get(path)?.sha256,
        'Environment source hash is unchanged',
      )
    }
    if (file.role === 'texture') {
      if (traceImages.has(path)) {
        const image = traceImages.get(path),
          task = derived.tasks.find((item) => traceTexturePath(item.output) === path),
          input = sourceImages.get(task.source)
        assert.ok(input, 'CPU GI input must be in the reviewed source manifest')
        assert.deepEqual(
          image,
          createTraceTextureRecord(task, input, bytes),
          'CPU GI image provenance',
        )
        const header = verifyTraceTextureHeader(bytes)
        const decoded = await sharp(bytes, { ignoreIcc: true, failOn: 'warning' })
          .raw()
          .toBuffer({ resolveWithObject: true })
        assert.equal(decoded.info.width, TRACE_TEXTURE_SIZE)
        assert.equal(decoded.info.height, TRACE_TEXTURE_SIZE)
        assert.equal(decoded.info.channels, 4)
        assert.equal(decoded.data.length, TRACE_TEXTURE_SIZE ** 2 * 4, 'Complete CPU GI pixels')
        traceHeaders.push({ path, ...header })
        continue
      }
      const image = images.get(path)
      const task = derived.tasks.find((item) => item.output === path)
      const input = sourceImages.get(task.source)
      assert.ok(input, 'Each required PNG is registered by the reviewed source manifest')
      const expected = {
        ...input,
        transfer: task.transfer,
      }
      for (const [key, value] of Object.entries(expected))
        assert.equal(image[key], value, `Texture input ${key}: ${path}`)
      assert.equal(image.outputBytes, file.bytes, 'Texture output byte count')
      assert.equal(image.outputSha256, file.sha256, 'Texture output SHA-256')
      assert.equal(image.mipLevels, Math.floor(Math.log2(Math.max(image.width, image.height))) + 1)
      assert.ok(
        image.reusedFrom === null || typeof image.reusedFrom === 'string',
        'Reuse provenance',
      )
      verifyTextureCommand(image.command, {
        ...expected,
        source: task.source,
        reused: Boolean(image.reusedFrom),
        commandOutput:
          image.reusedFrom ?? 'public/models/reventon-runtime-v2/' + path + '.partial.ktx2',
      })
      if (image.reusedFrom) {
        previousEvidence ??=
          (await optionalJson(resolve(outputDirectory, 'reuse-evidence.json'))) ??
          (await optionalJson(
            resolve(root, 'artifacts/car-runtime-v2/representative-uastc-q4/report.json'),
          ))
        assert.ok(
          previousEvidence,
          'Initial reuse needs its provenance; later checks use local evidence',
        )
        assert.equal(previousEvidence.document.toolSha256, record.toolSha256)
        assert.equal(
          previousEvidence.document.sourceSha256 ?? previousEvidence.document.modelSha256,
          record.sourceSha256,
          'Reused evidence must describe the reviewed source model',
        )
        const previous = previousEvidence.document.samples.find(
          (sample) => sample.output === image.reusedFrom,
        )
        assert.ok(
          previous && matchesReusableKtxSample(previous, expected),
          'Reused sample quality/transfer/mipmap policy must match',
        )
        assert.ok(
          task.semantics.includes(previous.semantic),
          'Reused evidence matches a material role',
        )
        assert.deepEqual(
          image.command,
          previous.command,
          'Reused command retains audited provenance',
        )
        assert.equal(previous.outputSha256, file.sha256)
        reusedSamples.push(previous)
      }
      textureHeaders.push({ path, ...verifyTextureHeader(bytes, expected) })
    }
  }
  const motion = await readFile(resolve(sourceDirectory, 'motion.json'))
  assert.equal(digest(motion), sourceManifest.profile.motionSource.sha256)
  assert.deepEqual(record.motion, {
    file: 'motion.json',
    sha256: digest(motion),
    requestedAtRuntime: false,
  })
  if (options.finalizeMotion) {
    await copyFile(resolve(sourceDirectory, 'motion.json'), resolve(outputDirectory, 'motion.json'))
  }
  const copiedMotion = await readFile(resolve(outputDirectory, 'motion.json'))
  assert.deepEqual(copiedMotion, motion, 'Production motion mother file is unchanged')
  assert.equal(
    manifest.budget.maxBytes,
    manifest.files.reduce((sum, file) => sum + file.bytes, 0),
  )
  const validation = await validateBytes(new Uint8Array(runtime), {
    uri: manifest.entry,
    maxIssues: 200,
    externalResourceFunction: async (uri) => {
      assert.ok(resources.has(relativeResource(uri)), 'Dependency must be registered')
      return new Uint8Array(await readFile(resolve(outputDirectory, uri)))
    },
  })
  assert.equal(validation.issues.numErrors, 0, 'glTF validator must have no errors')
  const bundle = {
    id: manifest.id,
    version: manifest.version,
    manifest: '/models/reventon-runtime-v2/workbench-manifest.json',
    sha256: digest(manifestBytes),
  }
  assert.deepEqual(
    bundle,
    JSON.parse(await readFile(resolve(outputDirectory, 'bundle-reference.json'))),
  )
  assert.deepEqual(record.bundle, bundle, 'Production record bundle identity')
  if (reusedSamples.length && options.writeReport !== false)
    await writeFile(
      resolve(outputDirectory, 'reuse-evidence.json'),
      await jsonText({
        schemaVersion: 1,
        toolSha256: record.toolSha256,
        sourceSha256: record.sourceSha256,
        note: 'Copied audited source command evidence. Re-verification no longer requires ignored artifact directories.',
        samples: reusedSamples,
      }),
    )
  const report = {
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    passed: true,
    bundle,
    bytes: manifest.budget.maxBytes,
    textures: textureHeaders,
    traceTextures: traceHeaders,
    traceFinalized: traceRequired,
    binByteIdentical: true,
    semanticNodesIdentical: true,
    normalsUvsAndPivotsIdentical: true,
    motionSha256: digest(motion),
    materialRepairs: derived.repairs,
    errors: validation.issues.numErrors,
    warnings: validation.issues.numWarnings,
    messages: validation.issues.messages,
    gpuTested: false,
    qualityApproved: false,
  }
  if (options.writeReport !== false)
    await writeFile(resolve(outputDirectory, 'validation.json'), await jsonText(report))
  return report
}

export function verifyRuntime(root = process.cwd(), options = {}) {
  return verifyRuntimeStage(root, options, true)
}

/** Intermediate check for the finalizer only; never accepted by the production registrar. */
export function verifyEncodedRuntime(root = process.cwd(), options = {}) {
  return verifyRuntimeStage(root, { ...options, writeReport: false }, false)
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve('scripts/reventon-runtime-v2/build-runtime-verify.mjs')
) {
  verifyRuntime(process.cwd(), { finalizeMotion: process.argv.includes('--finalize-motion') })
    .then((report) =>
      console.log(
        JSON.stringify({
          bundle: report.bundle,
          passed: report.passed,
          bytes: report.bytes,
          textures: report.textures.length,
          errors: report.errors,
          warnings: report.warnings,
        }),
      ),
    )
    .catch((error) => {
      console.error(error)
      process.exitCode = 1
    })
}

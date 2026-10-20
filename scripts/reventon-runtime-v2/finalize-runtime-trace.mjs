import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, open, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import sharp from 'sharp'
import { digest, jsonText, readGlb, relativeResource } from '../asset-package.mjs'
import { createRuntimeGlb, deriveRuntimeDocument } from './build-runtime-model.mjs'
import {
  verifyEncodedRuntime,
  verifyRuntime,
  verifyRuntimePolicy,
  verifySourceIdentity,
  verifySourcePng,
} from './build-runtime-verify.mjs'
import {
  TRACE_TEXTURE_SIZE,
  createTraceTextureRecord,
  traceTexturePath,
  verifyTraceTextureHeader,
  withTraceImages,
} from './runtime-trace-model.mjs'

const transactionFiles = [
  'reventon.glb',
  'workbench-manifest.json',
  'bundle-reference.json',
  'production-record.json',
]

async function optionalBytes(path) {
  try {
    return await readFile(path)
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

async function atomicWrite(path, bytes) {
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

function directories(root) {
  return {
    source: resolve(root, 'public/models/reventon'),
    output: resolve(root, 'public/models/reventon-runtime-v2'),
    descriptor: resolve(root, 'src/lib/workbench/reventonRuntimeBundle.json'),
  }
}

async function assertUnregistered(root) {
  assert.equal(
    await optionalBytes(directories(root).descriptor),
    null,
    'Trace finalization is limited to an unregistered local package',
  )
}

async function withLock(root, action) {
  await assertUnregistered(root)
  const output = directories(root).output
  await mkdir(output, { recursive: true })
  const path = resolve(output, '.trace-finalize.lock')
  let handle
  try {
    handle = await open(path, 'wx')
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
    const previous = JSON.parse(await readFile(path))
    assert.ok(Number.isSafeInteger(previous.pid) && previous.pid > 0, 'Valid finalization lock')
    let alive = true
    try {
      process.kill(previous.pid, 0)
    } catch (probe) {
      if (probe.code === 'ESRCH') alive = false
      else throw probe
    }
    assert.equal(alive, false, 'Another trace preparation/finalization is still running')
    await unlink(path)
    handle = await open(path, 'wx')
  }
  try {
    await handle.writeFile(
      JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }),
    )
    await handle.close()
    return await action()
  } finally {
    await handle.close()
    await unlink(path)
  }
}

async function sourcePackage(root, options) {
  const directory = directories(root).source,
    original = await readFile(resolve(directory, 'reventon.glb')),
    manifestBytes = await readFile(resolve(directory, 'workbench-manifest.json')),
    identity = {
      sourceSha256: digest(original),
      sourceManifestSha256: digest(manifestBytes),
    }
  verifySourceIdentity(identity, identity, options.sourceIdentity)
  const manifest = JSON.parse(manifestBytes),
    derived = deriveRuntimeDocument(readGlb(original)),
    buildIdentity = JSON.parse(
      await readFile(resolve(directories(root).output, 'build-identity.json')),
    )
  verifySourceIdentity(identity, buildIdentity, options.sourceIdentity)
  verifyRuntimePolicy(buildIdentity.policy, { traceRequired: false })
  return { original, manifest, derived, identity, buildIdentity }
}

/** Numeric resampling only: ignore ICC, never call gamma/normal transforms, then encode RGBA8. */
export async function encodeTracePng(input) {
  const { data, info } = await sharp(input, { ignoreIcc: true, failOn: 'warning' })
    .ensureAlpha()
    .raw({ depth: 'uchar' })
    .toBuffer({ resolveWithObject: true })
  assert.ok(
    [2, 4].includes(info.channels),
    'Source PNG must provide gray/alpha or RGB/alpha samples',
  )
  // Resize RGB and alpha independently: technical RGB values must not be premultiplied by alpha.
  const pixels = info.width * info.height,
    rgb = Buffer.allocUnsafe(pixels * 3),
    alpha = Buffer.allocUnsafe(pixels)
  for (let pixel = 0; pixel < pixels; pixel++) {
    const offset = pixel * info.channels
    rgb[pixel * 3] = data[offset]
    rgb[pixel * 3 + 1] = data[offset + (info.channels === 4 ? 1 : 0)]
    rgb[pixel * 3 + 2] = data[offset + (info.channels === 4 ? 2 : 0)]
    alpha[pixel] = data[offset + info.channels - 1]
  }
  const resize = (bytes, channels) =>
    sharp(bytes, { raw: { width: info.width, height: info.height, channels } })
      .resize(TRACE_TEXTURE_SIZE, TRACE_TEXTURE_SIZE, { fit: 'fill', kernel: 'lanczos3' })
      .raw({ depth: 'uchar' })
      .toBuffer({ resolveWithObject: true })
  const color = await resize(rgb, 3),
    coverage = await resize(alpha, 1),
    rgba = Buffer.allocUnsafe(TRACE_TEXTURE_SIZE ** 2 * 4)
  for (let pixel = 0; pixel < TRACE_TEXTURE_SIZE ** 2; pixel++) {
    rgba[pixel * 4] = color.data[pixel * color.info.channels]
    rgba[pixel * 4 + 1] = color.data[pixel * color.info.channels + 1]
    rgba[pixel * 4 + 2] = color.data[pixel * color.info.channels + 2]
    rgba[pixel * 4 + 3] = coverage.data[pixel * coverage.info.channels]
  }
  const output = await sharp(rgba, {
    raw: { width: TRACE_TEXTURE_SIZE, height: TRACE_TEXTURE_SIZE, channels: 4 },
  })
    .png({ palette: false, compressionLevel: 9 })
    .toBuffer()
  verifyTraceTextureHeader(output)
  return output
}

async function prepare(root, options) {
  const { source, output } = directories(root),
    pack = await sourcePackage(root, options),
    known = new Map(pack.manifest.files.map((file) => [file.path, file])),
    preparationPath = resolve(output, 'trace-preparation.json'),
    savedBytes = await optionalBytes(preparationPath),
    saved = savedBytes ? JSON.parse(savedBytes) : null
  if (saved) {
    verifySourceIdentity(pack.identity, saved, options.sourceIdentity)
    assert.equal(saved.traceTextureSize, TRACE_TEXTURE_SIZE)
    assert.ok(Array.isArray(saved.textures))
    assert.equal(new Set(saved.textures.map((image) => image.output)).size, saved.textures.length)
    assert.ok(
      saved.textures.every((image) =>
        pack.derived.tasks.some((task) => traceTexturePath(task.output) === image.output),
      ),
    )
  }
  const previous = new Map((saved?.textures ?? []).map((image) => [image.output, image])),
    textures = [],
    checkedSources = new Set()
  await mkdir(resolve(output, 'trace'), { recursive: true })
  // One file at a time and one libvips worker; the independent UASTC process keeps running.
  sharp.concurrency(1)
  sharp.cache({ memory: 32, files: 0, items: 16 })
  for (const task of pack.derived.tasks) {
    const input = await readFile(resolve(source, relativeResource(task.source))),
      sourceFile = known.get(task.source)
    assert.ok(sourceFile, 'CPU GI input must be in the reviewed source manifest')
    const metadata = verifySourcePng(input, sourceFile),
      path = traceTexturePath(task.output),
      existing = await optionalBytes(resolve(output, path))
    checkedSources.add(task.source)
    let bytes = existing
    if (previous.has(path)) {
      assert.ok(bytes, 'Prepared CPU GI image is missing')
      verifyTraceTextureHeader(bytes)
      assert.deepEqual(previous.get(path), createTraceTextureRecord(task, metadata, bytes))
    } else {
      const generated = await encodeTracePng(input)
      if (bytes) assert.deepEqual(bytes, generated, 'Unrecorded CPU GI image must be deterministic')
      else {
        bytes = generated
        await atomicWrite(resolve(output, path), bytes)
      }
    }
    textures.push(createTraceTextureRecord(task, metadata, bytes))
    await atomicWrite(
      preparationPath,
      await jsonText({
        schemaVersion: 1,
        ...pack.identity,
        traceTextureSize: TRACE_TEXTURE_SIZE,
        completed: textures.length === pack.derived.tasks.length,
        textures,
      }),
    )
  }
  // The excluded original PNG is still a source asset and keeps its fixed bytes/hash check.
  for (const file of pack.manifest.files)
    if (file.role === 'texture' && !checkedSources.has(file.path))
      verifySourcePng(await readFile(resolve(source, relativeResource(file.path))), file)
  return { ...pack, textures }
}

export function prepareTraceTextures(root = process.cwd(), options = {}) {
  return withLock(root, async () => {
    const record = await optionalBytes(resolve(directories(root).output, 'production-record.json'))
    if (record && JSON.parse(record).traceFinalized === true) {
      const report = await verifyRuntime(root, {
        sourceIdentity: options.sourceIdentity,
        writeReport: false,
      })
      return {
        status: 'unchanged',
        textures: report.traceTextures.length,
        traceTextureSize: TRACE_TEXTURE_SIZE,
      }
    }
    const pack = await prepare(root, options)
    return {
      status: 'prepared',
      textures: pack.textures.length,
      traceTextureSize: TRACE_TEXTURE_SIZE,
    }
  })
}

function checkedStage(output, stage) {
  relativeResource(stage)
  assert.match(stage, /^\.trace-transaction-[a-f0-9-]+$/)
  const path = resolve(output, stage)
  assert.ok(
    path.startsWith(resolve(output) + sep),
    'Transaction directory stays inside runtime output',
  )
  return path
}

async function recoverTransaction(root) {
  const output = directories(root).output,
    journalPath = resolve(output, '.trace-transaction.json'),
    journalBytes = await optionalBytes(journalPath)
  if (!journalBytes) return
  const journal = JSON.parse(journalBytes),
    stage = checkedStage(output, journal.stage)
  assert.deepEqual(
    journal.files.map((file) => file.path),
    transactionFiles,
    'Known transaction files',
  )
  for (const file of journal.files) {
    const current = await readFile(resolve(output, file.path))
    assert.ok(
      [file.previousSha256, file.nextSha256].includes(digest(current)),
      'Refuse recovery over unrelated user edits',
    )
    const previous = await readFile(resolve(stage, 'previous', file.path))
    assert.equal(digest(previous), file.previousSha256, 'Valid transaction backup')
  }
  for (const file of journal.files)
    await atomicWrite(
      resolve(output, file.path),
      await readFile(resolve(stage, 'previous', file.path)),
    )
  await unlink(journalPath)
  await rm(stage, { recursive: true })
}

async function publish(root, updates, options) {
  const output = directories(root).output,
    stageName = '.trace-transaction-' + randomUUID(),
    stage = checkedStage(output, stageName),
    journalPath = resolve(output, '.trace-transaction.json')
  let journalWritten = false
  try {
    await mkdir(resolve(stage, 'previous'), { recursive: true })
    await mkdir(resolve(stage, 'next'))
    const files = []
    for (const path of transactionFiles) {
      const previous = await readFile(resolve(output, path))
      await copyFile(resolve(output, path), resolve(stage, 'previous', path))
      await writeFile(resolve(stage, 'next', path), updates[path], { flag: 'wx' })
      files.push({ path, previousSha256: digest(previous), nextSha256: digest(updates[path]) })
    }
    await atomicWrite(journalPath, await jsonText({ schemaVersion: 1, stage: stageName, files }))
    journalWritten = true
    await assertUnregistered(root)
    for (const [index, path] of transactionFiles.entries()) {
      await options.beforeReplace?.(path, index)
      await rename(resolve(stage, 'next', path), resolve(output, path))
    }
    // The finalized production record is the last atomic replacement; registration also checks the lock.
    const report = await verifyRuntime(root, { sourceIdentity: options.sourceIdentity })
    await unlink(journalPath)
    journalWritten = false
    await rm(stage, { recursive: true })
    return report
  } catch (error) {
    if (journalWritten) await recoverTransaction(root)
    else await rm(stage, { recursive: true, force: true })
    throw error
  }
}

export function finalizeRuntimeTrace(root = process.cwd(), options = {}) {
  return withLock(root, async () => {
    await recoverTransaction(root)
    const output = directories(root).output,
      record = JSON.parse(await readFile(resolve(output, 'production-record.json')))
    if (record.traceFinalized === true) {
      const report = await verifyRuntime(root, {
        sourceIdentity: options.sourceIdentity,
        writeReport: false,
      })
      return { status: 'unchanged', bundle: report.bundle, textures: report.traceTextures.length }
    }
    // Requires the completed builder package and all per-image records; preparation alone cannot publish.
    await verifyEncodedRuntime(root, { sourceIdentity: options.sourceIdentity })
    for (const image of record.textures)
      assert.deepEqual(
        JSON.parse(
          await readFile(resolve(output, 'records', relativeResource(image.output) + '.json')),
        ),
        image,
        'Completed texture record must match its original encoder record',
      )
    const pack = await prepare(root, options),
      model = createRuntimeGlb(
        pack.original,
        withTraceImages(pack.derived.document, pack.derived.tasks),
      ),
      oldManifest = JSON.parse(await readFile(resolve(output, 'workbench-manifest.json'))),
      files = [
        ...oldManifest.files.map((file) =>
          file.path === 'reventon.glb'
            ? { ...file, bytes: model.length, sha256: digest(model) }
            : file,
        ),
        ...pack.textures.map((image) => ({
          path: image.output,
          role: 'texture',
          bytes: image.outputBytes,
          sha256: image.outputSha256,
        })),
      ],
      manifest = {
        ...oldManifest,
        files,
        budget: {
          ...oldManifest.budget,
          maxBytes: files.reduce((sum, file) => sum + file.bytes, 0),
        },
        profile: { ...oldManifest.profile, traceTextures: pack.textures.length },
      },
      manifestText = await jsonText(manifest),
      bundle = { ...record.bundle, sha256: digest(manifestText) },
      finalRecord = {
        ...record,
        bundle,
        policy: { ...record.policy, traceTextureSize: TRACE_TEXTURE_SIZE },
        runtimeModelSha256: digest(model),
        traceFinalized: true,
        traceFinalizedAt: new Date().toISOString(),
        traceTextures: pack.textures,
        method: record.method + '; image extras bind separate 256px CPU GI sidecars only',
        precisionLimitations: [
          ...(record.precisionLimitations ?? []).map((limitation) =>
            limitation === 'Only dimensions above 4096 are reduced, preserving aspect ratio.'
              ? 'Visible KTX2 images: only dimensions above 4096 are reduced, preserving aspect ratio.'
              : limitation,
          ),
          'CPU GI sidecars are separate 256x256 numeric RGBA8 reductions of the reviewed original PNGs; source masters and visible KTX2 images are not replaced.',
        ],
      }
    const report = await publish(
      root,
      {
        'reventon.glb': model,
        'workbench-manifest.json': manifestText,
        'bundle-reference.json': await jsonText(bundle),
        'production-record.json': await jsonText(finalRecord),
      },
      options,
    )
    return {
      status: 'finalized',
      bundle: report.bundle,
      textures: report.traceTextures.length,
      bytes: report.bytes,
    }
  })
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve('scripts/reventon-runtime-v2/finalize-runtime-trace.mjs')
) {
  const operation = process.argv.includes('--prepare-only')
    ? prepareTraceTextures
    : finalizeRuntimeTrace
  operation()
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error) => {
      console.error(error)
      process.exitCode = 1
    })
}

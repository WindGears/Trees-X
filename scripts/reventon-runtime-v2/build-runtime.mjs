import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir, copyFile, rename, lstat } from 'node:fs/promises'
import { resolve, relative } from 'node:path'
import { spawn } from 'node:child_process'
import { availableParallelism } from 'node:os'
import { performance } from 'node:perf_hooks'
import { digest, readGlb, jsonText, relativeResource } from '../asset-package.mjs'
import {
  cappedDimensions,
  createRuntimeGlb,
  deriveRuntimeDocument,
  matchesReusableKtxSample,
} from './build-runtime-model.mjs'

const sourceSha256 = '656630b71c3579bfe5a07dc9b2f6a31ecf945746273a1a9a509bfbd93df229b6'
const root = resolve(process.cwd()),
  sourceDirectory = resolve(root, 'public/models/reventon')
const outputDirectory = resolve(root, 'public/models/reventon-runtime-v2')
const tool = process.env.TREES_KTX || resolve(root, '.tools/ktx-4.4.2/unpacked/bin/ktx.exe')
const threads = Math.max(1, Math.min(16, availableParallelism()))
const policy = {
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
}

async function readOptional(path) {
  try {
    return await readFile(path)
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}
async function run(args) {
  await new Promise((accept, reject) => {
    const process = spawn(tool, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    process.stdout.on('data', (data) => {
      output += data.toString()
    })
    process.stderr.on('data', (data) => {
      output += data.toString()
    })
    process.on('error', reject)
    process.on('close', (code) =>
      code === 0 ? accept() : reject(new Error(`KTX ${code}: ${output}`)),
    )
  })
}
async function recordFile(path, role) {
  const bytes = await readFile(resolve(outputDirectory, relativeResource(path)))
  return { path, role, bytes: bytes.length, sha256: digest(bytes) }
}

/** A registered reference is immutable even if its local production record was removed. */
export async function assertRuntimeBuildUnregistered(workspace = process.cwd()) {
  try {
    await lstat(resolve(workspace, 'src/lib/workbench/reventonRuntimeBundle.json'))
  } catch (error) {
    if (error.code === 'ENOENT') return
    throw error
  }
  throw new Error(
    'Runtime v2 is already registered; build a separate version instead of overwriting it',
  )
}

async function main() {
  await assertRuntimeBuildUnregistered(root)
  const started = new Date().toISOString(),
    source = await readFile(resolve(sourceDirectory, 'reventon.glb'))
  assert.equal(digest(source), sourceSha256, 'Only the reviewed original Reventon is supported')
  const manifestBytes = await readFile(resolve(sourceDirectory, 'workbench-manifest.json'))
  const manifest = JSON.parse(manifestBytes),
    knownFiles = new Map(manifest.files.map((file) => [file.path, file]))
  const toolSha256 = digest(await readFile(tool)),
    derived = deriveRuntimeDocument(readGlb(source))
  const finalRecord = await readOptional(resolve(outputDirectory, 'production-record.json'))
  if (finalRecord)
    throw new Error('Completed version already exists; verify it instead of overwriting')
  await mkdir(resolve(outputDirectory, 'records'), { recursive: true })
  const buildIdentity = {
    sourceSha256,
    sourceManifestSha256: digest(manifestBytes),
    toolSha256,
    policy,
  }
  const identityPath = resolve(outputDirectory, 'build-identity.json'),
    existingIdentity = await readOptional(identityPath)
  if (existingIdentity) {
    // Thread count changes scheduling only, not UASTC q4/no-RDO semantics.
    // Every newly encoded record retains the exact command/thread count used.
    const semanticIdentity = (identity) => ({
      ...identity,
      policy: { ...identity.policy, threads: undefined },
    })
    assert.deepEqual(
      semanticIdentity(JSON.parse(existingIdentity)),
      semanticIdentity(buildIdentity),
      'Resume encoding semantics must match',
    )
  } else await writeFile(identityPath, await jsonText(buildIdentity))
  let samples = []
  const oldReport = await readOptional(
    resolve(root, 'artifacts/car-runtime-v2/representative-uastc-q4/report.json'),
  )
  if (oldReport) {
    const parsed = JSON.parse(oldReport)
    if (
      parsed.modelSha256 === sourceSha256 &&
      parsed.toolSha256 === toolSha256 &&
      parsed.policy.encoding === 'UASTC' &&
      parsed.policy.quality === 4 &&
      parsed.policy.rdo === false &&
      parsed.policy.fullMipChain === true
    )
      samples = parsed.samples
  }
  const records = []
  console.log(
    JSON.stringify({
      event: 'start',
      textures: derived.tasks.length,
      excluded: derived.excludedImages,
      policy,
    }),
  )
  for (const [ordinal, task] of derived.tasks.entries()) {
    const input = resolve(sourceDirectory, task.source),
      inputBytes = await readFile(input),
      inputSha256 = digest(inputBytes),
      expected = knownFiles.get(task.source)
    assert.ok(expected, `Manifest source exists: ${task.source}`)
    assert.equal(inputBytes.length, expected.bytes)
    assert.equal(inputSha256, expected.sha256)
    assert.equal(inputBytes.readUInt32BE(0), 0x89504e47, 'PNG input expected')
    const sourceWidth = inputBytes.readUInt32BE(16),
      sourceHeight = inputBytes.readUInt32BE(20),
      target = cappedDimensions(sourceWidth, sourceHeight)
    const output = resolve(outputDirectory, task.output),
      recordPath = resolve(outputDirectory, 'records', task.output + '.json')
    const previous = await readOptional(recordPath)
    if (previous) {
      const record = JSON.parse(previous),
        packed = await readFile(output)
      assert.equal(record.inputSha256, inputSha256)
      assert.equal(record.outputSha256, digest(packed))
      assert.equal(record.transfer, task.transfer)
      assert.equal(record.width, target.width)
      assert.equal(record.height, target.height)
      records.push(record)
      console.log(
        JSON.stringify({
          event: 'resume',
          completed: records.length,
          total: derived.tasks.length,
          output: task.output,
        }),
      )
      continue
    }
    const old = samples.find((sample) =>
      matchesReusableKtxSample(sample, { inputSha256, ...target, transfer: task.transfer }),
    )
    let reusedFrom = null,
      command = null
    const tick = performance.now()
    assert.equal(
      await readOptional(output),
      null,
      'Unrecorded final output must be inspected manually',
    )
    if (old) {
      const originalPacked = await readFile(resolve(root, relativeResource(old.output)))
      assert.equal(digest(originalPacked), old.outputSha256)
      await copyFile(resolve(root, old.output), output)
      reusedFrom = old.output
    } else {
      const temporary = output + '.partial.ktx2'
      assert.equal(
        await readOptional(temporary),
        null,
        'Unrecorded partial output must be inspected manually',
      )
      const args = [
        'create',
        '--format',
        task.transfer === 'srgb' ? 'R8G8B8A8_SRGB' : 'R8G8B8A8_UNORM',
        '--assign-tf',
        task.transfer,
        '--assign-primaries',
        task.transfer === 'srgb' ? 'bt709' : 'none',
        '--assign-texcoord-origin',
        'top-left',
        '--encode',
        'uastc',
        '--uastc-quality',
        '4',
        '--threads',
        String(threads),
        '--generate-mipmap',
        '--mipmap-filter',
        'lanczos4',
        '--mipmap-wrap',
        'clamp',
        '--zstd',
        '18',
        '--warn-on-color-conversions',
      ]
      if (target.width !== sourceWidth || target.height !== sourceHeight)
        args.push('--width', String(target.width), '--height', String(target.height))
      args.push(input, temporary)
      command = { executable: relative(root, tool).replaceAll('\\', '/'), args }
      console.log(
        JSON.stringify({
          event: 'encoding',
          ordinal: ordinal + 1,
          total: derived.tasks.length,
          source: task.source,
          transfer: task.transfer,
          width: target.width,
          height: target.height,
        }),
      )
      await run(args)
      await run(['validate', '--gltf-basisu', temporary])
      await rename(temporary, output)
    }
    const packed = await readFile(output)
    assert.equal(packed.readUInt32LE(20), target.width)
    assert.equal(packed.readUInt32LE(24), target.height)
    const mipLevels = Math.floor(Math.log2(Math.max(target.width, target.height))) + 1
    assert.equal(packed.readUInt32LE(40), mipLevels, 'Complete mip chain required')
    const record = {
      ...task,
      sourceWidth,
      sourceHeight,
      ...target,
      sourceBitDepth: inputBytes[24],
      inputBytes: inputBytes.length,
      inputSha256,
      outputBytes: packed.length,
      outputSha256: digest(packed),
      mipLevels,
      reusedFrom,
      command: command ?? old?.command ?? null,
      encodingWallMs: performance.now() - tick,
      losses: {
        resized: target.width !== sourceWidth || target.height !== sourceHeight,
        quantized16To8: inputBytes[24] === 16,
        gpuBlockEncoding: true,
      },
      qualityApproved: false,
    }
    await writeFile(recordPath, await jsonText(record))
    records.push(record)
    await writeFile(
      resolve(outputDirectory, 'build-progress.json'),
      await jsonText({
        started,
        updatedAt: new Date().toISOString(),
        completed: records.length,
        total: derived.tasks.length,
        last: task.output,
        ready: false,
      }),
    )
    console.log(
      JSON.stringify({
        event: 'encoded',
        completed: records.length,
        total: derived.tasks.length,
        output: task.output,
        milliseconds: record.encodingWallMs,
        bytes: record.outputBytes,
        reused: Boolean(reusedFrom),
      }),
    )
  }
  const glb = createRuntimeGlb(source, derived.document)
  await writeFile(resolve(outputDirectory, 'reventon.glb'), glb)
  const environment = knownFiles.get('studio.exr'),
    exr = await readFile(resolve(sourceDirectory, 'studio.exr'))
  assert.equal(digest(exr), environment.sha256)
  await copyFile(resolve(sourceDirectory, 'studio.exr'), resolve(outputDirectory, 'studio.exr'))
  const motion = await readFile(resolve(sourceDirectory, 'motion.json'))
  assert.equal(
    digest(motion),
    manifest.profile.motionSource.sha256,
    'Motion mother file remains exact',
  )
  await copyFile(resolve(sourceDirectory, 'motion.json'), resolve(outputDirectory, 'motion.json'))
  const files = [
    await recordFile('reventon.glb', 'model'),
    ...(await Promise.all(records.map((item) => recordFile(item.output, 'texture')))),
    await recordFile('studio.exr', 'environment'),
  ]
  const runtimeManifest = {
    ...manifest,
    version: 2,
    files,
    budget: { ...manifest.budget, maxBytes: files.reduce((sum, file) => sum + file.bytes, 0) },
    profile: { ...manifest.profile, textures: records.length },
  }
  const text = await jsonText(runtimeManifest)
  await writeFile(resolve(outputDirectory, 'workbench-manifest.json'), text)
  const bundle = {
    id: runtimeManifest.id,
    version: 2,
    manifest: '/models/reventon-runtime-v2/workbench-manifest.json',
    sha256: digest(text),
  }
  await writeFile(resolve(outputDirectory, 'bundle-reference.json'), await jsonText(bundle))
  await writeFile(
    resolve(outputDirectory, 'production-record.json'),
    await jsonText({
      schemaVersion: 1,
      started,
      completedAt: new Date().toISOString(),
      ...buildIdentity,
      bundle,
      provenance: manifest.provenance,
      sourceModel: 'public/models/reventon/reventon.glb',
      runtimeModelSha256: digest(glb),
      motion: { file: 'motion.json', sha256: digest(motion), requestedAtRuntime: false },
      method:
        'JSON reference and documented suede color repair only; complete BIN, nodes, pivots, normals, UVs and motion references unchanged',
      repairs: derived.repairs,
      excludedImages: derived.excludedImages,
      bindings: derived.mappings,
      textures: records,
      qualityApproved: false,
      gpuTested: false,
      precisionLimitations: [
        'UASTC and device transcoding are lossy.',
        '16-bit source PNGs are quantized to RGBA8.',
        'Only dimensions above 4096 are reduced, preserving aspect ratio.',
        'RGB normal packing is unchanged; normal-mode and normalize are not used.',
        'Lanczos4 clamp-boundary mip filtering follows the reviewed candidates; alpha edges and repeating samplers require close-up inspection.',
        'Source contains no redistribution license; no new public distribution permission is asserted.',
      ],
    }),
  )
  await writeFile(
    resolve(outputDirectory, 'build-progress.json'),
    await jsonText({
      started,
      updatedAt: new Date().toISOString(),
      completed: records.length,
      total: derived.tasks.length,
      ready: true,
    }),
  )
  console.log(
    JSON.stringify({
      event: 'complete',
      bundle,
      files: files.length,
      bytes: runtimeManifest.budget.maxBytes,
    }),
  )
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(root, 'scripts/reventon-runtime-v2/build-runtime.mjs')
) {
  main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}

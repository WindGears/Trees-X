import assert from 'node:assert/strict'
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateBytes } from 'gltf-validator'
import { digest, jsonText, readGlb, relativeResource } from '../asset-package.mjs'
import {
  comparisonProduct,
  createFixtureGlb,
  fixtureWorldBounds,
  materialComparisonGroups,
} from './material-fixture.mjs'

const expectedSource = '656630b71c3579bfe5a07dc9b2f6a31ecf945746273a1a9a509bfbd93df229b6'

export function mipAllocation(width, height, bytesPerBlock = 4, blockSize = 1) {
  let total = 0
  for (;;) {
    total += Math.ceil(width / blockSize) * Math.ceil(height / blockSize) * bytesPerBlock
    if (width === 1 && height === 1) break
    width = Math.max(1, Math.floor(width / 2))
    height = Math.max(1, Math.floor(height / 2))
  }
  return total
}

export async function buildMaterialComparisons(options = {}) {
  const root = resolve(options.root ?? process.cwd()),
    sourceDirectory = resolve(root, 'public/models/reventon'),
    sampleDirectory = resolve(root, 'artifacts/car-runtime-v2/representative-uastc-q4'),
    outputDirectory = resolve(
      root,
      options.output ?? 'artifacts/car-runtime-v2/material-comparison',
    ),
    artifactRelative = relative(root, outputDirectory).replaceAll('\\', '/')
  assert.match(
    artifactRelative,
    /^artifacts\/car-runtime-v2\/material-comparison(?:\/|$)/,
    'Fixture outputs must stay in ignored comparison directory',
  )
  try {
    await stat(outputDirectory)
    throw new Error('Refusing to overwrite existing fixture directory: ' + outputDirectory)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  const sourceBytes = await readFile(resolve(sourceDirectory, 'reventon.glb')),
    source = readGlb(sourceBytes),
    sourceManifest = JSON.parse(
      await readFile(resolve(sourceDirectory, 'workbench-manifest.json'), 'utf8'),
    ),
    sampleReport = JSON.parse(await readFile(resolve(sampleDirectory, 'report.json'), 'utf8')),
    sourceProduct = JSON.parse(
      await readFile(
        resolve(root, 'server/src/main/resources/presentations/reventon-workbench-v1.json'),
        'utf8',
      ),
    ),
    knownFiles = new Map(sourceManifest.files.map((file) => [file.path, file]))
  assert.equal(digest(sourceBytes), expectedSource)
  assert.equal(sampleReport.modelSha256, expectedSource)
  assert.equal(knownFiles.get('reventon.glb').sha256, expectedSource)
  assert.equal(sampleReport.samples.length, 6)
  assert.deepEqual(sampleReport.policy, {
    encoding: 'UASTC',
    quality: 4,
    rdo: false,
    resizing: false,
    fullMipChain: true,
    zstd: 18,
    sequentialFiles: true,
    threads: 2,
    rgbNormalPackingUnchanged: true,
  })
  const samples = sampleReport.samples
  for (const sample of samples) {
    assert.equal(source.images[sample.image].uri, sample.source)
    assert.equal(knownFiles.get(sample.source)?.sha256, sample.inputSha256)
    const input = await readFile(resolve(sourceDirectory, relativeResource(sample.source))),
      packed = await readFile(resolve(root, relativeResource(sample.output)))
    assert.equal(digest(input), sample.inputSha256)
    assert.equal(digest(packed), sample.outputSha256)
    assert.equal(input.readUInt32BE(16), packed.readUInt32LE(20))
    assert.equal(input.readUInt32BE(20), packed.readUInt32LE(24))
  }
  const summary = {
    schemaVersion: 1,
    fixture: true,
    startedAt: new Date().toISOString(),
    sourceModelSha256: expectedSource,
    sourceManifestSha256: digest(
      await readFile(resolve(sourceDirectory, 'workbench-manifest.json')),
    ),
    sampleReportSha256: digest(await readFile(resolve(sampleDirectory, 'report.json'))),
    outputDirectory: artifactRelative,
    groups: [],
    gpuTested: false,
    qualityApproved: false,
    runtimeAdopted: false,
    limitations: [
      'Only selected real material meshes are drawn. Unrelated original BIN bytes and empty semantic nodes remain for exact geometry/axis proof; these packages are not optimized full cars.',
      'Isolated surfaces omit their surrounding car geometry: this cannot validate whole-car occlusion, reflected surroundings, overlapping trim, cockpit transmission, motion coverage or renderer memory capacity.',
      'Source PBR parameters and all referenced textures remain. Car adapter overlay/glass repairs must be applied identically for original and candidate.',
      'The common source stage, original studio EXR, exposure and default rest transforms are retained; a group-specific A/B camera replaces only camera/default-perspective framing.',
      'UASTC and device transcodes are lossy. Five sampled PNGs are 16-bit and are converted to 8-bit RGBA before compression. Visual acceptance remains pending.',
      'Allocation estimates assume complete mips and either RGBA8 or BC7/ASTC4x4-style 16-byte blocks; actual browser transcode format must be recorded. This is not physical VRAM or loading timing.',
      'Sampled roles may be combined within a group. Use the exported derive/createFixture functions with a single replacementRoles entry to isolate one failing texture before adoption.',
      'Generated API JSON is fixture=true for disposable test-context routing only, not a backend/database product or production resource reference.',
    ],
    reproduce: 'node scripts/reventon-runtime-v2/build-material-comparison.mjs',
  }
  await mkdir(outputDirectory, { recursive: true })
  const verifiedSourceFiles = new Map()
  async function sourceFile(path) {
    if (verifiedSourceFiles.has(path)) return verifiedSourceFiles.get(path)
    const known = knownFiles.get(path)
    assert.ok(known, 'Source file must be registered: ' + path)
    const filePath = resolve(sourceDirectory, relativeResource(path)),
      bytes = await readFile(filePath)
    assert.equal(bytes.length, known.bytes)
    assert.equal(digest(bytes), known.sha256)
    const result = { ...known, sourcePath: filePath }
    if (path.endsWith('.png'))
      result.image = {
        width: bytes.readUInt32BE(16),
        height: bytes.readUInt32BE(20),
        bitDepth: bytes[24],
      }
    verifiedSourceFiles.set(path, result)
    return result
  }
  for (const group of materialComparisonGroups) {
    const groupResult = { ...group, variants: [] }
    for (const variant of ['original', 'candidate']) {
      const output = resolve(outputDirectory, group.id, variant),
        derived = createFixtureGlb(sourceBytes, {
          materialIds: group.materialIds,
          samples,
          replacementRoles: variant === 'candidate' ? group.replacements : [],
        }),
        bounds = fixtureWorldBounds(derived.document),
        files = [],
        textures = [],
        copies = new Map()
      await mkdir(output, { recursive: true })
      await writeFile(resolve(output, 'model.glb'), derived.bytes)
      files.push({
        path: 'model.glb',
        role: 'model',
        bytes: derived.bytes.length,
        sha256: digest(derived.bytes),
      })
      for (const mapping of derived.record.images) {
        const image = derived.document.images[mapping.output]
        if (image.uri == null) continue
        const original = await sourceFile(source.images[mapping.source].uri),
          sample = mapping.replacement
            ? samples.find((item) => item.role === mapping.replacement)
            : undefined,
          sourcePath = sample
            ? resolve(root, relativeResource(sample.output))
            : original.sourcePath,
          record = sample
            ? {
                path: image.uri,
                role: 'texture',
                bytes: sample.outputBytes,
                sha256: sample.outputSha256,
              }
            : { path: image.uri, role: 'texture', bytes: original.bytes, sha256: original.sha256 }
        copies.set(image.uri, { ...record, sourcePath })
        textures.push({
          path: image.uri,
          sourceImage: mapping.source,
          sourcePath: source.images[mapping.source].uri,
          sourceBitDepth: original.image.bitDepth,
          replacement: mapping.replacement,
          width: original.image.width,
          height: original.image.height,
          mipRGBA8Bytes: mipAllocation(original.image.width, original.image.height),
          conditionalBlock16Bytes: mipAllocation(
            original.image.width,
            original.image.height,
            16,
            4,
          ),
        })
      }
      for (const buffer of derived.document.buffers ?? []) {
        if (buffer.uri == null) continue
        const original = await sourceFile(relativeResource(buffer.uri))
        copies.set(buffer.uri, original)
      }
      const environmentFile = sourceProduct.presentation.stage.environmentFile,
        environment = await sourceFile(environmentFile)
      copies.set(environmentFile, environment)
      for (const [path, file] of copies) {
        await mkdir(dirname(resolve(output, path)), { recursive: true })
        await copyFile(file.sourcePath, resolve(output, path))
        files.push({ path, role: file.role, bytes: file.bytes, sha256: file.sha256 })
      }
      const manifest = {
        schemaVersion: 1,
        fixture: true,
        id: `reventon-material-${group.id}-${variant}`,
        version: 1,
        entry: 'model.glb',
        files,
        budget: {
          maxBytes: files.reduce((sum, file) => sum + file.bytes, 0),
          maxTriangles: derived.record.triangles,
        },
        provenance: {
          ...sourceManifest.provenance,
          source:
            sourceManifest.provenance.source + '; isolated immutable material-comparison fixture',
          redistribution:
            sourceManifest.provenance.redistribution + '; local ignored test outputs only',
        },
      }
      const manifestText = await jsonText(manifest),
        manifestRelative = relative(root, resolve(output, 'manifest.json')).replaceAll('\\', '/'),
        bundle = {
          id: manifest.id,
          version: manifest.version,
          manifest: '/' + manifestRelative,
          sha256: digest(manifestText),
        },
        product = comparisonProduct(
          sourceProduct,
          group,
          bounds,
          bundle,
          derived.document.materials.map((material) => material.name),
        ),
        validation = await validateBytes(new Uint8Array(derived.bytes), {
          uri: 'model.glb',
          maxIssues: 0,
          externalResourceFunction: async (uri) => {
            const path = relativeResource(uri)
            assert.ok(
              files.some((file) => file.path === path),
              'Only manifested fixture files',
            )
            return new Uint8Array(await readFile(resolve(output, path)))
          },
        }),
        record = {
          fixture: true,
          variant,
          group: group.id,
          sourceModelSha256: expectedSource,
          manifestSha256: bundle.sha256,
          replacements: variant === 'candidate' ? group.replacements : [],
          ...derived.record,
          geometryProof: derived.verification,
          bounds,
          camera: product.presentation.camera,
          originalStage: product.presentation.stage,
          textures,
          theoreticalTextureAllocationBytes: textures.reduce(
            (sum, texture) =>
              sum + (texture.replacement ? texture.conditionalBlock16Bytes : texture.mipRGBA8Bytes),
            0,
          ),
          allocationAssumption:
            variant === 'candidate'
              ? 'PNG unique images RGBA8; KTX unique images conditionally BC7/ASTC4x4 16-byte blocks; includes full mips, excludes environment, render targets and driver overhead; must record actual browser format'
              : 'Unique PNG images RGBA8 with complete mips; excludes environment, targets, duplicated sampler/transfer texture instances and driver overhead',
          validation: {
            errors: validation.issues.numErrors,
            warnings: validation.issues.numWarnings,
            truncated: validation.issues.truncated,
            messages: validation.issues.messages,
            note: 'Retained unused source accessors/BIN can produce expected unused-object notices; unsupported extension notices do not prove KTX render compatibility',
          },
          qualityApproved: false,
        }
      await writeFile(resolve(output, 'manifest.json'), manifestText)
      await writeFile(resolve(output, 'fixture-product.json'), await jsonText(product))
      await writeFile(resolve(output, 'production-record.json'), await jsonText(record))
      await writeFile(resolve(output, 'gltf-validation.json'), await jsonText(validation))
      assert.equal(
        validation.issues.numErrors,
        0,
        `Invalid generated fixture ${group.id}/${variant}`,
      )
      assert.equal(validation.issues.truncated, false, 'Full glTF validation must complete')
      groupResult.variants.push({
        variant,
        manifest: manifestRelative,
        manifestSha256: bundle.sha256,
        product: relative(root, resolve(output, 'fixture-product.json')).replaceAll('\\', '/'),
        bytes: manifest.budget.maxBytes,
        triangles: derived.record.triangles,
        images: derived.document.images.length,
        meshes: derived.document.meshes.length,
        materials: derived.document.materials.length,
        camera: product.presentation.camera,
        theoreticalTextureAllocationBytes: record.theoreticalTextureAllocationBytes,
      })
      console.log(
        JSON.stringify({
          fixture: true,
          group: group.id,
          variant,
          meshes: derived.document.meshes.length,
          images: derived.document.images.length,
          triangles: derived.record.triangles,
          bytes: manifest.budget.maxBytes,
          validationErrors: validation.issues.numErrors,
        }),
      )
    }
    assert.deepEqual(groupResult.variants[0].camera, groupResult.variants[1].camera)
    summary.groups.push(groupResult)
  }
  summary.completedAt = new Date().toISOString()
  await writeFile(resolve(outputDirectory, 'index.json'), await jsonText(summary))
  return summary
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildMaterialComparisons({ output: process.argv[2] })
}

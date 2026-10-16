/* global structuredClone */
import assert from 'node:assert/strict'
import { access, mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative } from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import { after, before, test } from 'node:test'
import sharp from 'sharp'
import { digest } from '../asset-package.mjs'
import { openGlb } from '../typewriter-v2/glb.mjs'
import { auditedPaintSource, buildPaintStudy, paintFiles } from './build.mjs'

const repo = fileURLToPath(new URL('../../', import.meta.url))
const sourceDir = join(repo, 'public/models/bundles/kimi-typewriter/v2')
const runtimeDir = join(repo, 'public/models/bundles/kimi-typewriter/paint-study')
const sourceBytes = await readFile(join(sourceDir, 'model.glb'))
const source = openGlb(sourceBytes)
const sourceRig = await readFile(join(sourceDir, 'rig.json'))
const sourceManifest = JSON.parse(await readFile(join(sourceDir, 'manifest.json'), 'utf8'))
const paintNames = new Set(['enamel', 'shellGloss', 'shellRim'])
let workspace, textures, output, recipe, candidate, result

before(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'trees-x-paint-preservation-'))
  textures = join(workspace, 'materials')
  output = join(workspace, 'candidate')
  await mkdir(textures)
  const files = []
  for (const name of paintFiles) {
    const color = name.includes('normal')
      ? { r: 128, g: 128, b: 255 }
      : { r: 255, g: name.includes('coat') ? 230 : 240, b: 255 }
    const bytes = await sharp({
      create: { width: 2048, height: 2048, channels: 3, background: color },
    })
      .png()
      .toBuffer()
    await writeFile(join(textures, name), bytes)
    files.push({ path: name, bytes: bytes.length, sha256: digest(bytes) })
  }
  recipe = {
    version: 1,
    size: 2048,
    method: 'Synthetic preservation fixture, not artistic content',
    files,
  }
  await writeFile(join(textures, 'textures.json'), JSON.stringify(recipe))
  const nameplate = await sharp({
    create: {
      width: 1024,
      height: 416,
      channels: 4,
      background: { r: 216, g: 179, b: 104, alpha: 0.5 },
    },
  })
    .png()
    .toBuffer()
  result = await buildPaintStudy({ textures, output, nameplate })
  candidate = openGlb(await readFile(join(output, 'model.glb')))
})

after(async () => {
  if (!workspace) return
  const offset = relative(tmpdir(), workspace)
  assert.ok(isAbsolute(workspace) && !isAbsolute(offset) && !offset.startsWith('..'))
  assert.ok(offset.startsWith('trees-x-paint-preservation-'))
  await rm(workspace, { recursive: true, force: true })
})

function assertGeometryAndSemantics(next) {
  for (const key of Object.keys(source.json))
    if (!['buffers', 'bufferViews', 'images', 'textures', 'materials'].includes(key))
      assert.deepEqual(next.json[key], source.json[key], 'Unexpected glTF field change: ' + key)
  assert.deepEqual(next.binary.subarray(0, source.binary.length), source.binary)
  assert.deepEqual(next.json.accessors, source.json.accessors)
  assert.deepEqual(next.json.meshes, source.json.meshes)
  assert.deepEqual(next.json.nodes, source.json.nodes)
  assert.deepEqual(next.json.scenes, source.json.scenes)
  assert.deepEqual(next.json.samplers, source.json.samplers)
  assert.deepEqual(
    next.json.bufferViews.slice(0, source.json.bufferViews.length),
    source.json.bufferViews,
  )
  assert.equal(next.json.bufferViews.length, source.json.bufferViews.length + 1)
  const semanticNodes = next.json.nodes.filter((node) => node.extras?.partId !== undefined)
  assert.equal(semanticNodes.length, 572)
  assert.equal(next.json.nodes.filter((node) => node.mesh !== undefined).length, 2257)
  assert.equal(new Set(semanticNodes.map((node) => node.extras.partId)).size, 572)
}

function assertPaintOnly(next) {
  for (let index = 0; index < source.json.materials.length; index++) {
    const original = source.json.materials[index]
    const changed = structuredClone(next.json.materials[index])
    if (paintNames.has(original.name)) {
      const coat = changed.extensions.KHR_materials_clearcoat.clearcoatRoughnessTexture
      assert.deepEqual(coat, { index: source.json.textures.length, texCoord: 1 })
      delete changed.extensions.KHR_materials_clearcoat.clearcoatRoughnessTexture
      assert.equal(changed.normalTexture.texCoord, 1)
      assert.equal(changed.pbrMetallicRoughness.metallicRoughnessTexture.texCoord, 1)
      assert.equal(changed.extras.treesFinishVersion, 2)
    }
    assert.deepEqual(changed, original, 'Unrequested material/scalar change: ' + original.name)
  }
  assert.deepEqual(next.json.textures.slice(0, source.json.textures.length), source.json.textures)
  assert.equal(next.json.textures.length, source.json.textures.length + 1)
  const appended = next.json.textures.at(-1)
  assert.equal(appended.source, source.json.images.length)
  assert.equal(appended.sampler, source.json.textures[51].sampler)
  assert.equal(next.json.images.at(-1).uri, 'textures/paint-coat-roughness.png')
}

function embeddedImage(doc, index) {
  const image = doc.json.images[index]
  const view = doc.json.bufferViews[image.bufferView]
  return doc.binary.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength)
}

function assertOtherCharacters(next) {
  assert.equal(next.json.images.length, source.json.images.length + 1)
  for (let index = 0; index < source.json.images.length; index++) {
    if (index === 50) continue
    assert.deepEqual(next.json.images[index], source.json.images[index])
    if (source.json.images[index].bufferView !== undefined)
      assert.deepEqual(embeddedImage(next, index), embeddedImage(source, index))
  }
  assert.notEqual(digest(embeddedImage(next, 50)), digest(embeddedImage(source, 50)))
  const nameplate = source.json.materials.findIndex((material) => material.name === 'decal-62')
  assert.deepEqual(next.json.materials[nameplate], source.json.materials[nameplate])
  const texture = next.json.materials[nameplate].pbrMetallicRoughness.baseColorTexture.index
  assert.equal(next.json.textures[texture].source, 50)
}

test('source model and rig are the audited immutable v2, not a silently different starting point', () => {
  assert.equal(digest(sourceBytes), auditedPaintSource.model)
  assert.equal(digest(sourceRig), auditedPaintSource.rig)
})

test('an altered source manifest is rejected before reading model or external texture files', async () => {
  const changedSource = join(workspace, 'changed-source')
  await mkdir(changedSource)
  const changedManifest = structuredClone(sourceManifest)
  changedManifest.budget.maxBytes++
  await writeFile(join(changedSource, 'manifest.json'), JSON.stringify(changedManifest))
  // Deliberately provide no model, rig or textures. A late validation would
  // instead throw ENOENT while reading those absent files.
  await assert.rejects(
    buildPaintStudy({ textures, output: join(workspace, 'reject-source'), source: changedSource }),
    /Source manifest differs from the audited v2/,
  )
  await assert.rejects(access(join(workspace, 'reject-source')), { code: 'ENOENT' })
})

test('builder preserves all geometry, UVs, tangents, 572 semantics and 2257 surface mappings byte-exactly', () => {
  assertGeometryAndSemantics(candidate)
})

test('only the three paint materials gain one shared UV1 coat map; Physical scalars stay identical', () => {
  assertPaintOnly(candidate)
})

test('nameplate changes only embedded image 50; all other character payloads and bindings stay intact', () => {
  assertOtherCharacters(candidate)
})

test('motion and five non-paint technical textures are copied byte-exactly', async () => {
  assert.deepEqual(await readFile(join(output, 'rig.json')), sourceRig)
  const preserved = sourceManifest.files.filter(
    (file) => file.role === 'texture' && !file.path.includes('/paint-'),
  )
  assert.equal(preserved.length, 5)
  for (const file of preserved)
    assert.deepEqual(
      await readFile(join(output, file.path)),
      await readFile(join(sourceDir, file.path)),
    )
})

test('manifest and record reflect the new immutable version, precise hashes, budget and unaccepted quality', async () => {
  const next = JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8'))
  assert.equal(next.version, 3)
  assert.equal(next.id, sourceManifest.id)
  assert.equal(next.budget.maxTriangles, sourceManifest.budget.maxTriangles)
  assert.equal(
    next.budget.maxBytes,
    next.files.reduce((sum, file) => sum + file.bytes, 0),
  )
  assert.equal(next.files.filter((file) => file.role === 'texture').length, 8)
  for (const file of next.files) {
    const bytes = await readFile(join(output, file.path))
    assert.equal(bytes.length, file.bytes)
    assert.equal(digest(bytes), file.sha256)
  }
  assert.equal(result.record.sourceSha256, auditedPaintSource.model)
  assert.equal(result.record.rigSha256, auditedPaintSource.rig)
  assert.equal(result.record.qualityApproved, false)
  assert.equal(result.record.gpuEstimate.textureCount, 8)
  assert.equal(result.record.preservation.semanticParts, 572)
  assert.equal(result.record.preservation.surfaceMappings, 2257)
  assert.equal(
    result.reference.manifest,
    undefined,
    'Temporary fixtures must not invent public URLs',
  )
})

test('existing destinations cannot be overwritten, even with otherwise invalid inputs', async () => {
  await assert.rejects(
    buildPaintStudy({ textures: join(workspace, 'does-not-exist'), output }),
    /immutable output directory/,
  )
})

test('texture metadata/hash mismatch rejects before publishing a destination', async () => {
  const corruptDir = join(workspace, 'corrupt-materials')
  await mkdir(corruptDir)
  const wrong = structuredClone(recipe)
  wrong.files[0].sha256 = '0'.repeat(64)
  await writeFile(join(corruptDir, 'textures.json'), JSON.stringify(wrong))
  await writeFile(
    join(corruptDir, wrong.files[0].path),
    await readFile(join(textures, wrong.files[0].path)),
  )
  const missing = join(workspace, 'must-not-publish')
  await assert.rejects(buildPaintStudy({ textures: corruptDir, output: missing }), /hash mismatch/)
  await assert.rejects(access(missing), { code: 'ENOENT' })
})

test('optional known authoring masters remain provenance only, never runtime dependencies', async () => {
  const authoringDir = join(workspace, 'with-masters')
  await mkdir(authoringDir)
  const authored = structuredClone(recipe)
  for (const file of recipe.files)
    await writeFile(join(authoringDir, file.path), await readFile(join(textures, file.path)))
  for (const path of [
    'paint-height-master.png',
    'paint-roughness-master.png',
    'paint-coat-roughness-master.png',
  ]) {
    const bytes = Buffer.from('Preservation test master file; not a runtime image')
    await writeFile(join(authoringDir, path), bytes)
    authored.files.push({
      path,
      bytes: bytes.length,
      sha256: digest(bytes),
      role: 'authoring master',
    })
  }
  await writeFile(join(authoringDir, 'textures.json'), JSON.stringify(authored))
  const nameplate = embeddedImage(candidate, 50)
  const withMasters = await buildPaintStudy({
    textures: authoringDir,
    output: join(workspace, 'candidate-with-masters'),
    nameplate,
  })
  assert.equal(withMasters.record.materialRecipe.files.length, 6)
  assert.equal(withMasters.manifest.files.filter((file) => file.role === 'texture').length, 8)
  assert.ok(withMasters.manifest.files.every((file) => !file.path.includes('master')))
  assert.deepEqual(
    await readFile(join(withMasters.output, 'model.glb')),
    await readFile(join(output, 'model.glb')),
    'Optional authoring masters cannot alter the runtime model',
  )
})

test('actual paint-study runtime package retains geometry, mechanics, characters and manifest hashes', async (t) => {
  try {
    await access(runtimeDir)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    t.skip('Runtime artistic inputs are not assembled yet; synthetic preservation checks still run')
    return
  }
  const next = openGlb(await readFile(join(runtimeDir, 'model.glb')))
  assertGeometryAndSemantics(next)
  assertPaintOnly(next)
  assertOtherCharacters(next)
  const { windGearPaintNameplate } = await import('./wordmark.mjs')
  assert.deepEqual(embeddedImage(next, 50), await windGearPaintNameplate())
  assert.deepEqual(await readFile(join(runtimeDir, 'rig.json')), sourceRig)
  const manifest = JSON.parse(await readFile(join(runtimeDir, 'manifest.json'), 'utf8'))
  for (const file of manifest.files) {
    const bytes = await readFile(join(runtimeDir, file.path))
    assert.equal(bytes.length, file.bytes)
    assert.equal(digest(bytes), file.sha256)
  }
})

test('actual material maps use linear RGB8 technical channels and bounded micro-normal slopes', async (t) => {
  try {
    await access(runtimeDir)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    t.skip('Runtime artistic maps are not assembled yet; no visual or material pass is inferred')
    return
  }
  const record = JSON.parse(await readFile(join(runtimeDir, 'production-record.json'), 'utf8'))
  assert.equal(record.qualityApproved, false)
  assert.match(record.materialRecipe.recipes[0].normalConvention, /OpenGL \+Y/)
  assert.equal(record.materialRecipe.size, 2048)
  const runtimeEntries = record.materialRecipe.files.filter((file) =>
    paintFiles.includes(file.path),
  )
  assert.equal(runtimeEntries.length, 3)
  for (const file of runtimeEntries) {
    const bytes = await readFile(join(runtimeDir, 'textures', file.path))
    assert.equal(digest(bytes), file.sha256)
    const meta = await sharp(bytes).metadata()
    assert.equal(meta.width, 2048)
    assert.equal(meta.height, 2048)
    assert.equal(meta.channels, 3)
    assert.equal(meta.depth, 'uchar')
    for (let cursor = 8; cursor < bytes.length;) {
      const length = bytes.readUInt32BE(cursor)
      const type = bytes.toString('ascii', cursor + 4, cursor + 8)
      assert.ok(!['sRGB', 'iCCP', 'cHRM'].includes(type), 'No display transform on technical map')
      if (type === 'gAMA') assert.equal(bytes.readUInt32BE(cursor + 8), 100000)
      cursor += length + 12
    }
    const data = await sharp(bytes).raw().toBuffer()
    let minimum = Infinity,
      maximum = -Infinity,
      sum = 0
    if (file.path === 'paint-normal.png') {
      let slopeSquares = 0
      for (let index = 0; index < data.length; index += 3) {
        const x = data[index] / 127.5 - 1
        const y = data[index + 1] / 127.5 - 1
        const z = data[index + 2] / 127.5 - 1
        assert.ok(z > 0, 'Normal faces tangent +Z')
        assert.ok(Math.abs(Math.hypot(x, y, z) - 1) <= 0.015)
        slopeSquares += (x * x + y * y) / (z * z)
      }
      const slopeRms = Math.sqrt(slopeSquares / (data.length / 3))
      assert.ok(slopeRms > 0)
      assert.ok(slopeRms <= record.materialRecipe.reference.quantizedSlopeRms * 1.005)
      t.diagnostic(`Actual quantized slope RMS ${slopeRms}; no visual quality inference`)
    } else {
      for (let index = 0; index < data.length; index += 3) {
        assert.equal(data[index], 255, 'No baked assembly occlusion in R')
        assert.equal(data[index + 2], 255, 'B retains original scalar metalness/coat semantics')
        minimum = Math.min(minimum, data[index + 1])
        maximum = Math.max(maximum, data[index + 1])
        sum += data[index + 1]
      }
      assert.ok(minimum >= 0.8 * 255 && maximum <= 255 && maximum > minimum)
      const mean = sum / (data.length / 3) / 255
      assert.ok(Math.abs(mean - (file.path.includes('coat') ? 0.94 : 0.93)) <= 0.005)
      t.diagnostic(`${file.path} G mean ${mean}; multiplier range ${minimum}/255—${maximum}/255`)
    }
  }
})

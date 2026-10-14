import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import test from 'node:test'
import sharp from 'sharp'
import { openGlb } from './glb.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const directory = join(root, 'public/models/bundles/kimi-typewriter/v2')
const record = JSON.parse(await readFile(join(directory, 'production-record.json'), 'utf8'))
const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'))
const expectedFiles = [
  'paint-normal.png',
  'paint-orm.png',
  'brush-normal.png',
  'brush-orm.png',
  'brush-direction.png',
  'iron-normal.png',
  'iron-orm.png',
]
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')

function pngChunks(bytes) {
  const chunks = []
  for (let offset = 8; offset < bytes.length;) {
    const length = bytes.readUInt32BE(offset)
    assert.ok(offset + 12 + length <= bytes.length, 'PNG chunk extends beyond file')
    chunks.push({
      type: bytes.toString('ascii', offset + 4, offset + 8),
      data: bytes.subarray(offset + 8, offset + 8 + length),
    })
    offset += length + 12
  }
  return chunks
}

function normalStats(data) {
  let maxLengthError = 0,
    minimumBlue = 255,
    x = 0,
    y = 0,
    xx = 0,
    yy = 0
  for (let offset = 0; offset < data.length; offset += 3) {
    const nx = data[offset] / 127.5 - 1
    const ny = data[offset + 1] / 127.5 - 1
    const nz = data[offset + 2] / 127.5 - 1
    maxLengthError = Math.max(maxLengthError, Math.abs(Math.hypot(nx, ny, nz) - 1))
    minimumBlue = Math.min(minimumBlue, data[offset + 2])
    x += nx
    y += ny
    xx += nx * nx
    yy += ny * ny
  }
  const count = data.length / 3
  return {
    maxLengthError,
    minimumBlue,
    varianceX: xx / count - (x / count) ** 2,
    varianceY: yy / count - (y / count) ** 2,
  }
}

function histogramStats(histogram) {
  let count = 0,
    squared = 0
  for (let value = 0; value < histogram.length; value++) {
    count += histogram[value]
    squared += value * value * histogram[value]
  }
  let accumulated = 0,
    p95 = 0
  for (; p95 < 255; p95++) {
    accumulated += histogram[p95]
    if (accumulated >= count * 0.95) break
  }
  return { rms: Math.sqrt(squared / count), p95, count }
}

function periodicDiagnostics(data, width, height) {
  const histograms = {
    xInterior: new Uint32Array(256),
    xWrap: new Uint32Array(256),
    yInterior: new Uint32Array(256),
    yWrap: new Uint32Array(256),
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 3
      const nextX = (y * width + ((x + 1) % width)) * 3
      const nextY = (((y + 1) % height) * width + x) * 3
      const xHistogram = x === width - 1 ? histograms.xWrap : histograms.xInterior
      const yHistogram = y === height - 1 ? histograms.yWrap : histograms.yInterior
      for (let channel = 0; channel < 3; channel++) {
        xHistogram[Math.abs(data[nextX + channel] - data[index + channel])]++
        yHistogram[Math.abs(data[nextY + channel] - data[index + channel])]++
      }
    }
  }
  const result = {}
  for (const axis of ['x', 'y']) {
    const interior = histogramStats(histograms[`${axis}Interior`])
    const wrap = histogramStats(histograms[`${axis}Wrap`])
    result[axis] = {
      interior,
      wrap,
      wrapToInteriorRms: interior.rms > 0 ? wrap.rms / interior.rms : null,
    }
  }
  // First/last pixels are adjacent periodic samples, not identical endpoints.
  // These distributions are diagnostics only: finite edge samples and directional
  // spectra do not justify a universal seam acceptance threshold.
  return result
}

test('production record contains exactly seven declared linear micro-surface PNGs', () => {
  assert.equal(record.version, 2)
  assert.equal(record.materialRecipe.size, 2048)
  assert.deepEqual(
    record.materialRecipe.files.map((file) => file.path).sort(),
    [...expectedFiles].sort(),
  )
  assert.ok(record.materialRecipe.provenance.includes('no downloaded image inputs'))
})

for (const filename of expectedFiles) {
  test(`runtime ${filename}: recorded bytes, RGB8 data and channel semantics`, async (t) => {
    const entry = record.materialRecipe.files.find((file) => file.path === filename)
    const runtime = manifest.files.find((file) => file.path === `textures/${filename}`)
    assert.ok(entry && runtime, 'Recipe and runtime manifest must both declare the image')
    const bytes = await readFile(join(directory, 'textures', filename))
    assert.equal(bytes.length, entry.bytes)
    assert.equal(digest(bytes), entry.sha256)
    assert.equal(runtime.bytes, entry.bytes)
    assert.equal(runtime.sha256, entry.sha256)
    assert.equal(entry.colorSpace, 'linear data')
    assert.equal(entry.format, 'PNG RGB8')
    assert.equal(entry.width, 2048)
    assert.equal(entry.height, 2048)
    const metadata = await sharp(bytes).metadata()
    assert.equal(metadata.format, 'png')
    assert.equal(metadata.width, 2048)
    assert.equal(metadata.height, 2048)
    assert.equal(metadata.channels, 3)
    assert.equal(metadata.depth, 'uchar')
    assert.equal(metadata.hasAlpha, false)
    assert.equal(bytes[24], 8, 'PNG IHDR bit depth')
    assert.equal(bytes[25], 2, 'PNG IHDR truecolor RGB')
    const chunks = pngChunks(bytes)
    const { data, info } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true })
    assert.equal(info.channels, 3)
    if (filename.endsWith('-normal.png')) {
      const stats = normalStats(data)
      assert.ok(
        stats.maxLengthError <= 0.015,
        `Quantized normal length error ${stats.maxLengthError}`,
      )
      assert.ok(stats.minimumBlue > 128, 'Tangent normal must face +Z')
      assert.ok(
        stats.varianceX > 0 && stats.varianceY > 0,
        'Micro-normal must contain actual variation',
      )
      if (filename === 'brush-normal.png') {
        assert.ok(
          stats.varianceX / stats.varianceY >= 4,
          'Brushed microstructure requires directional slope variance',
        )
      }
      t.diagnostic(`normal statistics ${JSON.stringify(stats)}`)
    } else if (filename.endsWith('-orm.png')) {
      let minimumRoughness = 255,
        maximumRoughness = 0
      for (let offset = 0; offset < data.length; offset += 3) {
        assert.equal(data[offset], 255, 'R must not contain baked assembly occlusion')
        assert.equal(data[offset + 2], 255, 'B must preserve scalar material metalness')
        minimumRoughness = Math.min(minimumRoughness, data[offset + 1])
        maximumRoughness = Math.max(maximumRoughness, data[offset + 1])
      }
      assert.ok(minimumRoughness >= 0.8 * 255 && maximumRoughness <= 255)
      assert.ok(maximumRoughness > minimumRoughness, 'Roughness map must not be constant')
      t.diagnostic(`roughness multiplier ${minimumRoughness}/255—${maximumRoughness}/255`)
    } else {
      let minimumStrength = 255,
        maximumDirectionError = 0
      for (let offset = 0; offset < data.length; offset += 3) {
        maximumDirectionError = Math.max(
          maximumDirectionError,
          Math.abs(Math.hypot(data[offset] / 127.5 - 1, data[offset + 1] / 127.5 - 1) - 1),
        )
        minimumStrength = Math.min(minimumStrength, data[offset + 2])
      }
      assert.ok(maximumDirectionError <= 0.015, 'Encoded anisotropy direction must be normalized')
      assert.ok(minimumStrength > 0, 'Direction map must not erase anisotropy strength')
      t.diagnostic(
        `direction length error ${maximumDirectionError}; minimum strength ${minimumStrength}/255`,
      )
    }
    t.diagnostic(
      `periodic gradient distributions (not visual acceptance) ${JSON.stringify(periodicDiagnostics(data, info.width, info.height))}`,
    )
    assert.ok(
      !chunks.some((chunk) => ['sRGB', 'iCCP', 'cHRM'].includes(chunk.type)),
      'Data maps must not carry an implicit display-color transform',
    )
    for (const chunk of chunks.filter((chunk) => chunk.type === 'gAMA')) {
      assert.equal(chunk.data.readUInt32BE(0), 100000, 'If gamma is declared, data must be linear')
    }
  })
}

test('WindGear nameplate replaces image 50 without rebinding its material or pretending to OCR it', async (t) => {
  const [sourceBytes, candidateBytes] = await Promise.all([
    readFile(join(root, 'public/models/bundles/kimi-typewriter/v1/model.glb')),
    readFile(join(directory, 'model.glb')),
  ])
  const source = openGlb(sourceBytes),
    candidate = openGlb(candidateBytes)
  const replacement = record.brandReplacement
  assert.equal(replacement.sourceIndex, 50)
  assert.equal(replacement.sourceMaterial, 'decal-62')
  assert.equal(replacement.text, 'WindGear')
  const materialIndex = source.json.materials.findIndex(
    (material) => material.name === replacement.sourceMaterial,
  )
  assert.ok(materialIndex >= 0)
  const sourceMaterial = source.json.materials[materialIndex]
  const candidateMaterial = candidate.json.materials[materialIndex]
  assert.deepEqual(
    candidateMaterial,
    sourceMaterial,
    'Only image payload, not decal material, changes',
  )
  const textureIndex = sourceMaterial.pbrMetallicRoughness.baseColorTexture.index
  assert.deepEqual(candidate.json.textures[textureIndex], source.json.textures[textureIndex])
  assert.equal(source.json.textures[textureIndex].source, 50)
  assert.equal(candidate.json.textures[textureIndex].source, 50)
  const getImage = (doc) => {
    const image = doc.json.images[50]
    assert.equal(image.mimeType, 'image/png')
    const view = doc.json.bufferViews[image.bufferView]
    return doc.binary.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength)
  }
  const oldImage = getImage(source),
    newImage = getImage(candidate)
  assert.equal(digest(oldImage), replacement.sourceSha256)
  assert.equal(digest(newImage), replacement.candidateSha256)
  assert.notEqual(digest(newImage), digest(oldImage))
  assert.ok(candidate.json.images[50].name.includes('WindGear'))
  const metadata = await sharp(newImage).metadata()
  assert.equal(metadata.width, 1024)
  assert.equal(metadata.height, 416)
  assert.equal(metadata.hasAlpha, true)
  assert.equal(replacement.width, metadata.width)
  assert.equal(replacement.height, metadata.height)
  const { data } = await sharp(newImage).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let transparent = 0,
    goldInk = 0
  for (let offset = 0; offset < data.length; offset += 4) {
    if (data[offset + 3] === 0) transparent++
    if (
      data[offset + 3] > 200 &&
      Math.abs(data[offset] - 216) <= 2 &&
      Math.abs(data[offset + 1] - 179) <= 2 &&
      Math.abs(data[offset + 2] - 104) <= 2
    )
      goldInk++
  }
  assert.ok(transparent > 1024 * 416 * 0.1, 'Decal must retain actual transparent background')
  assert.ok(goldInk > 1000, 'Decal must contain visible authored gold ink')
  t.diagnostic(
    `WindGear content tag verified; no OCR or visual approval asserted; transparent=${transparent}, goldInk=${goldInk}`,
  )
})
/* global URL */

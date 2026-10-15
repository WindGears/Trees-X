import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import sharp from 'sharp'
import { outputDirectory, verifyAssetPack } from './build.mjs'
import { inspectManifest } from '../demo/assets.mjs'
import { createStoneData, encodeDataPng, pngChunkNames, STONE_DATA_RECIPE } from './stone-data.mjs'

test('technical microdetail is deterministic, periodic and bounded independent data', async () => {
  const first = createStoneData()
  const second = createStoneData()
  assert.deepEqual(first, second)
  let minimumRoughness = 255,
    maximumRoughness = 0,
    maximumNormalError = 0
  for (let y = 0; y < first.size; y++) {
    for (let x = 0; x < first.size; x++) {
      const index = (y * first.size + x) * 3
      const roughness = first.roughness[index]
      assert.equal(first.roughness[index + 1], roughness)
      assert.equal(first.roughness[index + 2], roughness)
      minimumRoughness = Math.min(minimumRoughness, roughness)
      maximumRoughness = Math.max(maximumRoughness, roughness)
      const decoded = [0, 1, 2].map((channel) => first.normal[index + channel] / 127.5 - 1)
      maximumNormalError = Math.max(maximumNormalError, Math.abs(Math.hypot(...decoded) - 1))
      assert.ok(decoded[2] > 0.99, 'Micro-normal must remain close to the positive tangent Z axis')
      if (x === 0 || y === 0) {
        const opposite =
          x === 0 ? (y * first.size + first.size - 1) * 3 : ((first.size - 1) * first.size + x) * 3
        for (const kind of ['roughness', 'normal'])
          assert.deepEqual(
            first[kind].subarray(index, index + 3),
            first[kind].subarray(opposite, opposite + 3),
          )
      }
    }
  }
  assert.ok(minimumRoughness / 255 >= 0.25 && maximumRoughness / 255 <= 0.4)
  assert.ok(
    maximumRoughness - minimumRoughness >= 8,
    'Roughness must contain actual local variation',
  )
  assert.ok(maximumNormalError < 0.008, '8-bit normal quantization must remain bounded')
  for (const kind of ['roughness', 'normal']) {
    const encoded = await encodeDataPng(first[kind], first.size)
    assert.ok(
      !pngChunkNames(encoded).some((name) => ['sRGB', 'gAMA', 'iCCP', 'cICP'].includes(name)),
    )
    const decoded = await sharp(encoded).raw().toBuffer()
    assert.deepEqual(decoded, first[kind], 'Encoding must preserve numerical channel values')
    assert.equal(first.size, STONE_DATA_RECIPE.size)
  }
})

test('runtime manifest verifies unchanged native sources and the committed numerical recipe', async () => {
  const manifest = await verifyAssetPack()
  assert.equal(manifest.files.length, 4)
  assert.equal(manifest.entry, 'lounge-panorama.png')
  for (const file of manifest.files) assert.equal(file.path, file.file)
  const receipt = await inspectManifest(join(outputDirectory, 'manifest.json'))
  assert.equal(receipt.files, 4)
  assert.equal(
    receipt.assetBytes,
    manifest.files.reduce((sum, file) => sum + file.bytes, 0),
  )
  assert.equal(manifest.files.filter((file) => file.unchangedCopy).length, 2)
  const data = createStoneData()
  for (const kind of ['normal', 'roughness']) {
    const expected = await encodeDataPng(data[kind], data.size)
    const actual = await readFile(join(outputDirectory, `stone-${kind}.png`))
    assert.equal(
      createHash('sha256').update(actual).digest('hex'),
      createHash('sha256').update(expected).digest('hex'),
      `Runtime ${kind} must match the recorded deterministic recipe`,
    )
  }
})

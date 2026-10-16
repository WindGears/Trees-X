import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import test from 'node:test'
import {
  fileDigest,
  inspectManifest,
  inspectSupportAssets,
  rejectLfsPointer,
  resourcePath,
} from './assets.mjs'

test('resource paths cannot escape the manifest directory or disguise URL paths', () => {
  const root = join(tmpdir(), 'trees-assets')
  assert.equal(resourcePath(root, 'textures/a.png'), join(root, 'textures', 'a.png'))
  for (const value of [
    '../outside',
    '/absolute',
    'C:/other',
    'a\\b',
    '%2e%2e/a',
    'a?x=1',
    'a#hash',
    '',
  ])
    assert.throws(() => resourcePath(root, value))
})

test('manifest bytes, hashes, duplicate records and unresolved LFS are verified against disk', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'trees-demo-assets-'))
  try {
    const model = Buffer.from('glTF-test-file')
    const record = {
      path: 'model.glb',
      bytes: model.length,
      sha256: createHash('sha256').update(model).digest('hex'),
    }
    const manifest = { schemaVersion: 1, entry: 'model.glb', files: [record] }
    const path = join(directory, 'manifest.json')
    await writeFile(join(directory, 'model.glb'), model)
    await writeFile(path, JSON.stringify(manifest))
    assert.equal((await inspectManifest(path)).assetBytes, model.length)
    assert.equal((await fileDigest(join(directory, 'model.glb'))).sha256, record.sha256)
    await writeFile(join(directory, 'model.glb'), Buffer.from('glTF-test-fail'))
    await assert.rejects(inspectManifest(path), /SHA-256/)
    await writeFile(join(directory, 'model.glb'), model)
    await writeFile(path, JSON.stringify({ ...manifest, files: [record, record] }))
    await assert.rejects(inspectManifest(path), /重复/)
    await writeFile(
      join(directory, 'model.glb'),
      'version https://git-lfs.github.com/spec/v1\noid sha256:123\nsize 100000\n',
    )
    await assert.rejects(rejectLfsPointer(join(directory, 'model.glb')), /Git LFS/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('support receipts require all amber, spatial and layer packs; reject missing, LFS and corrupt assets', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'trees-demo-support-'))
  const files = {
    'draco/draco_wasm_wrapper.js': 'decoder wrapper',
    'draco/draco_decoder.wasm': 'decoder wasm',
    'draco/draco_decoder.js': 'decoder fallback',
    'covers/product.png': 'product cover',
    'covers/nested/product.svg': '<svg/>',
    'models/denoise/rt_hdr_alb_nrm.tza': 'guided denoise weights',
    'models/denoise/LICENSE.txt': 'Apache-2.0',
    'studio/amber-lounge/v1/lounge-panorama.png': 'amber visible panorama fixture',
    'studio/amber-lounge/v1/stone-basecolor.png': 'amber slab basecolor fixture',
    'studio/amber-lounge/v1/stone-roughness.png': 'amber roughness data fixture',
    'studio/amber-lounge/v1/stone-normal.png': 'amber normal data fixture',
    'studio/amber-lounge/spatial-v1/radial-distance.f32': 'radial distance fixture',
    'studio/amber-lounge/spatial-v1/DA2-LICENSE.txt': 'Apache-2.0',
    'studio/amber-lounge/layers-v1/clean-room.png': 'inferred empty room fixture',
    'studio/amber-lounge/layers-v1/chair-table.png': 'fixed chair and table RGBA fixture',
    'studio/amber-lounge/layers-v1/table-lamp.png': 'fixed lamp RGBA fixture',
  }
  files['models/denoise/manifest.json'] = JSON.stringify({
    schemaVersion: 1,
    entry: 'rt_hdr_alb_nrm.tza',
    files: ['rt_hdr_alb_nrm.tza', 'LICENSE.txt'].map((path) => ({
      path,
      bytes: Buffer.byteLength(files['models/denoise/' + path]),
      sha256: createHash('sha256')
        .update(files['models/denoise/' + path])
        .digest('hex'),
    })),
  })
  const amberMaps = [
    'lounge-panorama.png',
    'stone-basecolor.png',
    'stone-roughness.png',
    'stone-normal.png',
  ]
  files['studio/amber-lounge/v1/manifest.json'] = JSON.stringify({
    schemaVersion: 1,
    id: 'amber-lounge-v1',
    entry: 'lounge-panorama.png',
    files: amberMaps.map((path) => ({
      path,
      bytes: Buffer.byteLength(files['studio/amber-lounge/v1/' + path]),
      sha256: createHash('sha256')
        .update(files['studio/amber-lounge/v1/' + path])
        .digest('hex'),
    })),
  })
  const additionalPacks = [
    {
      directory: 'spatial-v1',
      entry: 'radial-distance.f32',
      paths: ['radial-distance.f32', 'DA2-LICENSE.txt'],
    },
    {
      directory: 'layers-v1',
      entry: 'clean-room.png',
      paths: ['clean-room.png', 'chair-table.png', 'table-lamp.png'],
    },
  ]
  for (const { directory: pack, entry, paths } of additionalPacks) {
    const directory = 'studio/amber-lounge/' + pack + '/'
    files[directory + 'manifest.json'] = JSON.stringify({
      schemaVersion: 1,
      entry,
      files: paths.map((path) => ({
        path,
        bytes: Buffer.byteLength(files[directory + path]),
        sha256: createHash('sha256')
          .update(files[directory + path])
          .digest('hex'),
      })),
    })
  }
  const loungeManifests = [
      'studio/amber-lounge/v1/manifest.json',
      ...additionalPacks.map(
        ({ directory }) => 'studio/amber-lounge/' + directory + '/manifest.json',
      ),
    ],
    loungePayloads = [
      ...amberMaps.map((path) => 'studio/amber-lounge/v1/' + path),
      ...additionalPacks.flatMap(({ directory, paths }) =>
        paths.map((path) => 'studio/amber-lounge/' + directory + '/' + path),
      ),
    ]
  try {
    for (const [path, content] of Object.entries(files)) {
      await mkdir(dirname(join(directory, path)), { recursive: true })
      await writeFile(join(directory, path), content)
    }
    const receipt = await inspectSupportAssets(directory)
    assert.deepEqual(
      receipt.map((file) => file.path),
      Object.keys(files).sort(),
    )
    for (const file of receipt)
      assert.deepEqual(
        { bytes: file.bytes, sha256: file.sha256 },
        await fileDigest(join(directory, file.path)),
      )
    await writeFile(join(directory, 'covers/product.png'), 'changed cover')
    assert.notDeepEqual(await inspectSupportAssets(directory), receipt)
    for (const path of [
      'draco/draco_decoder.wasm',
      'covers/nested/product.svg',
      'models/denoise/rt_hdr_alb_nrm.tza',
      ...loungeManifests,
      ...loungePayloads,
    ]) {
      await writeFile(
        join(directory, path),
        'version https://git-lfs.github.com/spec/v1\noid sha256:123\nsize 100000\n',
      )
      await assert.rejects(inspectSupportAssets(directory), /Git LFS/)
      await writeFile(join(directory, path), files[path])
    }
    for (const path of [...loungeManifests, ...loungePayloads]) {
      const target = join(directory, path)
      await rm(target)
      await assert.rejects(inspectSupportAssets(directory), { code: 'ENOENT' })
      await writeFile(target, files[path])
    }
    for (const path of loungePayloads) {
      const target = join(directory, path)
      const content = files[path]
      const corrupted = Buffer.from(content)
      corrupted[0] ^= 1 // Equal length: this must exercise the digest check.
      await writeFile(target, corrupted)
      await assert.rejects(inspectSupportAssets(directory), /SHA-256/)
      await writeFile(target, content)
    }
    await writeFile(join(directory, 'models/denoise/rt_hdr_alb_nrm.tza'), 'altered weights')
    await assert.rejects(inspectSupportAssets(directory), /SHA-256/)
    await writeFile(
      join(directory, 'models/denoise/rt_hdr_alb_nrm.tza'),
      files['models/denoise/rt_hdr_alb_nrm.tza'],
    )
    await rm(join(directory, 'draco/draco_decoder.wasm'))
    await assert.rejects(inspectSupportAssets(directory), /必要的本地解码器/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('shipped spatial and layer manifests obey the delivery contract and preserve distance provenance', async () => {
  for (const pack of ['spatial-v1', 'layers-v1']) {
    const path = fileURLToPath(
        new URL('../../public/studio/amber-lounge/' + pack + '/manifest.json', import.meta.url),
      ),
      manifest = JSON.parse(await readFile(path, 'utf8')),
      receipt = await inspectManifest(path)
    assert.equal(receipt.files, pack === 'spatial-v1' ? 2 : 3)
    if (pack === 'spatial-v1') {
      const distance = manifest.files.find((record) => record.path === manifest.distance.file)
      assert.equal(manifest.entry, manifest.distance.file)
      assert.equal(distance.bytes, manifest.distance.bytes)
      assert.equal(distance.sha256, manifest.distance.sha256)
      assert.equal(distance.bytes, manifest.distance.width * manifest.distance.height * 4)
      assert.equal(manifest.distance.units, 'relative-not-metres')
      assert.equal(manifest.source.altered, false)
      assert.equal(manifest.estimator.networkModified, false)
      assert.ok(manifest.inference.nativeStatistics.quantiles['0.98'] > 0)
      assert.ok(manifest.files.some((record) => record.path === 'DA2-LICENSE.txt'))
    }
  }
})

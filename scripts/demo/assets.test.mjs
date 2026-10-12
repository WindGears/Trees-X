import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

test('support receipts include decoders, covers and validated denoiser files; reject LFS and altered weights', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'trees-demo-support-'))
  const files = {
    'draco/draco_wasm_wrapper.js': 'decoder wrapper',
    'draco/draco_decoder.wasm': 'decoder wasm',
    'draco/draco_decoder.js': 'decoder fallback',
    'covers/product.png': 'product cover',
    'covers/nested/product.svg': '<svg/>',
    'models/denoise/rt_hdr_alb_nrm.tza': 'guided denoise weights',
    'models/denoise/LICENSE.txt': 'Apache-2.0',
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
  try {
    await mkdir(join(directory, 'draco'))
    await mkdir(join(directory, 'covers', 'nested'), { recursive: true })
    await mkdir(join(directory, 'models', 'denoise'), { recursive: true })
    for (const [path, content] of Object.entries(files))
      await writeFile(join(directory, path), content)
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
    ]) {
      await writeFile(
        join(directory, path),
        'version https://git-lfs.github.com/spec/v1\noid sha256:123\nsize 100000\n',
      )
      await assert.rejects(inspectSupportAssets(directory), /Git LFS/)
      await writeFile(join(directory, path), files[path])
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

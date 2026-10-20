/* global structuredClone */
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import {
  cappedDimensions,
  createRuntimeGlb,
  deriveRuntimeDocument,
  matchesReusableKtxSample,
} from './build-runtime-model.mjs'
import { readGlb } from '../asset-package.mjs'

function fixture() {
  return {
    asset: { version: '2.0' },
    nodes: [{ name: 'stable-part', mesh: 0, translation: [1, 2, 3] }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' }],
    buffers: [{ byteLength: 36 }],
    bufferViews: [{ buffer: 0, byteLength: 36 }],
    samplers: [{ minFilter: 9987, magFilter: 9729 }],
    images: [{ uri: 'shared.png' }, { uri: 'unused-color.png' }],
    textures: [
      { source: 0, sampler: 0 },
      { source: 1, sampler: 0 },
    ],
    materials: [
      {
        name: 'Reventon / fixed / 18581',
        pbrMetallicRoughness: {
          baseColorTexture: { index: 1, texCoord: 1 },
          metallicRoughnessTexture: { index: 0, texCoord: 1 },
          roughnessFactor: 0.61,
        },
        normalTexture: { index: 0, texCoord: 1 },
        occlusionTexture: { index: 0, texCoord: 2 },
        extensions: { KHR_materials_sheen: { sheenColorTexture: { index: 0 } } },
      },
    ],
    extensionsUsed: ['KHR_materials_sheen'],
    scenes: [{ nodes: [0] }],
    scene: 0,
  }
}

test('maximum dimension caps only large source images and preserves aspect without upscaling', () => {
  assert.deepEqual(cappedDimensions(8192, 8192), { width: 4096, height: 4096 })
  assert.deepEqual(cappedDimensions(8192, 2048), { width: 4096, height: 1024 })
  assert.deepEqual(cappedDimensions(4096, 4096), { width: 4096, height: 4096 })
  assert.deepEqual(cappedDimensions(1024, 416), { width: 1024, height: 416 })
  for (const value of [0, -1, NaN, Infinity, 1.5]) assert.throws(() => cappedDimensions(value, 12))
})

test('sample reuse locks transfer, quality, mip filter, wrap, zstd and excludes normal packing or RDO changes', () => {
  const expected = { inputSha256: 'same', width: 4096, height: 4096, transfer: 'linear' }
  const sample = {
    inputSha256: 'same',
    width: 4096,
    height: 4096,
    semantic: 'normal',
    command: {
      args: [
        'create',
        '--format',
        'R8G8B8A8_UNORM',
        '--assign-tf',
        'linear',
        '--assign-primaries',
        'none',
        '--assign-texcoord-origin',
        'top-left',
        '--encode',
        'uastc',
        '--uastc-quality',
        '4',
        '--threads',
        '2',
        '--generate-mipmap',
        '--mipmap-filter',
        'lanczos4',
        '--mipmap-wrap',
        'clamp',
        '--zstd',
        '18',
        'source.png',
        'output.ktx2',
      ],
    },
  }
  assert.equal(matchesReusableKtxSample(sample, expected), true)
  for (const [flag, value] of [
    ['--mipmap-filter', 'box'],
    ['--mipmap-wrap', 'wrap'],
    ['--zstd', '10'],
    ['--uastc-quality', '3'],
    ['--assign-tf', 'srgb'],
  ]) {
    const bad = structuredClone(sample)
    bad.command.args[bad.command.args.indexOf(flag) + 1] = value
    assert.equal(matchesReusableKtxSample(bad, expected), false)
  }
  for (const flag of ['--normal-mode', '--normalize', '--uastc-rdo', '--width', '--scale']) {
    const bad = structuredClone(sample)
    bad.command.args.push(flag, '1')
    assert.equal(matchesReusableKtxSample(bad, expected), false)
  }
  assert.equal(matchesReusableKtxSample(sample, { ...expected, width: 2048 }), false)
})

test('shared color and data images split transfers without altering texture-info UV/channel fields', () => {
  const source = fixture(),
    before = structuredClone(source),
    result = deriveRuntimeDocument(source)
  assert.deepEqual(source, before)
  assert.equal(result.tasks.length, 2)
  assert.deepEqual(
    result.tasks.map((item) => item.transfer),
    ['linear', 'srgb'],
  )
  const material = result.document.materials[0]
  assert.equal(material.normalTexture.texCoord, 1)
  assert.equal(material.occlusionTexture.texCoord, 2)
  assert.equal(material.pbrMetallicRoughness.metallicRoughnessTexture.texCoord, 1)
  assert.equal(material.pbrMetallicRoughness.roughnessFactor, 0.61)
  assert.equal(material.normalTexture.index, material.occlusionTexture.index)
  assert.notEqual(
    material.extensions.KHR_materials_sheen.sheenColorTexture.index,
    material.normalTexture.index,
  )
  assert.deepEqual(result.document.nodes, source.nodes)
  assert.deepEqual(result.document.samplers, source.samplers)
  for (const texture of result.document.textures) {
    assert.equal(texture.source, undefined)
    assert.ok(Number.isInteger(texture.extensions.KHR_texture_basisu.source))
  }
})

test('suede repair applies only reviewed material names, drops dead color and preserves non-color inputs', () => {
  const source = fixture()
  source.materials.push({
    name: 'Unrelated / 18581',
    pbrMetallicRoughness: { baseColorFactor: [0.3, 0.4, 0.5, 1] },
  })
  const result = deriveRuntimeDocument(source),
    material = result.document.materials[0]
  assert.deepEqual(material.pbrMetallicRoughness.baseColorFactor, [0.025, 0.026, 0.028, 1])
  assert.equal(material.pbrMetallicRoughness.baseColorTexture, undefined)
  assert.deepEqual(result.document.materials[1], source.materials[1])
  assert.deepEqual(result.excludedImages, [{ uri: 'unused-color.png', sourceImage: 1 }])
  assert.deepEqual(result.tasks[0].semantics, ['data', 'normal'])
})

test('rejects embedded images, unsafe paths and precompressed source textures rather than silently changing them', () => {
  for (const change of [
    (source) => {
      source.images[0] = { bufferView: 0 }
    },
    (source) => {
      source.images[0].uri = '../outside.png'
    },
    (source) => {
      source.textures[0].extensions = { KHR_texture_basisu: { source: 0 } }
    },
  ]) {
    const source = fixture()
    change(source)
    assert.throws(() => deriveRuntimeDocument(source))
  }
})

test('real Reventon derives 74 role images, three suede repairs, unchanged geometry BIN/nodes and basis bindings', async () => {
  const original = await readFile('public/models/reventon/reventon.glb'),
    source = readGlb(original)
  const result = deriveRuntimeDocument(source),
    glb = createRuntimeGlb(original, result.document)
  assert.equal(result.tasks.length, 74)
  assert.equal(result.repairs.length, 3)
  assert.equal(result.excludedImages.length, 1)
  assert.equal(result.excludedImages[0].uri, 'texture-ec834405f48fe5bac330.png')
  assert.deepEqual(readGlb(glb).nodes, source.nodes)
  assert.equal(result.document.materials.length, source.materials.length)
  assert.ok(result.document.extensionsRequired.includes('KHR_texture_basisu'))
  assert.equal(new Set(result.tasks.map((task) => task.output)).size, result.tasks.length)
  for (const mapping of result.mappings) assert.ok(result.document.textures[mapping.texture])
  const bad = structuredClone(result.document)
  bad.nodes[0].name = 'changed'
  assert.throws(() => createRuntimeGlb(original, bad), /Unchanged nodes/)
})

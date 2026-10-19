import assert from 'node:assert/strict'
import test from 'node:test'
import { glbWithJson } from '../asset-package.mjs'
import {
  comparisonProduct,
  createFixtureGlb,
  deriveMaterialFixture,
  fixtureWorldBounds,
  verifyFixtureGeometry,
} from './material-fixture.mjs'
import { buildMaterialComparisons, mipAllocation } from './build-material-comparison.mjs'

function source() {
  return {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [
      { name: 'root', children: [1, 2], translation: [3, 0, 0] },
      { name: 'selected', mesh: 0, translation: [0, 2, 0] },
      { name: 'unrelated', mesh: 1 },
    ],
    meshes: [
      {
        name: 'selected',
        primitives: [
          { material: 0, attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3 },
        ],
      },
      { name: 'unrelated', primitives: [{ material: 1, attributes: { POSITION: 0 }, indices: 3 }] },
    ],
    materials: [
      {
        name: 'test / 17',
        extras: { source_vpb_material_id: 17 },
        pbrMetallicRoughness: { baseColorTexture: { index: 0 }, roughnessFactor: 0.55 },
        normalTexture: { index: 0, texCoord: 1 },
      },
      {
        name: 'unrelated',
        extras: { source_vpb_material_id: 23 },
        pbrMetallicRoughness: { baseColorTexture: { index: 1 } },
      },
    ],
    textures: [
      { source: 0, sampler: 0 },
      { source: 1, sampler: 0 },
    ],
    images: [{ uri: 'shared.png' }, { uri: 'unrelated.png' }],
    samplers: [{ minFilter: 9987, wrapS: 10497, wrapT: 10497 }],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 3,
        type: 'VEC3',
        min: [0, 0, 0],
        max: [1, 1, 1],
      },
      { bufferView: 1, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 2, componentType: 5126, count: 3, type: 'VEC2' },
      { bufferView: 3, componentType: 5123, count: 3, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36 },
      { buffer: 0, byteOffset: 36, byteLength: 36 },
      { buffer: 0, byteOffset: 72, byteLength: 24 },
      { buffer: 0, byteOffset: 96, byteLength: 6 },
    ],
    buffers: [{ byteLength: 104 }],
  }
}

function glb(document) {
  const seed = Buffer.alloc(28 + 104)
  seed.writeUInt32LE(0x46546c67, 0)
  seed.writeUInt32LE(2, 4)
  seed.writeUInt32LE(seed.length, 8)
  seed.writeUInt32LE(0, 12)
  seed.writeUInt32LE(0x4e4f534a, 16)
  seed.writeUInt32LE(104, 20)
  seed.writeUInt32LE(0x004e4942, 24)
  return glbWithJson(seed, document)
}

const colorSample = { role: 'selected-color', image: 0, source: 'shared.png', semantic: 'color' }

test('keeps exact selected geometry and transforms while pruning unrelated references', () => {
  const original = source(),
    bytes = glb(original),
    fixture = createFixtureGlb(bytes, { materialIds: [17] })
  assert.equal(fixture.document.meshes.length, 1)
  assert.equal(fixture.document.materials.length, 1)
  assert.equal(fixture.document.images.length, 1)
  assert.equal(fixture.document.textures.length, 1)
  assert.equal(fixture.document.nodes.length, 3)
  assert.equal(fixture.document.nodes[2].mesh, undefined)
  assert.deepEqual(original.nodes[2].mesh, 1, 'pure derivation must not mutate source')
  assert.equal(fixture.verification.selectedTrianglePositionNormalTangentUvError, 0)
  assert.equal(fixture.verification.binAndAccessorBytesIdentical, true)
  assert.equal(fixture.record.triangles, 1)
  assert.deepEqual(fixtureWorldBounds(fixture.document).min, [3, 2, 0])
  assert.deepEqual(fixtureWorldBounds(fixture.document).max, [4, 3, 1])
})

test('splits mixed color/data usage before applying a color-only KTX replacement', () => {
  const fixture = deriveMaterialFixture(source(), {
      materialIds: [17],
      samples: [colorSample],
      replacementRoles: ['selected-color'],
    }),
    material = fixture.document.materials[0],
    color = fixture.document.textures[material.pbrMetallicRoughness.baseColorTexture.index],
    normal = fixture.document.textures[material.normalTexture.index]
  assert.equal(color.source, undefined)
  assert.equal(
    fixture.document.images[color.extensions.KHR_texture_basisu.source].uri,
    'selected-color.ktx2',
  )
  assert.equal(fixture.document.images[normal.source].uri, 'shared.png')
  assert.equal(material.normalTexture.texCoord, 1)
  assert.equal(material.pbrMetallicRoughness.roughnessFactor, 0.55)
  assert.deepEqual(fixture.document.extensionsRequired, ['KHR_texture_basisu'])
  assert.deepEqual(
    fixture.record.bindings.map((binding) => binding.transfer),
    ['srgb', 'linear'],
  )
})

test('rejects missing material, unreferenced role and ambiguous or wrong sample sources', () => {
  assert.throws(
    () => deriveMaterialFixture(source(), { materialIds: [99] }),
    /Missing source material/,
  )
  assert.throws(
    () => deriveMaterialFixture(source(), { materialIds: [17], replacementRoles: ['missing'] }),
    /Missing KTX sample/,
  )
  assert.throws(
    () =>
      deriveMaterialFixture(source(), {
        materialIds: [17],
        samples: [{ ...colorSample, source: 'wrong.png' }],
        replacementRoles: ['selected-color'],
      }),
    /Sample source mismatch/,
  )
  assert.throws(
    () =>
      deriveMaterialFixture(source(), {
        materialIds: [17],
        samples: [{ ...colorSample, image: 1, source: 'unrelated.png' }],
        replacementRoles: ['selected-color'],
      }),
    /Unreferenced KTX sample/,
  )
  assert.throws(
    () =>
      deriveMaterialFixture(source(), {
        materialIds: [17],
        samples: [colorSample, { ...colorSample, role: 'second-color' }],
        replacementRoles: ['selected-color', 'second-color'],
      }),
    /Ambiguous/,
  )
})

test('fails byte proof for changed BIN and changed node transforms', () => {
  const bytes = glb(source()),
    fixture = createFixtureGlb(bytes, { materialIds: [17] }),
    corrupted = Buffer.from(fixture.bytes)
  corrupted[corrupted.length - 1] ^= 1
  assert.throws(() => verifyFixtureGeometry(bytes, corrupted, fixture.record), /original BIN/)
  fixture.document.nodes[1].translation[0] += 0.1
  assert.throws(
    () => verifyFixtureGeometry(bytes, glbWithJson(bytes, fixture.document), fixture.record),
    /transform\/hierarchy/,
  )
})

test('retains source stage and behavior while matching camera/default perspective across variants', () => {
  const original = {
      presentation: {
        source: { finishMaterials: ['old'], bundle: {} },
        stage: { environmentFile: 'studio.exr', exposure: 1.3 },
        camera: {},
        views: [
          { id: 'perspective', position: [], target: [] },
          { id: 'side', position: [4, 2, 0], target: [0, 0, 0] },
        ],
        actions: [{ id: 'doors' }],
        hotspots: [{ node: 'root' }],
      },
    },
    bounds = { min: [3, 2, 0], max: [4, 3, 1] },
    fixture = comparisonProduct(original, { id: 'test', label: 'test' }, bounds, { id: 'new' }, [
      'actual',
    ])
  assert.equal(fixture.fixture, true)
  assert.deepEqual(fixture.presentation.stage, original.presentation.stage)
  assert.deepEqual(fixture.presentation.actions, original.presentation.actions)
  assert.deepEqual(fixture.presentation.hotspots, original.presentation.hotspots)
  assert.deepEqual(fixture.presentation.views[1], original.presentation.views[1])
  assert.deepEqual(fixture.presentation.views[0].position, fixture.presentation.camera.position)
  assert.deepEqual(fixture.presentation.source.finishMaterials, ['actual'])
  assert.deepEqual(original.presentation.source.finishMaterials, ['old'])
})

test('estimates complete mip blocks without interpreting file bytes as VRAM', () => {
  assert.equal(mipAllocation(4, 4), 84)
  assert.equal(mipAllocation(4, 4, 16, 4), 48)
  assert.equal(mipAllocation(4096, 4096), 89478484)
})

test('refuses any output outside ignored comparison directory before reading assets', async () => {
  await assert.rejects(
    buildMaterialComparisons({ output: 'public/models/not-a-fixture' }),
    /ignored comparison directory/,
  )
})

test('the four configured groups cover all six reviewed texture roles', async () => {
  const { materialComparisonGroups } = await import('./material-fixture.mjs'),
    roles = new Set(materialComparisonGroups.flatMap((group) => group.replacements))
  assert.deepEqual(
    [...roles].sort(),
    [
      'seat-color',
      'seat-normal',
      'fixed-ao',
      'taillight-glass-normal',
      'door-grille-alpha-color',
      'door-cabin-leather-color',
    ].sort(),
  )
})

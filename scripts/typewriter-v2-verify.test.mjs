import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import {
  decodeGlb,
  readAccessor,
  verifyGlbPreservation,
  verifyTypewriterV2,
} from './typewriter-v2-verify.mjs'
import sharp from 'sharp'

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
  'base64',
)
const expectations = { parts: 1, surfaces: 2, images: 1, meshes: 2, missingUvMeshes: [1] }
const sourcePositions = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]
const sourceUv = [0, 0, 1, 0, 1, 1, 0, 1]
const sourceIndices = [0, 1, 2, 0, 2, 3]

function encode(document, binary) {
  const raw = Buffer.from(JSON.stringify(document))
  const json = Buffer.concat([raw, Buffer.alloc((4 - (raw.length % 4)) % 4, 32)])
  const bin = Buffer.concat([binary, Buffer.alloc((4 - (binary.length % 4)) % 4)])
  const header = Buffer.alloc(28)
  header.writeUInt32LE(0x46546c67, 0)
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(28 + json.length + bin.length, 8)
  header.writeUInt32LE(json.length, 12)
  header.writeUInt32LE(0x4e4f534a, 16)
  header.writeUInt32LE(bin.length, 20)
  header.writeUInt32LE(0x004e4942, 24)
  return Buffer.concat([header.subarray(0, 20), json, header.subarray(20), bin])
}

function fixture(candidate = false, modify = () => {}) {
  const pieces = [],
    accessors = [],
    bufferViews = []
  let byteLength = 0
  function view(bytes) {
    const padding = Buffer.alloc((4 - (byteLength % 4)) % 4)
    pieces.push(padding)
    byteLength += padding.length
    const index = bufferViews.length
    bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: bytes.length })
    pieces.push(bytes)
    byteLength += bytes.length
    return index
  }
  function accessor(values, width, integer = false) {
    const typed = integer ? Uint16Array.from(values) : Float32Array.from(values)
    const id = accessors.length
    accessors.push({
      bufferView: view(Buffer.from(typed.buffer)),
      componentType: integer ? 5123 : 5126,
      count: values.length / width,
      type: ['SCALAR', 'VEC2', 'VEC3', 'VEC4'][width - 1],
    })
    return id
  }
  // Candidate seam splits and reindexes vertices without changing ordered triangle corners.
  const order = candidate ? [2, 5, 0, 4, 1, 3] : [0, 1, 2, 3]
  const corners = candidate ? sourceIndices : [0, 1, 2, 3]
  const positions = order.flatMap((at) =>
    sourcePositions.slice(corners[at] * 3, corners[at] * 3 + 3),
  )
  const uv = order.flatMap((at) => sourceUv.slice(corners[at] * 2, corners[at] * 2 + 2))
  const normals = order.flatMap(() => [0, 0, 1])
  const tangents = order.flatMap(() => [1, 0, 0, -1])
  const data = {
    positions,
    uv,
    normals,
    tangents,
    uv1: null,
    addedUv: [0, 0, 1, 0, 0, 1],
    image: PNG,
    secondImage: PNG,
  }
  modify(data)
  const attributes = {
    POSITION: accessor(data.positions, 3),
    NORMAL: accessor(data.normals, 3),
    TEXCOORD_0: accessor(data.uv, 2),
  }
  if (candidate && data.tangents) attributes.TANGENT = accessor(data.tangents, 4)
  if (candidate && data.uv1) attributes.TEXCOORD_1 = accessor(data.uv1, 2)
  const triAttributes = {
    POSITION: accessor([0, 0, 0, 1, 0, 0, 0, 1, 0], 3),
    NORMAL: accessor([0, 0, 1, 0, 0, 1, 0, 0, 1], 3),
  }
  if (candidate && data.addedUv) triAttributes.TEXCOORD_0 = accessor(data.addedUv, 2)
  const document = {
    asset: { version: '2.0' },
    buffers: [],
    bufferViews,
    accessors,
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [
      { name: 'root', children: [1] },
      { name: 'part-000', translation: [1, 2, 3], children: [2, 3] },
      { name: 'part-000-surface-0', mesh: 0 },
      { name: 'part-000-surface-1', mesh: 1 },
    ],
    meshes: [
      {
        primitives: [
          {
            attributes,
            indices: accessor(candidate ? [2, 4, 0, 5, 3, 1] : sourceIndices, 1, true),
            material: 0,
          },
        ],
      },
      { primitives: [{ attributes: triAttributes, material: 1 }] },
    ],
    materials: [
      { name: 'enamel' },
      {
        name: 'glyph',
        alphaMode: 'BLEND',
        pbrMetallicRoughness: { baseColorTexture: { index: 0 } },
      },
    ],
    textures: [{ source: 0 }],
    images: [{ mimeType: 'image/png', bufferView: view(data.image) }],
  }
  if (candidate) {
    document.images.push({ mimeType: 'image/png', bufferView: view(data.secondImage) })
    document.textures.push({ source: 1 })
    document.materials[0].normalTexture = { index: 1, ...(data.uv1 ? { texCoord: 1 } : {}) }
  }
  document.buffers = [{ byteLength }]
  return { document, bytes: encode(document, Buffer.concat(pieces)) }
}

const verify = (candidate, options = {}) =>
  verifyGlbPreservation(fixture().bytes, candidate.bytes, { expectations, ...options })

async function brandFixture(options = {}) {
  const sourceAsset = decodeGlb(
    await readFile('public/models/bundles/kimi-typewriter/v1/model.glb'),
  )
  const originalView = sourceAsset.document.bufferViews[sourceAsset.document.images[50].bufferView]
  const originalImage = sourceAsset.binary.subarray(
    originalView.byteOffset,
    originalView.byteOffset + originalView.byteLength,
  )
  const candidateImage = await sharp({
    create: {
      width: options.width ?? 1024,
      height: 416,
      channels: 4,
      background: { r: 220, g: 220, b: 220, alpha: options.opaque ? 1 : 0 },
    },
  })
    .composite([
      {
        input: await sharp({
          create: {
            width: 100,
            height: 50,
            channels: 4,
            background: { r: 0, g: 0, b: 0, alpha: 1 },
          },
        })
          .png()
          .toBuffer(),
        left: 20,
        top: 20,
      },
    ])
    .png()
    .toBuffer()
  const original = fixture(),
    candidate = fixture(true)
  function withImages(value, branding) {
    const asset = decodeGlb(value.bytes),
      document = value.document
    const extra = [],
      length = { current: asset.binary.length }
    const appendImage = (bytes) => {
      const padding = Buffer.alloc((4 - (length.current % 4)) % 4)
      extra.push(padding)
      length.current += padding.length
      const view = document.bufferViews.length
      document.bufferViews.push({ buffer: 0, byteOffset: length.current, byteLength: bytes.length })
      extra.push(bytes)
      length.current += bytes.length
      return { mimeType: 'image/png', bufferView: view }
    }
    document.images = Array.from({ length: 50 }, () => ({ ...document.images[0] }))
    document.images.push(appendImage(branding))
    document.textures[0].source = 50
    if (document.textures[1]) document.textures[1].source = 1
    document.materials[1].name = 'decal-62'
    document.buffers[0].byteLength = length.current
    return { document, bytes: encode(document, Buffer.concat([asset.binary, ...extra])) }
  }
  const source = withImages(original, originalImage),
    next = withImages(candidate, candidateImage)
  return {
    source,
    candidate: next,
    expectations: { ...expectations, images: 51 },
    declaration: {
      sourceIndex: 50,
      sourceMaterial: 'decal-62',
      text: 'WindGear',
      sourceSha256: createHash('sha256').update(originalImage).digest('hex'),
      candidateSha256: createHash('sha256').update(candidateImage).digest('hex'),
    },
  }
}

test('image50 replacement needs explicit authorization and records only 50 preserved originals', async () => {
  const f = await brandFixture()
  const unapproved = await verifyGlbPreservation(f.source.bytes, f.candidate.bytes, {
    expectations: f.expectations,
  })
  assert.equal(unapproved.passed, false)
  const approved = await verifyGlbPreservation(f.source.bytes, f.candidate.bytes, {
    expectations: f.expectations,
    brandReplacement: f.declaration,
  })
  assert.equal(approved.passed, true, approved.failures.join('\n'))
  assert.equal(approved.sourceImagesPreserved, 50)
  assert.equal(approved.brandReplacement.candidateSha256, f.declaration.candidateSha256)
  assert.equal(approved.brandReplacement.width, 1024)
})
test('WindGear exception cannot change another image, sampler, glyph parameters or binding', async () => {
  const f = await brandFixture()
  for (const change of [
    (doc) => {
      doc.images[0] = { ...doc.images[50] }
    },
    (doc) => {
      doc.materials[1].pbrMetallicRoughness.baseColorTexture.texCoord = 1
    },
    (doc) => {
      doc.materials[1].alphaMode = 'MASK'
    },
    (doc) => {
      doc.materials[0].emissiveTexture = { index: 0 }
    },
    (doc) => {
      doc.samplers = [{ wrapS: 33071 }]
      doc.textures[0].sampler = 0
    },
  ]) {
    const doc = JSON.parse(JSON.stringify(f.candidate.document)),
      { binary } = decodeGlb(f.candidate.bytes)
    change(doc)
    const result = await verifyGlbPreservation(f.source.bytes, encode(doc, binary), {
      expectations: f.expectations,
      brandReplacement: f.declaration,
    })
    assert.equal(result.passed, false)
  }
})
test('rejects invalid WindGear declaration and wrong dimensions or opaque PNG', async () => {
  const f = await brandFixture()
  for (const declaration of [
    { ...f.declaration, sourceIndex: 49 },
    { ...f.declaration, sourceMaterial: 'glyph' },
    { ...f.declaration, text: 'Other' },
    { ...f.declaration, sourceSha256: '0'.repeat(64) },
    { ...f.declaration, candidateSha256: '0'.repeat(64) },
    true,
  ]) {
    assert.equal(
      (
        await verifyGlbPreservation(f.source.bytes, f.candidate.bytes, {
          expectations: f.expectations,
          brandReplacement: declaration,
        })
      ).passed,
      false,
    )
  }
  for (const options of [{ width: 1023 }, { opaque: true }]) {
    const wrong = await brandFixture(options)
    assert.equal(
      (
        await verifyGlbPreservation(wrong.source.bytes, wrong.candidate.bytes, {
          expectations: wrong.expectations,
          brandReplacement: wrong.declaration,
        })
      ).passed,
      false,
    )
  }
})
test('package authorization requires the exact production-record declaration', async () => {
  const f = await brandFixture(),
    root = await mkdtemp(join(tmpdir(), 'trees-v2-verifier-'))
  try {
    const source = join(root, 'v1'),
      candidate = join(root, 'v2')
    await Promise.all([mkdir(source), mkdir(candidate)])
    await Promise.all([
      writeFile(join(source, 'model.glb'), f.source.bytes),
      writeFile(join(candidate, 'model.glb'), f.candidate.bytes),
      writeFile(join(source, 'rig.json'), '{}'),
      writeFile(join(candidate, 'rig.json'), '{}'),
      writeFile(
        join(candidate, 'production-record.json'),
        JSON.stringify({ brandReplacement: f.declaration }),
      ),
    ])
    const result = await verifyTypewriterV2(source, candidate, {
      expectations: f.expectations,
      brandReplacement: true,
    })
    assert.equal(result.passed, true, result.failures.join('\n'))
    await assert.rejects(
      verifyTypewriterV2(source, candidate, {
        expectations: f.expectations,
        brandReplacement: { ...f.declaration, text: 'Other' },
      }),
      /differs/,
    )
    await writeFile(join(candidate, 'production-record.json'), '{}')
    await assert.rejects(
      verifyTypewriterV2(source, candidate, {
        expectations: f.expectations,
        brandReplacement: true,
      }),
      /requires/,
    )
  } finally {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()))
    assert.ok(basename(root).startsWith('trees-v2-verifier-'))
    await rm(root, { recursive: true, force: true })
  }
})
test('accepts seam vertex splitting and index rewrite while preserving every triangle corner', async () => {
  const result = await verify(fixture(true))
  assert.equal(result.passed, true, result.failures.join('\n'))
  assert.equal(result.meshes[0].sourceVertices, 4)
  assert.equal(result.meshes[0].candidateVertices, 6)
  assert.equal(result.totals.maxPositionError, 0)
  assert.equal(result.totals.maxNormalError, 0)
  assert.equal(result.totals.maxExistingUvError, 0)
  assert.equal(result.totals.tangentRequiredPrimitives, 1)
  assert.equal(result.glyphMaterials, 1)
})
test('rejects changed geometry and normals independently of accessor IDs', async () => {
  for (const field of ['positions', 'normals']) {
    const result = await verify(
      fixture(true, (data) => {
        data[field][0] += 1e-4
      }),
    )
    assert.equal(result.passed, false)
    assert.ok(result.failures.some((message) => message.includes('POSITION/NORMAL')))
  }
})
test('preserves existing UV exactly rather than accepting the geometry tolerance', async () => {
  const result = await verify(
    fixture(true, (data) => {
      data.uv[0] += 1e-7
    }),
  )
  assert.equal(result.passed, false)
  assert.ok(result.failures.some((message) => message.includes('UV changed')))
})
test('rejects missing newly required UV and tangent attributes', async () => {
  const withoutUv = await verify(
    fixture(true, (data) => {
      data.addedUv = null
    }),
  )
  assert.equal(withoutUv.passed, false)
  const withoutTangents = await verify(
    fixture(true, (data) => {
      data.tangents = null
    }),
  )
  assert.equal(withoutTangents.passed, false)
  assert.ok(withoutTangents.failures.some((message) => message.includes('Required TANGENT')))
})
test('checks tangent unit length, normal orthogonality and signed handedness', async () => {
  const malformed = [
    [2, 0, 0, -1],
    [Math.SQRT1_2, 0, Math.SQRT1_2, -1],
    [1, 0, 0, 0],
    [1, 0, 0, 1],
  ]
  for (const tangent of malformed) {
    const result = await verify(
      fixture(true, (data) => {
        data.tangents.splice(0, 4, ...tangent)
      }),
    )
    assert.equal(result.passed, false, JSON.stringify(tangent))
  }
})
test('independently validates Mikk w without rejecting preserved opposite-winding normals', async () => {
  const flipNormal = (data) => {
    for (let index = 2; index < data.normals.length; index += 3) data.normals[index] = -1
  }
  const result = await verifyGlbPreservation(
    fixture(false, flipNormal).bytes,
    fixture(true, flipNormal).bytes,
    { expectations },
  )
  assert.equal(result.passed, true, result.failures.join('\n'))
  assert.equal(result.totals.tangentHandednessMismatches, 0)
  assert.equal(result.totals.sourceNormalsOpposeWindingCorners, 6)
  assert.equal(result.totals.tangentDerivativeHandednessMismatches, 6)
})
test('canonical handedness uses UV1 even when preserved UV0 has the opposite orientation', async () => {
  const wrong = fixture(true, (data) => {
    data.uv1 = data.uv.map((value, index) => (index % 2 === 0 ? -value : value))
  })
  const rejected = await verify(wrong)
  assert.equal(rejected.passed, false)
  assert.equal(rejected.totals.tangentHandednessMismatches, 6)
  const correct = fixture(true, (data) => {
    data.uv1 = data.uv.map((value, index) => (index % 2 === 0 ? -value : value))
    data.tangents = data.tangents.map((value, index) =>
      index % 4 === 0 ? -value : index % 4 === 3 ? -value : value,
    )
  })
  assert.equal((await verify(correct)).passed, true)
})
test('rejects stable node identity, binding, hierarchy and transform changes', async () => {
  for (const change of [
    (doc) => {
      doc.nodes[1].translation[0] = 2
    },
    (doc) => {
      doc.nodes[2].name = 'part-000-surface-9'
    },
    (doc) => {
      doc.nodes[1].children.reverse()
    },
    (doc) => {
      doc.nodes[2].mesh = 1
    },
  ]) {
    const input = fixture(true),
      { binary } = decodeGlb(input.bytes)
    change(input.document)
    assert.equal((await verify({ bytes: encode(input.document, binary) })).passed, false)
  }
})
test('rejects changed original image bytes and glyph rebinding despite retaining original PNG', async () => {
  const changed = await verify(
    fixture(true, (data) => {
      data.image = Buffer.from('changed')
      data.secondImage = Buffer.from('other')
    }),
  )
  assert.equal(changed.passed, false)
  const input = fixture(true, (data) => {
    data.secondImage = Buffer.from('other')
  })
  const { binary } = decodeGlb(input.bytes)
  input.document.materials[1].pbrMetallicRoughness.baseColorTexture.index = 1
  const rebound = await verify({ bytes: encode(input.document, binary) })
  assert.equal(rebound.passed, false)
  assert.ok(rebound.failures.some((message) => message.includes('Glyph material or binding')))
})
test('reports degenerate UV triangles without claiming handedness proof for them', async () => {
  const input = fixture(true, (data) => {
    data.uv.fill(0)
  })
  // This intentionally changes an existing UV; tangent diagnostics still identify degeneracy.
  const result = await verify(input)
  assert.equal(result.passed, false)
  assert.equal(result.totals.degenerateUvTriangles, 2)
  assert.equal(result.totals.tangentHandednessMismatches, 0)
  assert.equal(result.totals.tangentHandednessUnverifiedCorners, 6)
  assert.equal(result.totals.tangentHandednessVerifiedCorners, 0)
})
test('undefined UV orientation does not waive tangent unit/orthogonality/w validation', async () => {
  for (const tangent of [
    [0, 0, 0, -1],
    [0, 0, 1, -1],
    [1, 0, 0, 0],
  ]) {
    const result = await verify(
      fixture(true, (data) => {
        data.uv.fill(0)
        data.tangents.splice(0, 4, ...tangent)
      }),
    )
    assert.equal(result.totals.tangentHandednessUnverifiedCorners, 6)
    assert.ok(result.failures.some((message) => message.includes('unit/orthogonal')))
  }
})
test('tiny nondegenerate UV triangles still require canonical handedness', async () => {
  const result = await verify(
    fixture(true, (data) => {
      data.uv1 = data.uv.map((value, index) => value * (index % 2 === 0 ? -1e-8 : 1e-8))
    }),
  )
  assert.equal(result.passed, false)
  assert.equal(result.totals.degenerateUvTriangles, 0)
  assert.equal(result.totals.tangentHandednessUnverifiedCorners, 0)
  assert.equal(result.totals.tangentHandednessVerifiedCorners, 6)
  assert.equal(result.totals.tangentHandednessMismatches, 6)
})
test('rejects newly added UV that collapses a real triangle', async () => {
  const result = await verify(
    fixture(true, (data) => {
      data.addedUv.fill(0)
    }),
  )
  assert.equal(result.passed, false)
  assert.equal(result.totals.newlyAddedUvDegenerateTriangles, 1)
})
test('checks tangents against the actual material UV channel, including texCoord=1', async () => {
  const input = fixture(true),
    { binary } = decodeGlb(input.bytes)
  input.document.materials[0].normalTexture.texCoord = 1
  assert.equal((await verify({ bytes: encode(input.document, binary) })).passed, false)
  input.document.meshes[0].primitives[0].attributes.TEXCOORD_1 =
    input.document.meshes[0].primitives[0].attributes.TEXCOORD_0
  const result = await verify({ bytes: encode(input.document, binary) })
  assert.equal(result.passed, true, result.failures.join('\n'))
  assert.equal(result.meshes[0].tangentTexCoord, 1)
})
test('rejects NaN and malformed GLB bounds rather than hiding invalid measurements', async () => {
  await assert.rejects(
    verify(
      fixture(true, (data) => {
        data.positions[0] = NaN
      }),
    ),
    /Non-finite accessor/,
  )
  const bytes = fixture().bytes
  bytes.writeUInt32LE(bytes.length - 4, 8)
  assert.throws(() => decodeGlb(bytes), /header/)
})
test('reads interleaved normalized accessors with explicit bounds checks', () => {
  const document = {
    buffers: [{ byteLength: 8 }],
    bufferViews: [{ buffer: 0, byteLength: 8, byteStride: 4 }],
    accessors: [
      {
        bufferView: 0,
        byteOffset: 0,
        componentType: 5121,
        normalized: true,
        count: 2,
        type: 'VEC2',
      },
    ],
  }
  const asset = decodeGlb(encode(document, Buffer.from([255, 0, 7, 8, 128, 64, 9, 10])))
  assert.deepEqual([...readAccessor(asset, 0).values], [1, 0, 128 / 255, 64 / 255])
  document.accessors[0].count = 3
  assert.throws(() => readAccessor(decodeGlb(encode(document, asset.binary)), 0), /exceeds/)
})
test('rig bytes must be identical even when both files parse to equivalent JSON', async () => {
  const root = await mkdtemp(join(tmpdir(), 'trees-v2-verifier-'))
  try {
    const source = join(root, 'v1'),
      candidate = join(root, 'v2')
    await Promise.all([mkdir(source), mkdir(candidate)])
    await Promise.all([
      writeFile(join(source, 'model.glb'), fixture().bytes),
      writeFile(join(candidate, 'model.glb'), fixture(true).bytes),
      writeFile(join(source, 'rig.json'), '{"parts":[]}'),
      writeFile(join(candidate, 'rig.json'), '{ "parts": [] }'),
    ])
    const result = await verifyTypewriterV2(source, candidate, { expectations })
    assert.equal(result.passed, false)
    assert.equal(result.rig.identical, false)
  } finally {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()))
    assert.ok(basename(root).startsWith('trees-v2-verifier-'))
    await rm(root, { recursive: true, force: true })
  }
})

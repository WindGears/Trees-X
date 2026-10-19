/* global structuredClone */
import assert from 'node:assert/strict'
import { Box3, Matrix4, Quaternion, Vector3 } from 'three'
import { digest, glbWithJson, readGlb, relativeResource } from '../asset-package.mjs'

export const materialComparisonGroups = [
  {
    id: 'seat-cushion',
    label: '座垫',
    materialIds: [19691],
    replacements: ['seat-color', 'seat-normal', 'fixed-ao'],
  },
  {
    id: 'taillight-glass',
    label: '尾灯玻璃',
    materialIds: [16957],
    replacements: ['taillight-glass-normal'],
  },
  {
    id: 'door-grille',
    label: '双门栅格透明贴层',
    materialIds: [18110],
    replacements: ['door-grille-alpha-color'],
  },
  {
    id: 'door-cabin-leather',
    label: '座舱及双门皮革',
    materialIds: [19771],
    replacements: ['door-cabin-leather-color', 'fixed-ao'],
  },
]

const colorSlots = new Set([
  'baseColorTexture',
  'emissiveTexture',
  'specularColorTexture',
  'sheenColorTexture',
])

export function visitTextureInfos(value, visit, path = '') {
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    const location = path ? `${path}.${key}` : key
    if (key.endsWith('Texture') && child && Number.isInteger(child.index)) {
      visit(child, colorSlots.has(key) ? 'srgb' : 'linear', location)
    } else visitTextureInfos(child, visit, location)
  }
}

function extensionsIn(value, result = new Set()) {
  if (!value || typeof value !== 'object') return result
  for (const [key, child] of Object.entries(value)) {
    if (key === 'extensions' && child && typeof child === 'object')
      for (const extension of Object.keys(child)) result.add(extension)
    if (key !== 'extensionsUsed' && key !== 'extensionsRequired') extensionsIn(child, result)
  }
  return result
}

/** Only JSON references change: selected geometry, axes and the complete BIN stay exact. */
export function deriveMaterialFixture(source, options) {
  const { materialIds, samples = [], replacementRoles = [] } = options
  assert.ok(materialIds.length && materialIds.every(Number.isSafeInteger), 'Explicit material IDs')
  assert.ok(!source.skins?.length && !source.animations?.length, 'Rigid source only')
  assert.ok(
    new Set(samples.map((sample) => sample.role)).size === samples.length,
    'Unique sample roles',
  )
  assert.ok(new Set(replacementRoles).size === replacementRoles.length, 'Unique replacement roles')
  const wanted = new Set(materialIds),
    materialIndices = source.materials.flatMap((material, index) =>
      wanted.has(material.extras?.source_vpb_material_id) ? [index] : [],
    )
  for (const id of wanted)
    assert.ok(
      materialIndices.some((index) => source.materials[index].extras.source_vpb_material_id === id),
      `Missing source material ${id}`,
    )
  const selectedSamples = replacementRoles.map((role) => {
    const sample = samples.find((item) => item.role === role)
    assert.ok(sample, `Missing KTX sample ${role}`)
    assert.match(role, /^[a-z][a-z0-9-]*$/)
    assert.equal(source.images[sample.image]?.uri, sample.source, `Sample source mismatch ${role}`)
    assert.ok(['normal', 'color', 'data'].includes(sample.semantic), 'Explicit texture semantic')
    return sample
  })
  const sampleKeys = selectedSamples.map(
    (sample) => `${sample.image}:${sample.semantic === 'color' ? 'srgb' : 'linear'}`,
  )
  assert.equal(new Set(sampleKeys).size, sampleKeys.length, 'Ambiguous image/transfer samples')
  const materialMap = new Map(materialIndices.map((index, ordinal) => [index, ordinal])),
    meshMappings = [],
    meshes = []
  source.meshes.forEach((mesh, sourceMesh) => {
    const primitiveIndices = mesh.primitives.flatMap((primitive, index) =>
      materialMap.has(primitive.material) ? [index] : [],
    )
    if (!primitiveIndices.length) return
    const candidate = structuredClone(mesh)
    candidate.primitives = primitiveIndices.map((index) => {
      const primitive = structuredClone(mesh.primitives[index])
      primitive.material = materialMap.get(primitive.material)
      assert.equal(primitive.mode ?? 4, 4, 'Triangle source only')
      return primitive
    })
    meshMappings.push({ source: sourceMesh, output: meshes.length, primitives: primitiveIndices })
    meshes.push(candidate)
  })
  assert.ok(meshes.length, 'No matching source geometry')
  const meshMap = new Map(meshMappings.map((entry) => [entry.source, entry.output])),
    document = structuredClone(source)
  document.meshes = meshes
  document.nodes = source.nodes.map((node) => {
    const candidate = structuredClone(node)
    if (Number.isInteger(node.mesh)) {
      if (meshMap.has(node.mesh)) candidate.mesh = meshMap.get(node.mesh)
      else delete candidate.mesh
    }
    return candidate
  })
  document.materials = materialIndices.map((index) => structuredClone(source.materials[index]))
  document.textures = []
  document.images = []
  document.samplers = []
  const textureMap = new Map(),
    imageMap = new Map(),
    samplerMap = new Map(),
    bindings = [],
    imageMappings = [],
    usedRoles = new Set()
  function imageIndex(index, sample) {
    const key = sample ? `${index}:${sample.role}` : `${index}:source`
    if (imageMap.has(key)) return imageMap.get(key)
    const image = structuredClone(source.images[index])
    assert.ok(image, 'Texture image reference exists')
    if (sample) {
      image.uri = `${sample.role}.ktx2`
      image.mimeType = 'image/ktx2'
      delete image.bufferView
    }
    if (image.uri != null) relativeResource(image.uri)
    const output = document.images.length
    imageMap.set(key, output)
    imageMappings.push({ source: index, output, replacement: sample?.role ?? null })
    document.images.push(image)
    return output
  }
  function textureIndex(index, transfer, path, material) {
    const original = source.textures[index]
    assert.ok(original && Number.isInteger(original.source), 'Original PNG source required')
    assert.ok(
      !original.extensions?.KHR_texture_basisu &&
        !original.extensions?.EXT_texture_webp &&
        !original.extensions?.EXT_texture_avif,
      'Do not silently reinterpret precompressed source textures',
    )
    const sample = selectedSamples.find(
      (item) =>
        item.image === original.source &&
        (item.semantic === 'color' ? 'srgb' : 'linear') === transfer,
    )
    if (sample) usedRoles.add(sample.role)
    const key = `${index}:${sample?.role ?? 'source'}`
    if (!textureMap.has(key)) {
      const candidate = structuredClone(original),
        image = imageIndex(original.source, sample)
      if (sample) {
        candidate.extensions = { ...candidate.extensions, KHR_texture_basisu: { source: image } }
        delete candidate.source
      } else candidate.source = image
      if (Number.isInteger(original.sampler)) {
        if (!samplerMap.has(original.sampler)) {
          samplerMap.set(original.sampler, document.samplers.length)
          document.samplers.push(structuredClone(source.samplers[original.sampler]))
        }
        candidate.sampler = samplerMap.get(original.sampler)
      }
      textureMap.set(key, document.textures.length)
      document.textures.push(candidate)
    }
    const output = textureMap.get(key)
    bindings.push({
      material,
      path,
      sourceTexture: index,
      sourceImage: original.source,
      outputTexture: output,
      transfer,
      replacement: sample?.role ?? null,
    })
    return output
  }
  document.materials.forEach((material, index) => {
    visitTextureInfos(material, (info, transfer, path) => {
      info.index = textureIndex(info.index, transfer, path, materialIndices[index])
    })
  })
  for (const role of replacementRoles)
    assert.ok(usedRoles.has(role), `Unreferenced KTX sample ${role}`)
  const usedExtensions = extensionsIn(document)
  document.extensionsUsed = [
    ...new Set([...(source.extensionsUsed ?? []), ...usedExtensions]),
  ].filter((name) => usedExtensions.has(name))
  const required = new Set(source.extensionsRequired ?? [])
  if (usedRoles.size) required.add('KHR_texture_basisu')
  const requiredExtensions = [...required].filter((name) => usedExtensions.has(name))
  if (requiredExtensions.length) document.extensionsRequired = requiredExtensions
  else delete document.extensionsRequired
  if (!document.samplers.length) delete document.samplers
  const triangles = meshes.reduce(
    (sum, mesh) =>
      sum +
      mesh.primitives.reduce(
        (subtotal, primitive) =>
          subtotal + source.accessors[primitive.indices ?? primitive.attributes.POSITION].count / 3,
        0,
      ),
    0,
  )
  return {
    document,
    record: {
      materialIds,
      materialIndices,
      meshes: meshMappings,
      images: imageMappings,
      bindings,
      triangles,
      sourceNodes: source.nodes.length,
      retainedNodes: document.nodes.length,
      selectedMeshNodes: source.nodes.flatMap((node, index) =>
        meshMap.has(node.mesh) ? [index] : [],
      ),
    },
  }
}

/** Proves exact byte/schema correspondence, stronger than a float tolerance test. */
export function verifyFixtureGeometry(sourceBytes, candidateBytes, record) {
  const source = readGlb(sourceBytes),
    candidate = readGlb(candidateBytes),
    sourceTail = sourceBytes.subarray(20 + sourceBytes.readUInt32LE(12)),
    candidateTail = candidateBytes.subarray(20 + candidateBytes.readUInt32LE(12))
  assert.equal(Buffer.compare(sourceTail, candidateTail), 0, 'Complete original BIN must match')
  for (const key of ['accessors', 'bufferViews', 'buffers', 'scenes', 'scene'])
    assert.deepEqual(candidate[key], source[key], key)
  const meshMap = new Map(record.meshes.map((mapping) => [mapping.source, mapping.output])),
    materialMap = new Map(record.materialIndices.map((index, ordinal) => [index, ordinal]))
  assert.equal(candidate.nodes.length, source.nodes.length)
  candidate.nodes.forEach((node, index) => {
    const expected = structuredClone(source.nodes[index])
    if (Number.isInteger(expected.mesh)) {
      if (meshMap.has(expected.mesh)) expected.mesh = meshMap.get(expected.mesh)
      else delete expected.mesh
    }
    assert.deepEqual(node, expected, `Node ${index} transform/hierarchy`)
  })
  for (const mapping of record.meshes) {
    const expected = structuredClone(source.meshes[mapping.source])
    expected.primitives = mapping.primitives.map((index) => {
      const primitive = structuredClone(expected.primitives[index])
      primitive.material = materialMap.get(primitive.material)
      return primitive
    })
    assert.deepEqual(candidate.meshes[mapping.output], expected, `Mesh ${mapping.source} geometry`)
  }
  assert.equal(candidate.meshes.length, record.meshes.length)
  return {
    originalBinSha256: digest(sourceTail),
    candidateBinSha256: digest(candidateTail),
    binAndAccessorBytesIdentical: true,
    selectedTrianglePositionNormalTangentUvError: 0,
    nodeTransformsAndHierarchyIdentical: true,
    triangles: record.triangles,
  }
}

export function createFixtureGlb(sourceBytes, options) {
  const fixture = deriveMaterialFixture(readGlb(sourceBytes), options),
    bytes = glbWithJson(sourceBytes, fixture.document),
    verification = verifyFixtureGeometry(sourceBytes, bytes, fixture.record)
  return { ...fixture, bytes, verification }
}

/** Bounds only choose an A/B camera. They never normalize or alter source geometry. */
export function fixtureWorldBounds(document) {
  const parents = new Map()
  document.nodes.forEach((node, parent) => {
    for (const child of node.children ?? []) {
      assert.ok(!parents.has(child), 'A node must have one parent')
      parents.set(child, parent)
    }
  })
  const matrices = new Map()
  function world(index) {
    if (matrices.has(index)) return matrices.get(index)
    const node = document.nodes[index],
      local = node.matrix
        ? new Matrix4().fromArray(node.matrix)
        : new Matrix4().compose(
            new Vector3().fromArray(node.translation ?? [0, 0, 0]),
            new Quaternion().fromArray(node.rotation ?? [0, 0, 0, 1]),
            new Vector3().fromArray(node.scale ?? [1, 1, 1]),
          ),
      parent = parents.get(index),
      result = parent == null ? local : new Matrix4().multiplyMatrices(world(parent), local)
    matrices.set(index, result)
    return result
  }
  const bounds = new Box3()
  document.nodes.forEach((node, index) => {
    if (node.mesh == null) return
    for (const primitive of document.meshes[node.mesh].primitives) {
      const position = document.accessors[primitive.attributes.POSITION]
      assert.ok(
        position.min?.length === 3 && position.max?.length === 3,
        'Position bounds required',
      )
      const local = new Box3(
        new Vector3().fromArray(position.min),
        new Vector3().fromArray(position.max),
      )
      bounds.union(local.applyMatrix4(world(index)))
    }
  })
  assert.ok(!bounds.isEmpty(), 'Fixture has finite bounds')
  return {
    min: bounds.min.toArray(),
    max: bounds.max.toArray(),
    method:
      'Union of selected local accessor bounds transformed by unchanged source node matrices; conservative, for framing only',
  }
}

export function comparisonProduct(sourceProduct, group, bounds, bundle, materialNames) {
  const product = structuredClone(sourceProduct),
    p = product.presentation,
    center = bounds.min.map((value, axis) => (value + bounds.max[axis]) / 2),
    extent = Math.max(...bounds.max.map((value, axis) => value - bounds.min[axis])),
    position = center.map((value, axis) => value + [0.85, 0.6, -1.15][axis] * extent)
  assert.ok(extent > 0 && Number.isFinite(extent), 'Finite framing extent')
  product.fixture = true
  p.source.bundle = bundle
  p.source.finishMaterials = [...materialNames]
  p.camera = {
    position,
    target: center,
    minDistance: Math.max(0.01, extent * 0.05),
    maxDistance: Math.max(24, extent * 10),
  }
  const perspective = p.views.find((view) => view.id === 'perspective')
  assert.ok(perspective, 'Existing perspective view required')
  perspective.position = position
  perspective.target = center
  product.materialComparison = { fixture: true, group: group.id, label: group.label }
  return product
}

import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import sharp from 'sharp'
import * as MikkTSpace from 'three/addons/libs/mikktspace.module.js'

const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }
const TYPES = {
  5120: { size: 1, read: 'readInt8', max: 127, signed: true },
  5121: { size: 1, read: 'readUInt8', max: 255 },
  5122: { size: 2, read: 'readInt16LE', max: 32767, signed: true },
  5123: { size: 2, read: 'readUInt16LE', max: 65535 },
  5125: { size: 4, read: 'readUInt32LE', max: 4294967295 },
  5126: { size: 4, read: 'readFloatLE' },
}
export const TYPEWRITER_EXPECTATIONS = Object.freeze({
  parts: 572,
  surfaces: 2257,
  images: 51,
  meshes: 298,
  missingUvMeshes: [61, 66, 67, 68, 74, 75, 89, 90, 273, 274],
})
const FROZEN_SOURCE_MODEL_SHA256 =
  'b61293acf1eb49f2d7cbcba0ae59214346130b8df0c32685cf954502f37ff0f4'
const FROZEN_SOURCE_RIG_SHA256 = '047cddb65994640a25f4fad191131423b1ceafce6b4ab474aa906ac1d4576154'
const FROZEN_BRAND_IMAGE_SHA256 = '2e2dc7fa4351476914290efa587dfb93586d75734ee120771fa0f436679ca400'
const hash = (value) => createHash('sha256').update(value).digest('hex')

/** Independent raw GLB reader: does not run the generator or glTF transforms. */
export function decodeGlb(bytes) {
  if (
    !Buffer.isBuffer(bytes) ||
    bytes.length < 20 ||
    bytes.readUInt32LE(0) !== 0x46546c67 ||
    bytes.readUInt32LE(4) !== 2 ||
    bytes.readUInt32LE(8) !== bytes.length
  )
    throw new Error('Invalid GLB header')
  let document, binary
  for (let offset = 12; offset < bytes.length;) {
    if (offset + 8 > bytes.length) throw new Error('Truncated GLB chunk')
    const length = bytes.readUInt32LE(offset),
      kind = bytes.readUInt32LE(offset + 4)
    if (length % 4 || offset + 8 + length > bytes.length)
      throw new Error('Invalid GLB chunk bounds')
    const payload = bytes.subarray(offset + 8, offset + 8 + length)
    if (kind === 0x4e4f534a) {
      if (document) throw new Error('Duplicate GLB JSON chunk')
      document = JSON.parse(payload.toString('utf8').trimEnd())
    } else if (kind === 0x004e4942) {
      if (binary) throw new Error('Duplicate GLB BIN chunk')
      binary = payload
    } else throw new Error('Unsupported GLB chunk type')
    offset += 8 + length
  }
  if (!document || !binary) throw new Error('GLB requires JSON and BIN chunks')
  if (document.buffers?.length !== 1 || document.buffers[0].uri) {
    throw new Error('Verifier requires a single embedded GLB buffer')
  }
  if (document.buffers[0].byteLength > binary.length)
    throw new Error('GLB buffer exceeds BIN chunk')
  return { document, binary, accessors: new Map() }
}

function bufferView(asset, id) {
  const view = asset.document.bufferViews?.[id]
  if (!view || (view.buffer ?? 0) !== 0 || view.extensions?.EXT_meshopt_compression) {
    throw new Error('Unsupported or missing bufferView ' + id)
  }
  const start = view.byteOffset ?? 0,
    end = start + view.byteLength
  if (
    !Number.isSafeInteger(start) ||
    start < 0 ||
    !Number.isSafeInteger(end) ||
    end > asset.binary.length
  ) {
    throw new Error('Invalid bufferView bounds ' + id)
  }
  return { ...view, start, end }
}

export function readAccessor(asset, id) {
  if (asset.accessors.has(id)) return asset.accessors.get(id)
  const accessor = asset.document.accessors?.[id],
    type = TYPES[accessor?.componentType]
  const width = COMPONENTS[accessor?.type],
    count = accessor?.count
  if (!type || !width || !Number.isSafeInteger(count) || count < 0)
    throw new Error('Invalid accessor ' + id)
  const values = new Float64Array(count * width)
  const read = (viewId, localOffset, entryCount, components, componentType, strideOverride) => {
    const view = bufferView(asset, viewId),
      definition = TYPES[componentType]
    const stride = strideOverride ?? view.byteStride ?? definition.size * components
    const start = view.start + (localOffset ?? 0)
    if (
      !Number.isSafeInteger(stride) ||
      stride < definition.size * components ||
      start < view.start ||
      (entryCount && start + (entryCount - 1) * stride + definition.size * components > view.end)
    ) {
      throw new Error('Accessor exceeds bufferView ' + id)
    }
    return (entry, component) =>
      asset.binary[definition.read](start + entry * stride + component * definition.size)
  }
  if (accessor.bufferView !== undefined) {
    const value = read(
      accessor.bufferView,
      accessor.byteOffset,
      count,
      width,
      accessor.componentType,
    )
    for (let i = 0; i < count; i++)
      for (let j = 0; j < width; j++) values[i * width + j] = value(i, j)
  } else if (!accessor.sparse) throw new Error('Accessor has no storage ' + id)
  if (accessor.sparse) {
    const { indices, values: sparseValues, count: sparseCount } = accessor.sparse
    if (
      !Number.isSafeInteger(sparseCount) ||
      sparseCount < 0 ||
      sparseCount > count ||
      ![5121, 5123, 5125].includes(indices.componentType)
    )
      throw new Error('Invalid sparse accessor ' + id)
    const index = read(
      indices.bufferView,
      indices.byteOffset,
      sparseCount,
      1,
      indices.componentType,
    )
    const value = read(
      sparseValues.bufferView,
      sparseValues.byteOffset,
      sparseCount,
      width,
      accessor.componentType,
    )
    let previous = -1
    for (let i = 0; i < sparseCount; i++) {
      const at = index(i, 0)
      if (at <= previous || at >= count) throw new Error('Invalid sparse accessor index ' + id)
      previous = at
      for (let j = 0; j < width; j++) values[at * width + j] = value(i, j)
    }
  }
  for (let i = 0; i < values.length; i++) {
    if (accessor.normalized && type.max)
      values[i] = type.signed ? Math.max(-1, values[i] / type.max) : values[i] / type.max
    if (!Number.isFinite(values[i])) throw new Error('Non-finite accessor ' + id)
  }
  const result = { values, width, count }
  asset.accessors.set(id, result)
  return result
}

function indices(asset, primitive, position) {
  if ((primitive.mode ?? 4) !== 4 || primitive.extensions?.KHR_draco_mesh_compression) {
    throw new Error('Only uncompressed TRIANGLES primitives are accepted')
  }
  const index = primitive.indices === undefined ? null : readAccessor(asset, primitive.indices)
  if (index && index.width !== 1) throw new Error('Indices must be SCALAR')
  const count = index?.count ?? position.count
  if (count % 3) throw new Error('Triangle index count is not divisible by three')
  const result = index?.values ?? Float64Array.from({ length: count }, (_, i) => i)
  for (const value of result)
    if (!Number.isSafeInteger(value) || value < 0 || value >= position.count) {
      throw new Error('Triangle index outside POSITION')
    }
  return result
}

function identities(document) {
  const names = document.nodes?.map((node) => node.name) ?? []
  return {
    parts: names.filter((name) => /^part-\d{3}$/.test(name)).length,
    surfaces: names.filter((name) => /^part-\d{3}-surface-\d+$/.test(name)).length,
    images: document.images?.length ?? 0,
    meshes: document.meshes?.length ?? 0,
  }
}

function nodeContract(node) {
  return {
    name: node.name,
    matrix: node.matrix,
    translation: node.translation,
    rotation: node.rotation,
    scale: node.scale,
    children: node.children ?? [],
    mesh: node.mesh,
    skin: node.skin,
    weights: node.weights,
  }
}

async function imageBytes(asset, image, directory) {
  if (image.bufferView !== undefined) {
    const view = bufferView(asset, image.bufferView)
    return asset.binary.subarray(view.start, view.end)
  }
  if (typeof image.uri !== 'string') throw new Error('Image has no storage')
  if (image.uri.startsWith('data:')) {
    const match = /^data:image\/[^;]+;base64,([A-Za-z0-9+/=]+)$/.exec(image.uri)
    if (!match) throw new Error('Unsupported image data URI')
    return Buffer.from(match[1], 'base64')
  }
  if (!directory || isAbsolute(image.uri) || image.uri.includes('\\') || /[:?#%]/.test(image.uri)) {
    throw new Error('Image URI must be local and package-relative')
  }
  const target = resolve(directory, image.uri),
    path = relative(resolve(directory), target)
  if (path.startsWith('..') || isAbsolute(path)) throw new Error('Image URI leaves package')
  return readFile(target)
}

async function imageHashes(asset, directory) {
  return Promise.all(
    (asset.document.images ?? []).map(async (image) => {
      const bytes = await imageBytes(asset, image, directory)
      return { bytes: bytes.length, sha256: hash(bytes), mimeType: image.mimeType }
    }),
  )
}

function textureBinding(document, images, info) {
  if (!info) return null
  const texture = document.textures?.[info.index]
  if (!texture || texture.source === undefined || !images[texture.source])
    throw new Error('Invalid glyph texture binding')
  const parameters = { ...info }
  delete parameters.index
  return {
    parameters,
    image: images[texture.source],
    sampler: document.samplers?.[texture.sampler] ?? null,
  }
}

function materialImageBindings(document, imageIndex) {
  const bindings = []
  const visit = (value, path, materialIndex, materialName) => {
    if (!value || typeof value !== 'object') return
    for (const [key, item] of Object.entries(value)) {
      const childPath = path ? path + '.' + key : key
      if (
        key.endsWith('Texture') &&
        item &&
        typeof item === 'object' &&
        Number.isInteger(item.index)
      ) {
        const texture = document.textures?.[item.index]
        if (
          texture?.source === imageIndex ||
          texture?.extensions?.KHR_texture_basisu?.source === imageIndex
        ) {
          bindings.push({ materialIndex, materialName, path: childPath })
        }
      } else if (item && typeof item === 'object')
        visit(item, childPath, materialIndex, materialName)
    }
  }
  for (let index = 0; index < (document.materials?.length ?? 0); index++)
    visit(document.materials[index], '', index, document.materials[index].name)
  return bindings
}

async function verifyBrandReplacement(
  source,
  candidate,
  sourceImages,
  candidateImages,
  options,
  fail,
) {
  if (!options.brandReplacement) return null
  const declaration = options.brandReplacement
  if (
    !declaration ||
    typeof declaration !== 'object' ||
    Array.isArray(declaration) ||
    declaration.sourceIndex !== 50 ||
    declaration.sourceMaterial !== 'decal-62' ||
    declaration.text !== 'WindGear' ||
    declaration.sourceSha256 !== FROZEN_BRAND_IMAGE_SHA256 ||
    declaration.sourceSha256 !== sourceImages[50]?.sha256 ||
    declaration.candidateSha256 !== candidateImages[50]?.sha256 ||
    declaration.candidateSha256 === declaration.sourceSha256
  ) {
    fail('Invalid WindGear brandReplacement declaration or image digest')
    return null
  }
  const sourceBindings = materialImageBindings(source.document, 50)
  const candidateBindings = materialImageBindings(candidate.document, 50)
  if (
    sourceBindings.length !== 1 ||
    sourceBindings[0].materialName !== 'decal-62' ||
    sourceBindings[0].path !== 'pbrMetallicRoughness.baseColorTexture' ||
    !isDeepStrictEqual(sourceBindings, candidateBindings)
  ) {
    fail('Brand image50 must retain its unique decal-62 sRGB baseColor binding')
    return null
  }
  let metadata, alpha
  try {
    const bytes = await imageBytes(
      candidate,
      candidate.document.images[50],
      options.candidateDirectory,
    )
    metadata = await sharp(bytes).metadata()
    const stats = await sharp(bytes).stats()
    alpha = stats.channels[3]
  } catch (error) {
    fail(
      'WindGear image50 is not a decodable PNG: ' +
        (error instanceof Error ? error.message : String(error)),
    )
    return null
  }
  if (
    metadata.format !== 'png' ||
    metadata.width !== 1024 ||
    metadata.height !== 416 ||
    metadata.space !== 'srgb' ||
    metadata.channels !== 4 ||
    !metadata.hasAlpha ||
    !alpha ||
    alpha.min >= 255 ||
    alpha.max <= 0
  ) {
    fail('WindGear image50 must be a 1024×416 sRGB PNG with visible and transparent pixels')
    return null
  }
  for (let index = 0; index < sourceImages.length; index++) {
    if (index !== 50 && !isDeepStrictEqual(sourceImages[index], candidateImages[index]))
      fail('WindGear exception cannot change source image ' + index)
  }
  return {
    sourceIndex: 50,
    sourceMaterial: 'decal-62',
    text: 'WindGear',
    sourceSha256: sourceImages[50].sha256,
    candidateSha256: candidateImages[50].sha256,
    sourceBytes: sourceImages[50].bytes,
    candidateBytes: candidateImages[50].bytes,
    width: metadata.width,
    height: metadata.height,
    colorSpace: metadata.space,
    alphaMin: alpha.min,
    alphaMax: alpha.max,
    binding: candidateBindings[0],
    scope:
      'Explicit owner-authorized image50 replacement; other 50 PNGs, glyph parameters and bindings remain preserved. Text declaration is recorded, not OCR-verified.',
  }
}

function needsTangents(material, names) {
  return (
    names.includes(material?.name) ||
    !!material?.normalTexture ||
    !!material?.extensions?.KHR_materials_clearcoat?.clearcoatNormalTexture ||
    !!material?.extensions?.KHR_materials_anisotropy?.anisotropyTexture ||
    (material?.extensions?.KHR_materials_anisotropy?.anisotropyStrength ?? 0) > 0
  )
}

function tangentTexCoord(material) {
  const info =
    material?.normalTexture ??
    material?.extensions?.KHR_materials_clearcoat?.clearcoatNormalTexture ??
    material?.extensions?.KHR_materials_anisotropy?.anisotropyTexture
  return info?.extensions?.KHR_texture_transform?.texCoord ?? info?.texCoord ?? 0
}

/** Compares triangle corners, not accessor ids or vertex counts, permitting UV seam splits. */
export async function verifyGlbPreservation(sourceBytes, candidateBytes, options = {}) {
  const source = decodeGlb(sourceBytes),
    candidate = decodeGlb(candidateBytes)
  const expected = options.expectations ?? TYPEWRITER_EXPECTATIONS,
    tolerance = options.tolerance ?? 1e-6
  const failures = [],
    fail = (message) => {
      if (failures.length < 50) failures.push(message)
    }
  const sourceCounts = identities(source.document),
    candidateCounts = identities(candidate.document)
  for (const key of ['parts', 'surfaces', 'images', 'meshes']) {
    if (sourceCounts[key] !== expected[key])
      fail('Source ' + key + ' does not match frozen identity')
    if (key !== 'images' && candidateCounts[key] !== expected[key])
      fail('Candidate ' + key + ' identity changed')
  }
  if (candidateCounts.images < expected.images) fail('Candidate lost source images')
  const aNodes = source.document.nodes ?? [],
    bNodes = candidate.document.nodes ?? []
  if (aNodes.length !== bNodes.length) fail('Node count changed')
  for (let i = 0; i < aNodes.length; i++) {
    if (!bNodes[i] || !isDeepStrictEqual(nodeContract(aNodes[i]), nodeContract(bNodes[i])))
      fail('Node identity/TRS/hierarchy changed at ' + i)
  }
  if (
    !isDeepStrictEqual(source.document.scenes, candidate.document.scenes) ||
    source.document.scene !== candidate.document.scene
  )
    fail('Scene roots changed')
  const sourceImages = await imageHashes(source, options.sourceDirectory)
  const candidateImages = await imageHashes(candidate, options.candidateDirectory)
  const brandReplacement = await verifyBrandReplacement(
    source,
    candidate,
    sourceImages,
    candidateImages,
    options,
    fail,
  )
  const available = new Map()
  let sourceImagesPreserved = 0
  for (const image of candidateImages)
    available.set(image.sha256, (available.get(image.sha256) ?? 0) + 1)
  for (let imageIndex = 0; imageIndex < sourceImages.length; imageIndex++) {
    if (brandReplacement && imageIndex === 50) continue
    const image = sourceImages[imageIndex]
    if (!isDeepStrictEqual(image, candidateImages[imageIndex]))
      fail('Source image changed at index ' + imageIndex)
    const remaining = available.get(image.sha256) ?? 0
    if (remaining < 1) fail('Source PNG bytes not retained: ' + image.sha256)
    else {
      available.set(image.sha256, remaining - 1)
      sourceImagesPreserved++
    }
  }
  let glyphMaterials = 0
  const sourceMaterials = source.document.materials ?? [],
    candidateMaterials = candidate.document.materials ?? []
  for (let i = 0; i < sourceMaterials.length; i++) {
    const material = sourceMaterials[i],
      next = candidateMaterials[i]
    if (!next || next.name !== material.name) fail('Material identity changed at ' + i)
    if (material.alphaMode !== 'BLEND' || !material.pbrMetallicRoughness?.baseColorTexture) continue
    glyphMaterials++
    const stripTexture = (value) => ({
      ...value,
      pbrMetallicRoughness: { ...value.pbrMetallicRoughness, baseColorTexture: undefined },
    })
    const sourceBinding = textureBinding(
      source.document,
      sourceImages,
      material.pbrMetallicRoughness.baseColorTexture,
    )
    const candidateBinding = next
      ? textureBinding(
          candidate.document,
          candidateImages,
          next.pbrMetallicRoughness?.baseColorTexture,
        )
      : null
    if (brandReplacement && material.name === 'decal-62' && candidateBinding) {
      // Compare every sampler/UV parameter, granting only the explicitly validated image50 bytes.
      candidateBinding.image = sourceBinding.image
    }
    if (
      !next ||
      !isDeepStrictEqual(stripTexture(material), stripTexture(next)) ||
      !isDeepStrictEqual(sourceBinding, candidateBinding)
    )
      fail('Glyph material or binding changed at ' + i)
  }
  const missingUvMeshes = [],
    meshes = [],
    totals = {
      triangles: 0,
      corners: 0,
      maxPositionError: 0,
      maxNormalError: 0,
      maxExistingUvError: 0,
      tangentVertices: 0,
      tangentRequiredPrimitives: 0,
      tangentPrimitives: 0,
      maxTangentLengthError: 0,
      maxTangentNormalDot: 0,
      tangentHandednessMismatches: 0,
      tangentHandednessVerifiedCorners: 0,
      tangentHandednessUnverifiedCorners: 0,
      tangentDerivativeHandednessMismatches: 0,
      sourceNormalsOpposeWindingCorners: 0,
      sourceNormalNearTangentCorners: 0,
      sourceDegenerateGeometryTriangles: 0,
      mikkDegenerateTangentCorners: 0,
      degenerateUvTriangles: 0,
      newlyAddedUvDegenerateTriangles: 0,
    }
  for (let meshIndex = 0; meshIndex < (source.document.meshes?.length ?? 0); meshIndex++) {
    const aMesh = source.document.meshes[meshIndex],
      bMesh = candidate.document.meshes?.[meshIndex]
    if (!bMesh || aMesh.primitives.length !== bMesh.primitives.length) {
      fail('Primitive identity changed at mesh ' + meshIndex)
      continue
    }
    for (let primitiveIndex = 0; primitiveIndex < aMesh.primitives.length; primitiveIndex++) {
      const a = aMesh.primitives[primitiveIndex],
        b = bMesh.primitives[primitiveIndex],
        label = `${meshIndex}/${primitiveIndex}`
      if (a.material !== b.material) fail('Surface material binding changed at ' + label)
      const p0 = readAccessor(source, a.attributes.POSITION),
        p1 = readAccessor(candidate, b.attributes.POSITION)
      const n0 = readAccessor(source, a.attributes.NORMAL),
        n1 = readAccessor(candidate, b.attributes.NORMAL)
      if (
        p0.width !== 3 ||
        p1.width !== 3 ||
        n0.width !== 3 ||
        n1.width !== 3 ||
        p0.count !== n0.count ||
        p1.count !== n1.count
      )
        throw new Error('Invalid position/normal shape at ' + label)
      const i0 = indices(source, a, p0),
        i1 = indices(candidate, b, p1)
      if (i0.length !== i1.length) {
        fail('Triangle count changed at ' + label)
        continue
      }
      const uv0 =
        a.attributes.TEXCOORD_0 === undefined ? null : readAccessor(source, a.attributes.TEXCOORD_0)
      const uv1 =
        b.attributes.TEXCOORD_0 === undefined
          ? null
          : readAccessor(candidate, b.attributes.TEXCOORD_0)
      if (!uv0) missingUvMeshes.push(meshIndex)
      if (!uv1 || uv1.width !== 2 || uv1.count !== p1.count)
        fail('Missing or malformed candidate UV at ' + label)
      if (uv0 && (uv0.width !== 2 || uv0.count !== p0.count))
        throw new Error('Malformed source UV at ' + label)
      let positionError = 0,
        normalError = 0,
        uvError = 0
      for (let corner = 0; corner < i0.length; corner++) {
        for (let axis = 0; axis < 3; axis++) {
          positionError = Math.max(
            positionError,
            Math.abs(p0.values[i0[corner] * 3 + axis] - p1.values[i1[corner] * 3 + axis]),
          )
          normalError = Math.max(
            normalError,
            Math.abs(n0.values[i0[corner] * 3 + axis] - n1.values[i1[corner] * 3 + axis]),
          )
        }
        if (uv0 && uv1)
          for (let axis = 0; axis < 2; axis++)
            uvError = Math.max(
              uvError,
              Math.abs(uv0.values[i0[corner] * 2 + axis] - uv1.values[i1[corner] * 2 + axis]),
            )
      }
      if (positionError > tolerance || normalError > tolerance)
        fail('Triangle corner POSITION/NORMAL changed at ' + label)
      if (uvError !== 0) fail('Existing triangle corner UV changed at ' + label)
      totals.maxPositionError = Math.max(totals.maxPositionError, positionError)
      totals.maxNormalError = Math.max(totals.maxNormalError, normalError)
      totals.maxExistingUvError = Math.max(totals.maxExistingUvError, uvError)
      totals.triangles += i0.length / 3
      totals.corners += i0.length
      if (!uv0 && uv1)
        for (let corner = 0; corner < i1.length; corner += 3) {
          const x = i1[corner],
            y = i1[corner + 1],
            z = i1[corner + 2]
          const du1 = uv1.values[y * 2] - uv1.values[x * 2],
            dv1 = uv1.values[y * 2 + 1] - uv1.values[x * 2 + 1]
          const du2 = uv1.values[z * 2] - uv1.values[x * 2],
            dv2 = uv1.values[z * 2 + 1] - uv1.values[x * 2 + 1]
          const uvLength = Math.hypot(du1, dv1) * Math.hypot(du2, dv2)
          if (uvLength && Math.abs(du1 * dv2 - du2 * dv1) > uvLength * 1e-10) continue
          const ax = p1.values[y * 3] - p1.values[x * 3],
            ay = p1.values[y * 3 + 1] - p1.values[x * 3 + 1],
            az = p1.values[y * 3 + 2] - p1.values[x * 3 + 2]
          const bx = p1.values[z * 3] - p1.values[x * 3],
            by = p1.values[z * 3 + 1] - p1.values[x * 3 + 1],
            bz = p1.values[z * 3 + 2] - p1.values[x * 3 + 2]
          if (
            Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx) >
            Math.hypot(ax, ay, az) * Math.hypot(bx, by, bz) * 1e-10
          )
            totals.newlyAddedUvDegenerateTriangles++
        }
      const tangentRequired = needsTangents(
        candidateMaterials[b.material],
        options.requiredTangentMaterials ?? [],
      )
      if (tangentRequired) totals.tangentRequiredPrimitives++
      const tangent =
        b.attributes.TANGENT === undefined ? null : readAccessor(candidate, b.attributes.TANGENT)
      const tangentUvIndex = tangentTexCoord(candidateMaterials[b.material])
      const tangentUvAccessor = b.attributes['TEXCOORD_' + tangentUvIndex]
      const tangentUv =
        tangentUvAccessor === undefined ? null : readAccessor(candidate, tangentUvAccessor)
      if (tangentRequired && !tangent) fail('Required TANGENT missing at ' + label)
      if (tangentRequired && (!tangentUv || tangentUv.width !== 2 || tangentUv.count !== p1.count))
        fail('Required tangent UV source missing/malformed at ' + label)
      if (tangent) {
        totals.tangentPrimitives++
        if (tangent.width !== 4 || tangent.count !== p1.count)
          throw new Error('Malformed TANGENT at ' + label)
        let invalid = false
        for (let vertex = 0; vertex < tangent.count; vertex++) {
          const t = vertex * 4,
            n = vertex * 3
          const length = Math.hypot(tangent.values[t], tangent.values[t + 1], tangent.values[t + 2])
          const normalLength = Math.hypot(n1.values[n], n1.values[n + 1], n1.values[n + 2])
          const dot = normalLength
            ? Math.abs(
                (tangent.values[t] * n1.values[n] +
                  tangent.values[t + 1] * n1.values[n + 1] +
                  tangent.values[t + 2] * n1.values[n + 2]) /
                  normalLength,
              )
            : Infinity
          totals.maxTangentLengthError = Math.max(
            totals.maxTangentLengthError,
            Math.abs(length - 1),
          )
          totals.maxTangentNormalDot = Math.max(totals.maxTangentNormalDot, dot)
          if (
            Math.abs(length - 1) > 1e-4 ||
            dot > 1e-4 ||
            Math.abs(Math.abs(tangent.values[t + 3]) - 1) > 1e-6
          )
            invalid = true
        }
        if (invalid) fail('TANGENT is not unit/orthogonal with w=±1 at ' + label)
        totals.tangentVertices += tangent.count
        const tangentDegenerateTriangles = new Uint8Array(i1.length / 3)
        if (tangentUv) {
          for (let corner = 0; corner < i1.length; corner += 3) {
            const x = i1[corner],
              y = i1[corner + 1],
              z = i1[corner + 2]
            const du1 = tangentUv.values[y * 2] - tangentUv.values[x * 2],
              dv1 = tangentUv.values[y * 2 + 1] - tangentUv.values[x * 2 + 1]
            const du2 = tangentUv.values[z * 2] - tangentUv.values[x * 2],
              dv2 = tangentUv.values[z * 2 + 1] - tangentUv.values[x * 2 + 1]
            const uvLength = Math.hypot(du1, dv1) * Math.hypot(du2, dv2)
            // A collapsed/collinear UV triangle has no meaningful orientation. Use a
            // scale-relative test so small but valid UV islands remain subject to validation.
            if (!uvLength || Math.abs(du1 * dv2 - du2 * dv1) <= uvLength * 1e-10)
              tangentDegenerateTriangles[corner / 3] = 1
          }
          await MikkTSpace.ready
          const positions = new Float32Array(i1.length * 3),
            normals = new Float32Array(i1.length * 3),
            uv = new Float32Array(i1.length * 2)
          for (let corner = 0; corner < i1.length; corner++) {
            const vertex = i1[corner]
            for (let axis = 0; axis < 3; axis++) {
              positions[corner * 3 + axis] = p1.values[vertex * 3 + axis]
              normals[corner * 3 + axis] = n1.values[vertex * 3 + axis]
            }
            uv[corner * 2] = tangentUv.values[vertex * 2]
            uv[corner * 2 + 1] = tangentUv.values[vertex * 2 + 1]
          }
          const canonical = MikkTSpace.generateTangents(positions, normals, uv)
          for (let corner = 0; corner < i1.length; corner++) {
            if (tangentDegenerateTriangles[Math.floor(corner / 3)]) {
              totals.tangentHandednessUnverifiedCorners++
            } else {
              totals.tangentHandednessVerifiedCorners++
              if (Math.abs(tangent.values[i1[corner] * 4 + 3] + canonical[corner * 4 + 3]) > 1e-6)
                totals.tangentHandednessMismatches++
            }
            if (
              Math.hypot(
                canonical[corner * 4],
                canonical[corner * 4 + 1],
                canonical[corner * 4 + 2],
              ) < 1e-12
            )
              totals.mikkDegenerateTangentCorners++
          }
        }
        if (tangentUv)
          for (let corner = 0; corner < i1.length; corner += 3) {
            const x = i1[corner],
              y = i1[corner + 1],
              z = i1[corner + 2]
            const du1 = tangentUv.values[y * 2] - tangentUv.values[x * 2],
              dv1 = tangentUv.values[y * 2 + 1] - tangentUv.values[x * 2 + 1]
            const du2 = tangentUv.values[z * 2] - tangentUv.values[x * 2],
              dv2 = tangentUv.values[z * 2 + 1] - tangentUv.values[x * 2 + 1]
            const determinant = du1 * dv2 - du2 * dv1
            if (tangentDegenerateTriangles[corner / 3]) {
              totals.degenerateUvTriangles++
              continue
            }
            const bx =
              ((p1.values[z * 3] - p1.values[x * 3]) * du1 -
                (p1.values[y * 3] - p1.values[x * 3]) * du2) /
              determinant
            const by =
              ((p1.values[z * 3 + 1] - p1.values[x * 3 + 1]) * du1 -
                (p1.values[y * 3 + 1] - p1.values[x * 3 + 1]) * du2) /
              determinant
            const bz =
              ((p1.values[z * 3 + 2] - p1.values[x * 3 + 2]) * du1 -
                (p1.values[y * 3 + 2] - p1.values[x * 3 + 2]) * du2) /
              determinant
            const bitangentLength = Math.hypot(bx, by, bz)
            if (bitangentLength <= 1e-12) continue
            const ax = p1.values[y * 3] - p1.values[x * 3],
              ay = p1.values[y * 3 + 1] - p1.values[x * 3 + 1],
              az = p1.values[y * 3 + 2] - p1.values[x * 3 + 2]
            const cx = p1.values[z * 3] - p1.values[x * 3],
              cy = p1.values[z * 3 + 1] - p1.values[x * 3 + 1],
              cz = p1.values[z * 3 + 2] - p1.values[x * 3 + 2]
            const fx = ay * cz - az * cy,
              fy = az * cx - ax * cz,
              fz = ax * cy - ay * cx
            const faceLength = Math.hypot(fx, fy, fz)
            if (faceLength <= 1e-12) totals.sourceDegenerateGeometryTriangles++
            for (const vertex of [x, y, z]) {
              const n = vertex * 3,
                t = vertex * 4,
                nx = n1.values[n],
                ny = n1.values[n + 1],
                nz = n1.values[n + 2]
              const tx = tangent.values[t],
                ty = tangent.values[t + 1],
                tz = tangent.values[t + 2]
              const orientation =
                (((ny * tz - nz * ty) * bx + (nz * tx - nx * tz) * by + (nx * ty - ny * tx) * bz) *
                  tangent.values[t + 3]) /
                bitangentLength
              const normalFaceDot = faceLength ? (nx * fx + ny * fy + nz * fz) / faceLength : 0
              if (normalFaceDot < -1e-4) totals.sourceNormalsOpposeWindingCorners++
              if (Math.abs(normalFaceDot) <= 1e-4) totals.sourceNormalNearTangentCorners++
              // Per-face derivatives differ from averaged Mikk frames and opposite source normals.
              // Keep this diagnostic; authoritative w validation independently regenerates Mikk above.
              if (orientation > 1e-4) totals.tangentDerivativeHandednessMismatches++
            }
          }
      }
      meshes.push({
        mesh: meshIndex,
        primitive: primitiveIndex,
        sourceVertices: p0.count,
        candidateVertices: p1.count,
        triangles: i0.length / 3,
        positionError,
        normalError,
        existingUvError: uv0 ? uvError : null,
        uvAdded: !uv0 && !!uv1,
        tangentRequired,
        tangentTexCoord: tangentUvIndex,
        tangents: !!tangent,
      })
    }
  }
  if (!isDeepStrictEqual(missingUvMeshes, expected.missingUvMeshes))
    fail('Source missing-UV mesh identity does not match frozen list')
  if (totals.tangentHandednessMismatches)
    fail('Tangent handedness differs from independently regenerated glTF -Mikk.w')
  if (totals.newlyAddedUvDegenerateTriangles)
    fail('Newly added UV collapses nondegenerate geometry triangles')
  return {
    passed: failures.length === 0,
    failures,
    tolerance,
    sourceSha256: hash(sourceBytes),
    candidateSha256: hash(candidateBytes),
    sourceCounts,
    candidateCounts,
    sourceImages,
    sourceImagesPreserved,
    brandReplacement,
    glyphMaterials,
    missingUvMeshes,
    totals,
    meshes,
    tangentConvention:
      'glTF: independently regenerated Three MikkTSpace canonical w, negateSign=true (-Mikk.w), on nondegenerate UV triangles only; undefined UV orientation is counted separately and all tangents still require unit/orthogonal vectors and w=±1. Per-face derivative sign is diagnostic only',
    scope:
      'Ordered triangle-corner preservation, stable node bindings/TRS/hierarchy, source PNG bytes and glyph material bindings; not visual, collision, UV distortion or full MikkTSpace equivalence acceptance.',
  }
}

export async function verifyTypewriterV2(sourceDirectory, candidateDirectory, options = {}) {
  const [sourceBytes, candidateBytes, sourceRig, candidateRig] = await Promise.all([
    readFile(resolve(sourceDirectory, 'model.glb')),
    readFile(resolve(candidateDirectory, 'model.glb')),
    readFile(resolve(sourceDirectory, 'rig.json')),
    readFile(resolve(candidateDirectory, 'rig.json')),
  ])
  let brandReplacement
  if (options.brandReplacement) {
    const record = JSON.parse(
      await readFile(resolve(candidateDirectory, 'production-record.json'), 'utf8'),
    )
    if (!record.brandReplacement)
      throw new Error('production-record.json requires brandReplacement declaration')
    if (
      options.brandReplacement !== true &&
      !isDeepStrictEqual(options.brandReplacement, record.brandReplacement)
    )
      throw new Error('Supplied brandReplacement differs from production-record.json')
    brandReplacement = record.brandReplacement
  }
  const report = await verifyGlbPreservation(sourceBytes, candidateBytes, {
    ...options,
    brandReplacement,
    sourceDirectory,
    candidateDirectory,
  })
  report.rig = {
    sourceSha256: hash(sourceRig),
    candidateSha256: hash(candidateRig),
    identical: sourceRig.equals(candidateRig),
  }
  if (!report.rig.identical) {
    report.passed = false
    report.failures.push('rig.json motion bytes changed')
  }
  if (
    options.expectations === undefined &&
    (report.sourceSha256 !== FROZEN_SOURCE_MODEL_SHA256 ||
      report.rig.sourceSha256 !== FROZEN_SOURCE_RIG_SHA256)
  ) {
    report.passed = false
    report.failures.push('Source does not match frozen v1 model/rig SHA-256')
  }
  return report
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2),
    windgear = args.includes('--windgear')
  const positional = args.filter((argument) => argument !== '--windgear')
  if (positional.some((argument) => argument.startsWith('--')) || positional.length > 3)
    throw new Error(
      'Usage: typewriter-v2-verify.mjs [source] [candidate] [artifacts/report.json] [--windgear]',
    )
  const source = positional[0] ?? 'public/models/bundles/kimi-typewriter/v1'
  const candidate = positional[1] ?? 'public/models/bundles/kimi-typewriter/v2'
  const output = resolve(positional[2] ?? 'artifacts/typewriter-v2/preservation.json')
  const outputRelative = relative(resolve('artifacts'), output)
  if (!outputRelative || outputRelative.startsWith('..') || isAbsolute(outputRelative))
    throw new Error('Report must be inside ignored artifacts/')
  let report
  try {
    report = await verifyTypewriterV2(source, candidate, { brandReplacement: windgear })
  } catch (error) {
    report = {
      passed: false,
      failures: [error instanceof Error ? error.message : String(error)],
      source,
      candidate,
    }
  }
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, JSON.stringify(report, null, 2) + '\n')
  console.log(
    JSON.stringify(
      { passed: report.passed, failures: report.failures, totals: report.totals, output },
      null,
      2,
    ),
  )
  if (!report.passed) process.exitCode = 1
}

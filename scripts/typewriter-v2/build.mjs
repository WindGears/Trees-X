import { readFile, mkdir, writeFile, copyFile, access } from 'node:fs/promises'
import { resolve, join, relative, isAbsolute } from 'node:path'
import * as MikkTSpace from 'three/addons/libs/mikktspace.module.js'
import { digest, jsonText } from '../asset-package.mjs'
import { openGlb, readAccessor, appendWriter, remapArray, metricScale } from './glb.mjs'
import { unwrapGeometries } from '../typewriter-v2-unwrap.mjs'
import { projectLocal } from './projection.mjs'
import { windGearNameplate } from './brand.mjs'
import { orthogonalizeTangents } from './tangents.mjs'

const source = 'public/models/bundles/kimi-typewriter/v1'
const textures = resolve(process.argv[2] ?? 'artifacts/typewriter-v2/materials-linear-v2')
const output = resolve(process.argv[3] ?? 'public/models/bundles/kimi-typewriter/v2')
try {
  await access(output)
  throw new Error('Use a new immutable output directory')
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}
const original = await readFile(join(source, 'model.glb'))
if (digest(original) !== 'b61293acf1eb49f2d7cbcba0ae59214346130b8df0c32685cf954502f37ff0f4')
  throw new Error('Source differs from the audited v1')
const manifest = JSON.parse(await readFile(join(source, 'manifest.json'), 'utf8'))
const rig = await readFile(join(source, 'rig.json'))
if (
  digest(rig) !== '047cddb65994640a25f4fad191131423b1ceafce6b4ab474aa906ac1d4576154' ||
  manifest.files.find((f) => f.path === 'rig.json')?.sha256 !== digest(rig)
)
  throw new Error('Rig differs from the audited v1; preserve the source')
const recipe = JSON.parse(await readFile(join(textures, 'textures.json'), 'utf8'))
const doc = openGlb(original),
  writer = appendWriter(doc)
const profiles = {
  enamel: { kind: 'paint', roughness: 0.26, clearcoat: 0.76, coatRoughness: 0.15 },
  shellGloss: { kind: 'paint', roughness: 0.23, clearcoat: 0.8, coatRoughness: 0.14 },
  shellRim: { kind: 'paint', roughness: 0.33, clearcoat: 0.36, coatRoughness: 0.22 },
  steel: { kind: 'brush', roughness: 0.29, anisotropy: 0.34 },
  chrome: { kind: 'brush', roughness: 0.19, anisotropy: 0.12 },
  edge: { kind: 'brush', roughness: 0.25, anisotropy: 0.22 },
  goldEdge: { kind: 'brush', roughness: 0.29, anisotropy: 0.2 },
  goldChrome: { kind: 'brush', roughness: 0.2, anisotropy: 0.1 },
  iron: { kind: 'iron', roughness: 0.44, anisotropy: 0 },
}
const missing = []
for (let mesh = 0; mesh < doc.json.meshes.length; mesh++) {
  const prim = doc.json.meshes[mesh].primitives[0]
  if (!('TEXCOORD_0' in prim.attributes))
    missing.push({
      mesh,
      prim,
      positions: readAccessor(doc, prim.attributes.POSITION),
      normals: readAccessor(doc, prim.attributes.NORMAL),
      indices: new Uint32Array(readAccessor(doc, prim.indices)),
    })
}
if (JSON.stringify(missing.map((m) => m.mesh)) !== '[61,66,67,68,74,75,89,90,273,274]')
  throw new Error('Missing-UV audit no longer matches')
console.log('Unwrapping 10 original UV-less surfaces, preserving triangle corner order')
const unwrapped = [
  ...(await unwrapGeometries(
    missing
      .filter((m) => m.mesh < 89)
      .map(({ mesh, positions, normals, indices }) => ({ mesh, positions, normals, indices })),
  )),
  ...missing.filter((m) => m.mesh >= 89).map(projectLocal),
]
const uvByMesh = new Map(unwrapped.map((result) => [result.mesh, result]))
await MikkTSpace.ready
const geometryCache = new Map(),
  geometryReport = []
let generated = 0
for (let mesh = 0; mesh < doc.json.meshes.length; mesh++) {
  const prim = doc.json.meshes[mesh].primitives[0]
  const name = doc.json.materials[prim.material]?.name,
    profile = profiles[name]
  const unwrap = uvByMesh.get(mesh)
  if (!profile && !unwrap) continue
  const key = JSON.stringify([prim.attributes, prim.indices, profile?.kind])
  const cached = geometryCache.get(key)
  if (cached) {
    prim.attributes = { ...cached.attributes }
    prim.indices = cached.indices
    continue
  }
  const positions = readAccessor(doc, prim.attributes.POSITION),
    normals = readAccessor(doc, prim.attributes.NORMAL)
  const originalIndices =
    prim.indices === undefined
      ? Uint32Array.from({ length: positions.length / 3 }, (_, i) => i)
      : readAccessor(doc, prim.indices)
  const preRemap = unwrap
    ? unwrap.remap
    : Uint32Array.from({ length: positions.length / 3 }, (_, i) => i)
  const p = remapArray(positions, 3, preRemap),
    n = remapArray(normals, 3, preRemap)
  const indices = unwrap ? unwrap.indices : new Uint32Array(originalIndices)
  const uv = unwrap ? unwrap.uv : readAccessor(doc, prim.attributes.TEXCOORD_0)
  const attributes = { ...prim.attributes }
  let remap = preRemap,
    finalIndices = indices,
    finalTangents,
    uv1
  let calibratedScale = null
  let tangentFallbackRepairs = 0
  if (profile) {
    const tile = recipe.recipes.find((r) => r.kind === profile.kind).tileSceneUnits
    calibratedScale = metricScale(p, uv, indices, tile, 0.16)
    const scaled = Float32Array.from(uv, (value) => value * calibratedScale)
    const cornersP = remapArray(p, 3, indices),
      cornersN = remapArray(n, 3, indices)
    const cornersUV = remapArray(scaled, 2, indices)
    const tangent = MikkTSpace.generateTangents(cornersP, cornersN, cornersUV)
    for (let i = 3; i < tangent.length; i += 4) tangent[i] *= -1 // glTF convention; same as Three's utility.
    tangentFallbackRepairs = orthogonalizeTangents(tangent, cornersN)
    const lookup = new Map(),
      vertex = [],
      tangents = [],
      uvValues = []
    finalIndices = new Uint32Array(indices.length)
    const bits = new Uint32Array(tangent.buffer, tangent.byteOffset, tangent.length)
    for (let i = 0; i < indices.length; i++) {
      const id = indices[i],
        t = i * 4
      const tangentKey = `${id}:${bits[t]}:${bits[t + 1]}:${bits[t + 2]}:${bits[t + 3]}`
      let slot = lookup.get(tangentKey)
      if (slot === undefined) {
        slot = vertex.length
        lookup.set(tangentKey, slot)
        vertex.push(preRemap[id])
        tangents.push(...tangent.subarray(t, t + 4))
        uvValues.push(scaled[id * 2], scaled[id * 2 + 1])
      }
      finalIndices[i] = slot
    }
    remap = Uint32Array.from(vertex)
    finalTangents = Float32Array.from(tangents)
    uv1 = Float32Array.from(uvValues)
    // UV0 is never retiled. Seam splits copy each original attribute exactly.
    for (const [semantic, index] of Object.entries(prim.attributes)) {
      const array = readAccessor(doc, index),
        size = doc.json.accessors[index].type === 'VEC2' ? 2 : 3
      attributes[semantic] = writer.accessor(
        remapArray(array, size, remap),
        doc.json.accessors[index].type,
      )
    }
    if (unwrap) {
      const perCornerUv = remapArray(uv, 2, indices)
      const outputUV = new Float32Array(remap.length * 2)
      for (let i = 0; i < finalIndices.length; i++)
        outputUV.set(perCornerUv.subarray(i * 2, i * 2 + 2), finalIndices[i] * 2)
      attributes.TEXCOORD_0 = writer.accessor(outputUV, 'VEC2')
    }
    attributes.TEXCOORD_1 = writer.accessor(uv1, 'VEC2')
    attributes.TANGENT = writer.accessor(finalTangents, 'VEC4')
  } else {
    for (const [semantic, index] of Object.entries(prim.attributes))
      attributes[semantic] = writer.accessor(
        remapArray(readAccessor(doc, index), 3, remap),
        doc.json.accessors[index].type,
      )
    attributes.TEXCOORD_0 = writer.accessor(uv, 'VEC2')
  }
  const indexArray = remap.length <= 65535 ? Uint16Array.from(finalIndices) : finalIndices
  prim.attributes = attributes
  prim.indices = writer.accessor(indexArray, 'SCALAR', 34963)
  geometryCache.set(key, { attributes, indices: prim.indices })
  geometryReport.push({
    mesh,
    material: name,
    missingUv: Boolean(unwrap),
    originalVertices: positions.length / 3,
    vertices: remap.length,
    triangles: originalIndices.length / 3,
    calibratedUvScale: calibratedScale,
    tileSceneUnits: profile
      ? recipe.recipes.find((r) => r.kind === profile.kind).tileSceneUnits
      : null,
    tangent: Boolean(profile),
    tangentFallbackRepairs,
    uvMethod: unwrap
      ? mesh < 89
        ? 'xatlas-web 0.1.0 (area-calibrated)'
        : 'local dominant-face projection'
      : 'source UV0 unchanged; separate metric UV1',
  })
  generated++
}
const textureIndices = new Map()
doc.json.samplers ??= []
const sampler = doc.json.samplers.length
doc.json.samplers.push({ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 })
for (const file of recipe.files) {
  const image = doc.json.images.length
  doc.json.images.push({
    uri: 'textures/' + file.path,
    mimeType: 'image/png',
    name: 'Trees X v2 ' + file.path,
  })
  const texture = doc.json.textures.length
  doc.json.textures.push({ source: image, sampler })
  textureIndices.set(file.path, texture)
}
for (const material of doc.json.materials) {
  const profile = profiles[material.name]
  if (!profile) continue
  const info = (suffix) => ({
    index: textureIndices.get(profile.kind + '-' + suffix + '.png'),
    texCoord: 1,
  })
  material.extras = { ...material.extras, treesFinishVersion: 2 }
  material.normalTexture = { ...info('normal'), scale: 1 }
  material.pbrMetallicRoughness.roughnessFactor = profile.roughness
  material.pbrMetallicRoughness.metallicRoughnessTexture = info('orm')
  material.extensions ??= {}
  material.extensions.KHR_materials_clearcoat = {
    clearcoatFactor: profile.clearcoat ?? 0,
    clearcoatRoughnessFactor: profile.coatRoughness ?? 0,
  }
  if (profile.kind === 'paint') material.pbrMetallicRoughness.metallicFactor = 0.035
  if (profile.anisotropy > 0)
    material.extensions.KHR_materials_anisotropy = {
      anisotropyStrength: profile.anisotropy,
      anisotropyRotation: Math.PI / 2,
      anisotropyTexture: { index: textureIndices.get('brush-direction.png'), texCoord: 1 },
    }
}
doc.json.extensionsUsed = [
  ...new Set([...doc.json.extensionsUsed, 'KHR_materials_clearcoat', 'KHR_materials_anisotropy']),
]
const brandImage = doc.json.images[50],
  brandView = doc.json.bufferViews[brandImage.bufferView]
const oldBrand = doc.binary.subarray(
  brandView.byteOffset,
  brandView.byteOffset + brandView.byteLength,
)
const brand = await windGearNameplate()
brandImage.bufferView = writer.blob(brand)
brandImage.name = 'WindGear nameplate (owner-requested replacement)'
const brandReplacement = {
  sourceIndex: 50,
  sourceMaterial: 'decal-62',
  text: 'WindGear',
  sourceSha256: digest(oldBrand),
  candidateSha256: digest(brand),
  width: 1024,
  height: 416,
  method:
    'New Georgia italic vector typography; source UV0, decal placement, alpha and material preserved',
  color: '#d8b368',
  authorized: 'Owner requested Kimi → WindGear on 2026-10-14',
}
const bytes = writer.finish()
await mkdir(join(output, 'textures'), { recursive: true })
await writeFile(join(output, 'model.glb'), bytes)
await writeFile(join(output, 'rig.json'), rig)
const files = [
  { path: 'model.glb', bytes: bytes.length, sha256: digest(bytes), role: 'model' },
  manifest.files.find((f) => f.role === 'motion'),
]
for (const file of recipe.files) {
  const data = await readFile(join(textures, file.path))
  if (digest(data) !== file.sha256) throw new Error('Texture recipe hash mismatch')
  await copyFile(join(textures, file.path), join(output, 'textures', file.path))
  files.push({
    path: 'textures/' + file.path,
    bytes: data.length,
    sha256: digest(data),
    role: 'texture',
  })
}
const nextManifest = {
  ...manifest,
  version: 2,
  files,
  budget: {
    maxBytes: files.reduce((sum, f) => sum + f.bytes, 0),
    maxTriangles: manifest.budget.maxTriangles,
  },
  provenance: {
    ...manifest.provenance,
    author: manifest.provenance.author + '; micro-surface maps authored by Trees X in Blender',
    license: manifest.provenance.license + ' New procedural maps have no third-party image inputs.',
  },
}
const text = await jsonText(nextManifest)
await writeFile(join(output, 'manifest.json'), text)
await writeFile(
  join(output, 'production-record.json'),
  await jsonText({
    version: 2,
    sourceSha256: digest(original),
    modelSha256: digest(bytes),
    rigSha256: files[1].sha256,
    materialRecipe: recipe,
    geometry: geometryReport,
    geometrySetsPrepared: generated,
    uv0Existing: 'unchanged per triangle corner',
    tangents:
      'Three 0.185.1 bundled MikkTSpace; glTF w negated; tangent seams reindexed; authored normals retained',
    scale: 0.16,
    units: 'scene units; not asserted physical product dimensions',
    assemblyOcclusion: 'none baked; dynamic contact shadows unchanged',
    brandReplacement,
    qualityApproved: false,
  }),
)
const publicRelative = relative(resolve('public'), output)
if (!publicRelative.startsWith('..') && !isAbsolute(publicRelative))
  await writeFile(
    'src/lib/workbench/typewriterV2Bundle.json',
    await jsonText({
      id: nextManifest.id,
      version: 2,
      manifest: '/' + publicRelative.replaceAll('\\', '/') + '/manifest.json',
      sha256: digest(text),
    }),
  )
console.log(
  JSON.stringify({
    output,
    modelBytes: bytes.length,
    textureBytes: files.filter((f) => f.role === 'texture').reduce((s, f) => s + f.bytes, 0),
    manifestSha256: digest(text),
    prepared: generated,
  }),
)

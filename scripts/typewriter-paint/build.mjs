import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import sharp from 'sharp'
import { digest, jsonText, relativeResource } from '../asset-package.mjs'
import { appendWriter, openGlb } from '../typewriter-v2/glb.mjs'

export const auditedPaintSource = Object.freeze({
  manifest: 'dcffa2dd699d269f1c16631343cf96e6b925c00153119363589b0693243f8b26',
  model: '59006664cde2f0beae5ac9508391e3bfbfe9c4cf389eaec6ae67783fc40cded4',
  rig: '047cddb65994640a25f4fad191131423b1ceafce6b4ab474aa906ac1d4576154',
})
export const paintFiles = Object.freeze([
  'paint-normal.png',
  'paint-orm.png',
  'paint-coat-roughness.png',
])
const paintMasters = new Set([
  'paint-height-master.png',
  'paint-roughness-master.png',
  'paint-coat-roughness-master.png',
])
const paintNames = new Set(['enamel', 'shellGloss', 'shellRim'])
const repo = fileURLToPath(new URL('../../', import.meta.url))
const defaultSource = join(repo, 'public/models/bundles/kimi-typewriter/v2')

async function requireNewOutput(output) {
  try {
    await access(output)
  } catch (error) {
    if (error.code === 'ENOENT') return
    throw error
  }
  throw new Error('Use a new immutable output directory; existing resources are never overwritten')
}

async function verifiedFile(directory, file) {
  const bytes = await readFile(join(directory, relativeResource(file.path)))
  if (bytes.length !== file.bytes || digest(bytes) !== file.sha256)
    throw new Error('Resource metadata/hash mismatch: ' + file.path)
  return bytes
}

/** Only edits paint texture bindings and the one authorized nameplate payload. */
export async function buildPaintStudy({ textures, output, source = defaultSource, nameplate }) {
  const destination = resolve(output)
  await requireNewOutput(destination)
  const manifestBytes = await readFile(join(source, 'manifest.json'))
  if (digest(manifestBytes) !== auditedPaintSource.manifest)
    throw new Error('Source manifest differs from the audited v2; preserve the original')
  const manifest = JSON.parse(manifestBytes)
  if (manifest.id !== 'kimi-typewriter' || manifest.version !== 2)
    throw new Error('The paint study must derive from the audited v2 bundle')
  const sourceData = new Map()
  for (const file of manifest.files) sourceData.set(file.path, await verifiedFile(source, file))
  const original = sourceData.get('model.glb')
  const rig = sourceData.get('rig.json')
  if (digest(original) !== auditedPaintSource.model || digest(rig) !== auditedPaintSource.rig)
    throw new Error('Source differs from the audited v2; preserve the original')

  const recipeBytes = await readFile(join(textures, 'textures.json'))
  const recipe = JSON.parse(recipeBytes)
  const runtimeRecipeFiles = Array.isArray(recipe.files)
    ? recipe.files.filter((file) => paintFiles.includes(file.path))
    : []
  if (
    !Array.isArray(recipe.files) ||
    new Set(recipe.files.map((file) => file.path)).size !== recipe.files.length ||
    recipe.files.some((file) => !paintFiles.includes(file.path) && !paintMasters.has(file.path)) ||
    JSON.stringify(runtimeRecipeFiles.map((file) => file.path).sort()) !==
      JSON.stringify([...paintFiles].sort())
  )
    throw new Error(
      'Paint recipe must declare the three technical maps and only known optional masters',
    )
  const candidateMaps = new Map()
  for (const file of recipe.files) {
    const bytes = await verifiedFile(textures, file)
    if (!paintFiles.includes(file.path)) continue
    const info = await sharp(bytes).metadata()
    if (
      info.format !== 'png' ||
      info.width !== 2048 ||
      info.height !== 2048 ||
      info.channels !== 3 ||
      info.depth !== 'uchar' ||
      info.hasAlpha
    )
      throw new Error('Technical maps must be 2048² RGB8 PNG without alpha: ' + file.path)
    candidateMaps.set(file.path, bytes)
  }
  if (recipe.master) {
    if (recipe.master.path !== 'paint-study.blend')
      throw new Error('Unexpected Blender master reference')
    await verifiedFile(textures, recipe.master)
  }
  const brand = nameplate ?? (await (await import('./wordmark.mjs')).windGearPaintNameplate())
  const brandInfo = await sharp(brand).metadata()
  if (brandInfo.width !== 1024 || brandInfo.height !== 416 || !brandInfo.hasAlpha)
    throw new Error('The WindGear nameplate must preserve 1024×416 and transparent alpha')

  const doc = openGlb(original)
  const writer = appendWriter(doc)
  const matching = doc.json.materials.filter((material) => paintNames.has(material.name))
  if (matching.length !== 3) throw new Error('Audited paint material identity differs')
  const enamel = matching.find((material) => material.name === 'enamel')
  const normalIndex = enamel.normalTexture.index
  const ormIndex = enamel.pbrMetallicRoughness.metallicRoughnessTexture.index
  const normalImage = doc.json.images[doc.json.textures[normalIndex].source]
  const ormImage = doc.json.images[doc.json.textures[ormIndex].source]
  if (normalImage.uri !== 'textures/paint-normal.png' || ormImage.uri !== 'textures/paint-orm.png')
    throw new Error('Unexpected source paint texture references')
  const coatImage = doc.json.images.length
  doc.json.images.push({
    uri: 'textures/paint-coat-roughness.png',
    mimeType: 'image/png',
    name: 'Trees X paint study clearcoat roughness (G; linear data)',
  })
  const coatTexture = doc.json.textures.length
  doc.json.textures.push({ source: coatImage, sampler: doc.json.textures[normalIndex].sampler })
  for (const material of matching) {
    if (
      material.extras.treesFinishVersion !== 2 ||
      material.normalTexture.index !== normalIndex ||
      material.normalTexture.texCoord !== 1 ||
      material.pbrMetallicRoughness.metallicRoughnessTexture.index !== ormIndex ||
      material.pbrMetallicRoughness.metallicRoughnessTexture.texCoord !== 1 ||
      material.extensions.KHR_materials_clearcoat.clearcoatRoughnessTexture
    )
      throw new Error('Unexpected paint binding or source clearcoat map: ' + material.name)
    material.extensions.KHR_materials_clearcoat.clearcoatRoughnessTexture = {
      index: coatTexture,
      texCoord: 1,
    }
  }
  const brandImage = doc.json.images[50]
  const brandView = doc.json.bufferViews[brandImage.bufferView]
  const previousBrand = doc.binary.subarray(
    brandView.byteOffset ?? 0,
    (brandView.byteOffset ?? 0) + brandView.byteLength,
  )
  const brandMaterial = doc.json.materials.find((material) => material.name === 'decal-62')
  const brandTexture = doc.json.textures[brandMaterial?.pbrMetallicRoughness.baseColorTexture.index]
  if (brandTexture?.source !== 50 || brandImage.mimeType !== 'image/png')
    throw new Error('Audited nameplate mapping differs')
  brandImage.bufferView = writer.blob(brand)
  brandImage.name = 'WindGear gold connected-script nameplate (owner-requested paint study)'
  const bytes = writer.finish()
  const files = [
    { path: 'model.glb', bytes: bytes.length, sha256: digest(bytes), role: 'model' },
    { ...manifest.files.find((file) => file.path === 'rig.json') },
  ]
  const runtimeTextures = new Map()
  for (const file of manifest.files.filter((entry) => entry.role === 'texture')) {
    const name = file.path.replace(/^textures\//, '')
    const data = candidateMaps.get(name) ?? sourceData.get(file.path)
    runtimeTextures.set(file.path, data)
    files.push({ path: file.path, bytes: data.length, sha256: digest(data), role: 'texture' })
  }
  const coatData = candidateMaps.get('paint-coat-roughness.png')
  const coatPath = 'textures/paint-coat-roughness.png'
  runtimeTextures.set(coatPath, coatData)
  files.push({ path: coatPath, bytes: coatData.length, sha256: digest(coatData), role: 'texture' })
  const next = {
    ...manifest,
    version: 3,
    files,
    budget: {
      ...manifest.budget,
      maxBytes: files.reduce((sum, file) => sum + file.bytes, 0),
    },
    provenance: {
      ...manifest.provenance,
      author: manifest.provenance.author + '; paint-study maps and WindGear script by Trees X',
      license:
        manifest.provenance.license +
        ' Paint study: GPT-generated artistic distribution references converted to controlled technical maps in Blender; not scanned PBR. WindGear is owner-requested custom vector lettering.',
    },
  }
  const manifestText = await jsonText(next)
  const publicRelative = relative(join(repo, 'public'), destination)
  const reference = {
    id: next.id,
    version: next.version,
    ...(publicRelative.startsWith('..') || isAbsolute(publicRelative)
      ? {}
      : { manifest: '/' + publicRelative.replaceAll('\\', '/') + '/manifest.json' }),
    sha256: digest(manifestText),
  }
  const rigJson = JSON.parse(rig)
  const record = {
    version: 3,
    source: 'kimi-typewriter/v2',
    sourceManifestSha256: digest(manifestBytes),
    sourceSha256: digest(original),
    modelSha256: digest(bytes),
    rigSha256: digest(rig),
    materialRecipe: recipe,
    materialRecipeSha256: digest(recipeBytes),
    materialBindings: {
      names: [...paintNames],
      normal: { index: normalIndex, texCoord: 1, convention: 'OpenGL +Y; linear data' },
      orm: { index: ormIndex, texCoord: 1, channels: 'R=1, G=roughness multiplier, B=1' },
      clearcoatRoughness: { index: coatTexture, texCoord: 1, channel: 'G' },
      scalarParameters: 'v2 preserved exactly; treesFinishVersion remains 2',
    },
    preservation: {
      semanticParts: rigJson.parts.length,
      surfaceMappings: doc.json.nodes.filter((node) => node.mesh !== undefined).length,
      nodes: 'all v2 nodes, transforms, hierarchy and semantic mappings unchanged',
      geometry:
        'original binary prefix, mesh primitives, accessors, UV0/UV1 and tangents unchanged',
      motion: 'rig.json byte-identical to audited v2',
      nonPaintTextures: files.filter(
        (file) => file.role === 'texture' && !paintFiles.some((name) => file.path.endsWith(name)),
      ),
      assemblyOcclusion: 'none baked; inter-part occlusion remains dynamic',
    },
    brandReplacement: {
      sourceIndex: 50,
      sourceMaterial: 'decal-62',
      text: 'WindGear',
      sourceSha256: digest(previousBrand),
      candidateSha256: digest(brand),
      width: 1024,
      height: 416,
      color: '#d8b368',
      method:
        'Owner-requested editable connected-script SVG, rasterized with unchanged storage flip',
      placement: 'source UV0, material, texture binding, alpha and node transform unchanged',
    },
    gpuEstimate: {
      textureCount: runtimeTextures.size,
      rgba8MipmappedExternalTexturesBytes: Math.ceil(
        runtimeTextures.size * 2048 ** 2 * 4 * (4 / 3),
      ),
      addedBytesVersusV2: Math.ceil(2048 ** 2 * 4 * (4 / 3)),
      assumptions:
        'RGBA8 GPU allocation with complete mip chain; estimate only, excludes embedded decals, geometry, render targets and driver overhead; no measured VRAM claim',
    },
    qualityApproved: false,
  }

  await mkdir(dirname(destination), { recursive: true })
  const stage = destination + `.creating-${process.pid}`
  if (!isAbsolute(stage) || dirname(stage) !== dirname(destination) || stage === destination)
    throw new Error('Staging path must remain a separate sibling of the intended output')
  await requireNewOutput(stage)
  await mkdir(join(stage, 'textures'), { recursive: true })
  try {
    await writeFile(join(stage, 'model.glb'), bytes)
    await writeFile(join(stage, 'rig.json'), rig)
    for (const [path, data] of runtimeTextures) await writeFile(join(stage, path), data)
    await writeFile(join(stage, 'manifest.json'), manifestText)
    await writeFile(join(stage, 'production-record.json'), await jsonText(record))
    await writeFile(join(stage, 'bundle-reference.json'), await jsonText(reference))
    await requireNewOutput(destination)
    await rename(stage, destination)
  } catch (error) {
    // The staging directory is newly created above, owned by this invocation only.
    await rm(stage, { recursive: true, force: true })
    throw error
  }
  return { reference, manifest: next, record, output: destination }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await buildPaintStudy({
    textures: resolve(process.argv[2] ?? 'artifacts/typewriter-paint/materials'),
    output: resolve(process.argv[3] ?? 'public/models/bundles/kimi-typewriter/paint-study'),
  })
  console.log(JSON.stringify({ ...result.reference, bytes: result.manifest.budget.maxBytes }))
}

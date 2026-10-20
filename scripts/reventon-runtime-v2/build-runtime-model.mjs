/* global structuredClone */
import assert from 'node:assert/strict'
import { glbWithJson, readGlb, relativeResource } from '../asset-package.mjs'
import { visitTextureInfos } from './material-fixture.mjs'

export function cappedDimensions(width, height, maximum = 4096) {
  assert.ok([width, height, maximum].every((value) => Number.isSafeInteger(value) && value > 0))
  const scale = Math.min(1, maximum / Math.max(width, height))
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

/** Reuse encoding evidence only when every quality/transfer/mip argument agrees. */
export function matchesReusableKtxSample(sample, expected) {
  const args = sample.command?.args
  if (!Array.isArray(args)) return false
  const value = (flag) => args[args.indexOf(flag) + 1]
  const match = (flag, expectedValue) => args.includes(flag) && value(flag) === expectedValue
  return (
    sample.inputSha256 === expected.inputSha256 &&
    sample.width === expected.width &&
    sample.height === expected.height &&
    (sample.semantic === 'color' ? 'srgb' : 'linear') === expected.transfer &&
    match('--encode', 'uastc') &&
    match('--uastc-quality', '4') &&
    match('--format', expected.transfer === 'srgb' ? 'R8G8B8A8_SRGB' : 'R8G8B8A8_UNORM') &&
    match('--assign-tf', expected.transfer) &&
    match('--assign-primaries', expected.transfer === 'srgb' ? 'bt709' : 'none') &&
    match('--assign-texcoord-origin', 'top-left') &&
    match('--mipmap-filter', 'lanczos4') &&
    match('--mipmap-wrap', 'clamp') &&
    match('--zstd', '18') &&
    args.includes('--generate-mipmap') &&
    !args.some((arg) =>
      /^--(?:uastc-rdo|runtime-mipmap|normal-mode|normalize|width|height|scale)(?:$|-)/.test(arg),
    )
  )
}

export function deriveRuntimeDocument(source) {
  const document = structuredClone(source)
  const repairs = []
  for (const material of document.materials ?? []) {
    if (!/^Reventon \/ [^/]+ \/ 18581$/.test(material.name ?? '')) continue
    const pbr = (material.pbrMetallicRoughness ??= {})
    repairs.push({ material: material.name, removedTexture: pbr.baseColorTexture?.index ?? null })
    delete pbr.baseColorTexture
    pbr.baseColorFactor = [0.025, 0.026, 0.028, pbr.baseColorFactor?.[3] ?? 1]
  }
  const tasks = [],
    mappings = [],
    textures = [],
    images = [],
    taskByKey = new Map(),
    textureMap = new Map()
  for (const [materialIndex, material] of document.materials.entries()) {
    visitTextureInfos(material, (info, transfer, slot) => {
      const original = source.textures?.[info.index]
      assert.ok(
        original && Number.isInteger(original.source),
        'Original external PNG source required',
      )
      assert.ok(
        !Object.keys(original.extensions ?? {}).length,
        'Source compressed texture is not expected',
      )
      const image = source.images[original.source]
      assert.ok(image?.uri && !image.bufferView, 'External source image required')
      const sourcePath = relativeResource(image.uri)
      const key = `${original.source}:${transfer}`
      if (!taskByKey.has(key)) {
        const task = {
          key,
          sourceImage: original.source,
          source: sourcePath,
          transfer,
          output: `texture-${String(original.source).padStart(3, '0')}-${transfer}.ktx2`,
          slots: [],
          semantics: [],
        }
        taskByKey.set(key, tasks.length)
        tasks.push(task)
        images.push({ ...structuredClone(image), uri: task.output, mimeType: 'image/ktx2' })
      }
      const taskIndex = taskByKey.get(key),
        task = tasks[taskIndex]
      const semantic = /(?:^|\.)normalTexture$|(?:^|\.)clearcoatNormalTexture$/.test(slot)
        ? 'normal'
        : transfer === 'srgb'
          ? 'color'
          : 'data'
      if (!task.semantics.includes(semantic)) task.semantics.push(semantic)
      task.slots.push({
        material: material.name,
        materialIndex,
        slot,
        texCoord: info.texCoord ?? 0,
        sourceTexture: info.index,
        alphaMode: material.alphaMode ?? 'OPAQUE',
      })
      const textureKey = `${info.index}:${transfer}`
      if (!textureMap.has(textureKey)) {
        const next = structuredClone(original)
        delete next.source
        next.extensions = { KHR_texture_basisu: { source: taskIndex } }
        textureMap.set(textureKey, textures.length)
        textures.push(next)
      }
      const nextIndex = textureMap.get(textureKey)
      mappings.push({
        material: materialIndex,
        slot,
        sourceTexture: info.index,
        texture: nextIndex,
        task: taskIndex,
      })
      info.index = nextIndex
    })
  }
  document.textures = textures
  document.images = images
  document.extensionsUsed = [...new Set([...(document.extensionsUsed ?? []), 'KHR_texture_basisu'])]
  document.extensionsRequired = [
    ...new Set([...(document.extensionsRequired ?? []), 'KHR_texture_basisu']),
  ]
  return {
    document,
    tasks,
    mappings,
    repairs,
    excludedImages: source.images.flatMap((image, index) =>
      tasks.some((task) => task.sourceImage === index) ? [] : [{ ...image, sourceImage: index }],
    ),
  }
}

export function createRuntimeGlb(original, document) {
  const model = glbWithJson(original, document)
  assert.deepEqual(
    model.subarray(20 + model.readUInt32LE(12)),
    original.subarray(20 + original.readUInt32LE(12)),
    'GLB BIN must remain byte-identical',
  )
  const initial = readGlb(original)
  for (const field of [
    'nodes',
    'meshes',
    'accessors',
    'bufferViews',
    'buffers',
    'animations',
    'skins',
    'scenes',
    'scene',
  ])
    assert.deepEqual(document[field], initial[field], `Unchanged ${field}`)
  return model
}

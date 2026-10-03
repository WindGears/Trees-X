import { readFile, mkdir, writeFile, copyFile } from 'node:fs/promises'
import { readGlb, glbWithJson, packageAsset, jsonText } from './asset-package.mjs'

const directory = 'artifacts/asset-pipeline',
  original = await readFile('public/models/reventon/reventon.glb')
const document = readGlb(original),
  index = 32
const mesh = document.meshes.find((m) => m.primitives.some((p) => p.material === index))
const material = document.materials[index],
  used = new Set()
function textures(value, remap) {
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    if (key.endsWith('Texture') && child && typeof child === 'object' && 'index' in child) {
      if (remap) child.index = remap.get(child.index)
      else used.add(child.index)
    } else textures(child, remap)
  }
}
textures(material)
const indices = [...used],
  textureMap = new Map(indices.map((id, i) => [id, i]))
const selectedTextures = indices.map((id) => document.textures[id])
const imageIndices = [...new Set(selectedTextures.map((t) => t.source))]
const selectedImages = imageIndices.map((id) => document.images[id])
selectedTextures.forEach((texture) => {
  texture.source = imageIndices.indexOf(texture.source)
})
textures(material, textureMap)
mesh.primitives = mesh.primitives.filter((p) => p.material === index)
mesh.primitives.forEach((p) => {
  p.material = 0
})
const bounds = document.accessors[mesh.primitives[0].attributes.POSITION]
const scale = 3 / Math.max(...bounds.max.map((v, i) => v - bounds.min[i]))
const center = bounds.max.map((v, i) => (v + bounds.min[i]) / 2)
document.nodes = [{ name: 'Car_Material_Probe', mesh: 0 }]
document.scenes = [{ name: 'Car material comparison', nodes: [0] }]
document.scene = 0
document.meshes = [mesh]
document.materials = [material]
document.textures = selectedTextures
document.images = selectedImages
delete document.animations
delete document.skins
delete document.cameras
const baseTexture = material.pbrMetallicRoughness.baseColorTexture.index
const sourceImage = selectedTextures[baseTexture].source
for (const variant of ['original', 'ktx2']) {
  const staging = `${directory}/probe-${variant}-source`
  await mkdir(staging, { recursive: true })
  const doc = JSON.parse(JSON.stringify(document))
  if (variant === 'ktx2') {
    doc.images[sourceImage] = { uri: 'car-surface.ktx2', mimeType: 'image/ktx2' }
    doc.textures[baseTexture].extensions = { KHR_texture_basisu: { source: sourceImage } }
    delete doc.textures[baseTexture].source
    doc.extensionsUsed = [...new Set([...(doc.extensionsUsed ?? []), 'KHR_texture_basisu'])]
    doc.extensionsRequired = [...new Set([...(doc.extensionsRequired ?? []), 'KHR_texture_basisu'])]
  }
  for (const image of doc.images)
    await copyFile(
      image.uri.endsWith('.ktx2')
        ? `${directory}/car-surface.ktx2`
        : `public/models/reventon/${image.uri}`,
      `${staging}/${image.uri}`,
    )
  await writeFile(`${staging}/model.glb`, glbWithJson(original, doc))
  const output = `${directory}/probe-${variant}-v1`
  const result = await packageAsset(`${staging}/model.glb`, output, {
    id: `car-material-${variant}`,
    version: 1,
    maxTriangles: 1500400,
    extras: [
      { path: 'studio.exr', source: 'public/models/reventon/studio.exr', role: 'environment' },
    ],
    provenance: {
      author: 'Original author not supplied',
      source: 'Reventon material index 32; original mesh, UV and PBR bindings',
      license: 'No redistribution permission supplied',
      redistribution: 'Local material comparison only',
    },
  })
  const fixture = JSON.parse(
    await readFile('server/src/test/resources/fixtures/speaker-glb-v2.json', 'utf8'),
  )
  const p = fixture.presentation
  fixture.name = '汽车材质局部对照'
  fixture.description = '原有几何、UV 与 PBR 材质，仅对照一张颜色纹理的编码。'
  p.source.bundle = {
    manifest: `/${output}/manifest.json`,
    id: result.manifest.id,
    version: 1,
    sha256: result.manifestSha256,
  }
  p.source.transform = {
    scale,
    position: [-center[0] * scale, -bounds.min[1] * scale, -center[2] * scale],
    rotation: [0, 0, 0],
  }
  p.source.finishMaterials = []
  p.source.explode = []
  p.actions = []
  p.structure = false
  p.guide = []
  p.hotspots = []
  p.finishes = [p.finishes[0]]
  p.stage.environmentFile = 'studio.exr'
  await writeFile(`${directory}/probe-${variant}.json`, await jsonText(fixture))
}
console.log('Prepared local original/KTX2 fixtures from unchanged car mesh and material 32.')

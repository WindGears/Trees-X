import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import sharp from 'sharp'
import { format } from 'prettier'
import { createStoneData, encodeDataPng, pngChunkNames, STONE_DATA_RECIPE } from './stone-data.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
export const outputDirectory = join(root, 'public/studio/amber-lounge/v1')
const sourceDirectory = join(root, 'assets-source/amber-lounge/v1')
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
const forwardPath = (path) => relative(root, path).replaceAll('\\', '/')
const originals = [
  {
    source: 'lounge-panorama-color-r2.png',
    file: 'lounge-panorama.png',
    role: 'visible-background-only',
    sha256: 'fdab4d13b88d04526f6acb4da84334a2dd11d2e6441e0f66e1378713370b5402',
  },
  {
    source: 'stone-basecolor-r2.png',
    file: 'stone-basecolor.png',
    role: 'single-slab-baseColor',
    sha256: '5f4fda38955a43e7e6cffe8aa51bca4dafe64241008709d03e5bfc398c22ce82',
  },
]

async function describe(path) {
  const bytes = await readFile(path)
  const metadata = await sharp(bytes).metadata()
  return {
    file: forwardPath(path).split('/').at(-1),
    bytes: bytes.length,
    sha256: digest(bytes),
    width: metadata.width,
    height: metadata.height,
    channels: metadata.channels,
    bitsPerChannel: 8,
    format: 'png',
    hdr: false,
  }
}

export async function buildAssetPack(directory = outputDirectory) {
  const sources = await Promise.all(
    originals.map(async (original) => {
      const path = join(sourceDirectory, original.source)
      const record = await describe(path)
      if (record.sha256 !== original.sha256) throw new Error(`Source changed: ${original.source}`)
      return { ...original, path, record }
    }),
  )
  await mkdir(directory, { recursive: true })
  const files = []
  for (const source of sources) {
    const path = join(directory, source.file)
    await copyFile(source.path, path)
    files.push({
      ...(await describe(path)),
      path: source.file,
      role: source.role,
      colorSpace: 'SRGBColorSpace',
      origin: forwardPath(source.path),
      sourceSha256: source.sha256,
      unchangedCopy: true,
      native: true,
      resampled: false,
      provenance: 'Project image_gen candidate; see source generation and acceptance records.',
    })
  }
  const maps = createStoneData()
  for (const role of ['roughness', 'normal']) {
    const file = `stone-${role}.png`
    const bytes = await encodeDataPng(maps[role], maps.size)
    if (pngChunkNames(bytes).some((name) => ['sRGB', 'gAMA', 'iCCP', 'cICP'].includes(name)))
      throw new Error(`Data PNG contains a transfer profile: ${file}`)
    const path = join(directory, file)
    await writeFile(path, bytes)
    files.push({
      ...(await describe(path)),
      path: file,
      role: role === 'normal' ? 'tangent-space-normal-opengl-positive-y' : 'perceptual-roughness',
      colorSpace: 'NoColorSpace',
      origin: 'scripts/amber-lounge/stone-data.mjs',
      provenance:
        'Project-authored periodic mathematical field; independent from generated baseColor.',
      pngChunks: pngChunkNames(bytes),
    })
  }
  const manifest = {
    schemaVersion: 1,
    id: 'amber-lounge-v1',
    generatedOn: '2026-10-15',
    status: 'runtime-candidate',
    baseUrl: '/studio/amber-lounge/v1/',
    entry: 'lounge-panorama.png',
    inputs: sources.map((source) => ({
      ...source.record,
      path: forwardPath(source.path),
      colorSpace: 'sRGB',
    })),
    files,
    recipe: { ...STONE_DATA_RECIPE, endpointBordersDuplicated: true },
    threeMaterialDefaults: {
      baseColor: { file: 'stone-basecolor.png', colorSpace: 'SRGBColorSpace', repeat: [1, 1] },
      roughness: { file: 'stone-roughness.png', colorSpace: 'NoColorSpace', repeat: [8, 8] },
      normal: {
        file: 'stone-normal.png',
        colorSpace: 'NoColorSpace',
        repeat: [8, 8],
        convention: 'OpenGL +Y',
        flipY: true,
        normalScale: [0.28, 0.28],
        note: 'Keep the standard tangent-space map orientation; do not invert green a second time.',
      },
      material: { metalness: 0, roughness: 1, ior: 1.5, clearcoat: 0.12, clearcoatRoughness: 0.22 },
    },
    licenseNotes: [
      'Panorama and baseColor were generated for this project; source prompts and originals are preserved.',
      'These images are not third-party CC0 photography and are not certified seamless.',
      'Technical maps and generator are project-authored; no new external code or asset source was introduced.',
    ],
    limitations: [
      'Panorama is an unchanged 8-bit LDR candidate for visible background; it is not an HDR light source.',
      'Runtime projection, seam and pole blending belong to the stage shader, not this asset build.',
      'BaseColor is one slab at repeat 1; its edges have not passed tileable-material acceptance.',
      'Numerical maps are subtle independent microdetail; no physical relief was recovered from the image.',
      'No AO, cast shadow, inter-part occlusion or product reflection is baked into technical maps.',
      'Material parameters are starting values, not a measured real-world stone characterization.',
      'Actual Three.js quality and lifecycle acceptance are separate from deterministic asset verification.',
    ],
  }
  await writeFile(
    join(directory, 'manifest.json'),
    await format(JSON.stringify(manifest), { parser: 'json' }),
  )
  return manifest
}

export async function verifyAssetPack(directory = outputDirectory) {
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'))
  if (manifest.entry !== 'lounge-panorama.png') throw new Error('Unexpected lounge manifest entry')
  for (const file of manifest.files) {
    if (file.path !== file.file) throw new Error(`Manifest path mismatch: ${file.file}`)
    const actual = await describe(join(directory, file.file))
    for (const key of ['sha256', 'bytes', 'width', 'height', 'channels']) {
      if (actual[key] !== file[key]) throw new Error(`Manifest mismatch: ${file.file}.${key}`)
    }
    if (file.unchangedCopy) {
      const original = await readFile(join(root, file.origin))
      if (digest(original) !== file.sourceSha256 || file.sha256 !== file.sourceSha256)
        throw new Error(`Original copy mismatch: ${file.file}`)
    }
  }
  return manifest
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const manifest = await buildAssetPack()
  await verifyAssetPack()
  console.log(JSON.stringify({ id: manifest.id, files: manifest.files, verified: true }, null, 2))
}

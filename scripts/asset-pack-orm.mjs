import { readFile, writeFile, access } from 'node:fs/promises'
import { resolve } from 'node:path'
import sharp from 'sharp'
import { digest, jsonText } from './asset-package.mjs'

const [, , aoPath, roughnessPath, metalnessPath, output] = process.argv
if (!output)
  throw new Error(
    'Usage: node scripts/asset-pack-orm.mjs ao.png roughness.png metalness.png NEW-orm.png',
  )
try {
  await access(output)
  throw new Error('Choose a new output file')
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}
const inputs = await Promise.all(
  [aoPath, roughnessPath, metalnessPath].map(async (path) => {
    if (resolve(path) === resolve(output)) throw new Error('Never overwrite a source')
    const bytes = await readFile(path),
      image = sharp(bytes),
      meta = await image.metadata()
    if (meta.depth !== 'uchar' || !meta.width || !meta.height)
      throw new Error(
        'ORM packing requires explicitly prepared 8-bit linear masks; no automatic depth conversion',
      )
    return {
      path,
      hash: digest(bytes),
      width: meta.width,
      height: meta.height,
      channel: await image.extractChannel(0).raw().toBuffer(),
    }
  }),
)
if (inputs.some((input) => input.width !== inputs[0].width || input.height !== inputs[0].height))
  throw new Error(
    'Masks must have identical dimensions and UV/texture transforms; no automatic resizing',
  )
const { width, height } = inputs[0],
  pixels = Buffer.alloc(width * height * 3)
for (let i = 0; i < width * height; i++)
  inputs.forEach((input, channel) => {
    pixels[i * 3 + channel] = input.channel[i]
  })
const packed = await sharp(pixels, { raw: { width, height, channels: 3 } })
  .png()
  .toBuffer()
await writeFile(output, packed)
await writeFile(
  output + '.json',
  await jsonText({
    inputs: inputs.map(({ path, hash }) => ({ path, sha256: hash })),
    width,
    height,
    channels: 'R=occlusion, G=roughness, B=metalness; linear data',
    sha256: digest(packed),
    note: 'Only combine masks with the same UV set, sampler, and texture transform. Update glTF material bindings explicitly.',
  }),
)
console.log('Packed ORM channels without resizing: ' + output)

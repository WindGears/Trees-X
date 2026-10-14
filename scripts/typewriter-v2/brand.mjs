import sharp from 'sharp'

/** New vector typography, rendered to the existing decal dimensions; no old image is retouched. */
export async function windGearNameplate() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="416" viewBox="0 0 1024 416">
  <text x="512" y="253" text-anchor="middle" font-family="Georgia, serif" font-style="italic"
  font-size="165" fill="#d8b368">WindGear</text></svg>`
  // Source GLTFExporter baked CanvasTexture.flipY into image rows. Match that
  // storage convention while keeping the badge's original UVs and transform.
  return sharp(Buffer.from(svg)).flip().png().toBuffer()
}

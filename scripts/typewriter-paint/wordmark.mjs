import { readFile } from 'node:fs/promises'
import { URL } from 'node:url'
import sharp from 'sharp'

export const windGearPaintSvgUrl = new URL(
  '../../assets-source/typewriter-paint/windgear.svg',
  import.meta.url,
)

/** Original outlined lettering; this source needs no installed font or network. */
export async function windGearPaintNameplate() {
  const svg = await readFile(windGearPaintSvgUrl)
  // Match the source GLTFExporter CanvasTexture row orientation. The editable
  // SVG remains upright; only the GLB-embedded PNG uses the legacy row flip.
  return sharp(svg).flip().png().toBuffer()
}

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import sharp from 'sharp'
import { windGearPaintNameplate, windGearPaintSvgUrl } from './wordmark.mjs'

test('outlined WindGear source is self-contained, correctly sized and editable by letter', async () => {
  const source = await readFile(windGearPaintSvgUrl, 'utf8')
  assert.match(source, /viewBox="0 0 1024 416"/)
  assert.match(source, /fill="#d8b368"/)
  assert.doesNotMatch(source, /<text\b|<image\b|font-family|href=/)
  assert.equal((source.match(/data-letter=/g) ?? []).length, 8)
  assert.deepEqual(
    [...source.matchAll(/data-letter="(.)"/g)].map((match) => match[1]),
    [...'WindGear'],
  )
})

test('nameplate keeps exact source dimensions, transparency and vertical storage orientation', async () => {
  const encoded = await windGearPaintNameplate()
  const metadata = await sharp(encoded).metadata()
  assert.equal(metadata.width, 1024)
  assert.equal(metadata.height, 416)
  assert.equal(metadata.hasAlpha, true)
  const actual = await sharp(encoded).raw().toBuffer()
  const expected = await sharp(await readFile(windGearPaintSvgUrl))
    .flip()
    .raw()
    .toBuffer()
  assert.deepEqual(actual, expected)
  let ink = 0
  let empty = 0
  for (let pixel = 0; pixel < actual.length; pixel += 4) {
    if (actual[pixel + 3] === 0) empty++
    if (actual[pixel + 3] === 255) {
      ink++
      // librsvg premultiplied edge composition can round an 8-bit channel once.
      for (const [channel, expected] of [216, 179, 104].entries()) {
        assert.ok(Math.abs(actual[pixel + channel] - expected) <= 1)
      }
    }
  }
  assert.ok(ink > 2500 && ink < 45000, 'Only the restrained gold lettering is opaque')
  assert.ok(empty > 1024 * 416 * 0.85, 'Nameplate retains its transparent background')
})

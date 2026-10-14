import test from 'node:test'
import assert from 'node:assert/strict'
import { decodeHalfFloatSignal, decodeSignal } from './pixels.mjs'

test('decodes native half-float padding without treating it as texels', () => {
  const bytes = Buffer.alloc(264, 0xff)
  // IEEE binary16 exact fixtures: 0, 1, -2, 0.5 and a second row.
  for (const [offset, words] of [
    [0, [0, 0x3c00, 0xc000, 0x3800]],
    [256, [0x4000, 0xbc00, 0x3400, 0x3c00]],
  ])
    words.forEach((word, i) => bytes.writeUInt16LE(word, offset + i * 2))
  const result = decodeHalfFloatSignal({
    name: 'fixture',
    type: 'Uint16Array',
    width: 1,
    height: 2,
    bytesPerRow: 256,
    base64: bytes.toString('base64'),
  })
  assert.deepEqual([...result.rgba], [0, 1, -2, 0.5, 2, -1, 0.25, 1])
  assert.deepEqual(result.bytes, bytes)
})

test('retains invalid half-float components for the analyser to report', () => {
  const bytes = Buffer.from([0, 0x7c, 0, 0xfc, 1, 0x7e, 0, 0x3c])
  const { rgba } = decodeHalfFloatSignal({
    name: 'invalid',
    type: 'Uint16Array',
    width: 1,
    height: 1,
    bytesPerRow: 256,
    base64: bytes.toString('base64'),
  })
  assert.equal(rgba[0], Infinity)
  assert.equal(rgba[1], -Infinity)
  assert.ok(Number.isNaN(rgba[2]))
})

test('rejects an incompatible component type or truncated last row', () => {
  const fixture = {
    name: 'invalid',
    type: 'Uint16Array',
    width: 1,
    height: 1,
    bytesPerRow: 256,
    base64: Buffer.alloc(8).toString('base64'),
  }
  assert.throws(() => decodeHalfFloatSignal({ ...fixture, type: 'Float32Array' }), /layout/)
  assert.throws(() => decodeHalfFloatSignal({ ...fixture, base64: '' }), /layout/)
})

test('distinguishes pre-fix RGBA8 normalization from actual HDR half-float data', () => {
  const byteSignal = {
    name: 'legacy raw RTT',
    type: 'Uint8Array',
    width: 1,
    height: 1,
    bytesPerRow: 256,
    base64: Buffer.from([0, 128, 255, 255]).toString('base64'),
  }
  assert.deepEqual([...decodeSignal(byteSignal).rgba], [0, Math.fround(128 / 255), 1, 1])
  // binary16 2, -2, 1, 10000. Positive HDR, signed correction and miss distance survive.
  const bytes = Buffer.from([0, 0x40, 0, 0xc0, 0, 0x3c, 0xe2, 0x70])
  assert.deepEqual(
    [
      ...decodeSignal({ ...byteSignal, type: 'Uint16Array', base64: bytes.toString('base64') })
        .rgba,
    ],
    [2, -2, 1, 10000],
  )
})

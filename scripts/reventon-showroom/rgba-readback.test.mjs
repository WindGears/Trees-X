import assert from 'node:assert/strict'
import test from 'node:test'
import { unpackRgbaReadback } from './rgba-readback.mjs'

for (const Type of [Uint8Array, Uint16Array, Float32Array]) {
  for (const width of [1, 150, 200, 256]) {
    test(`${Type.name}: ${width}px, padded rows and unpadded last row`, () => {
      const height = 3,
        stride =
          (Math.ceil((width * 4 * Type.BYTES_PER_ELEMENT) / 256) * 256) / Type.BYTES_PER_ELEMENT
      const input = new Type((height - 1) * stride + width * 4).fill(99)
      const expected = new Type(width * height * 4)
      for (let y = 0; y < height; y++) {
        input.fill(y + 1, y * stride, y * stride + width * 4)
        expected.fill(y + 1, y * width * 4, (y + 1) * width * 4)
      }
      assert.deepEqual(unpackRgbaReadback(input, width, height), expected)
      assert.equal(input[stride], 2, 'Borrowed source remains intact')
    })
  }
}
test('Reject unknown packed layout instead of silently treating padding as pixels', () => {
  assert.throws(() => unpackRgbaReadback(new Uint8Array(1200), 150, 2), /layout/)
})

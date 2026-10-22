import assert from 'node:assert/strict'
import sharp from 'sharp'

/** Offline screenshot comparison only; never part of the measured GPU loop. */
export function imageDifference(left, right, channels = 3) {
  assert.equal(left.length, right.length, 'Image dimensions must match')
  assert.ok(left.length > 0 && left.length % channels === 0)
  let total = 0,
    changed = 0,
    max = 0
  for (let pixel = 0; pixel < left.length; pixel += channels) {
    let different = false
    for (let channel = 0; channel < channels; channel++) {
      const delta = Math.abs(left[pixel + channel] - right[pixel + channel])
      total += delta
      max = Math.max(max, delta)
      different ||= delta > 1
    }
    changed += different
  }
  return {
    pixels: left.length / channels,
    changedOverOneByte: changed,
    maxByteDifference: max,
    meanByteDifference: total / left.length,
  }
}

export async function compareCanvasImages(leftPath, rightPath) {
  const [left, right] = await Promise.all(
    [leftPath, rightPath].map((path) =>
      sharp(path).removeAlpha().raw().toBuffer({ resolveWithObject: true }),
    ),
  )
  assert.deepEqual(left.info, right.info, 'Fixed screenshot dimensions must match')
  return {
    width: left.info.width,
    height: left.info.height,
    ...imageDifference(left.data, right.data, left.info.channels),
  }
}

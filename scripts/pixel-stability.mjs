/* global createImageBitmap, OffscreenCanvas, fetch */
import { expect } from '@playwright/test'

// Transparent WebGL canvases are composited over CSS. Edge can round an isolated
// background pixel by one level between captures; that is not camera movement.
export async function assertStablePixels(page, before, after, message) {
  const difference = await page.evaluate(
    async ([a, b]) => {
      const decode = async (base64) => {
        const bitmap = await createImageBitmap(
          await (await fetch(`data:image/png;base64,${base64}`)).blob(),
        )
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
        const context = canvas.getContext('2d')
        context.drawImage(bitmap, 0, 0)
        bitmap.close()
        return context.getImageData(0, 0, canvas.width, canvas.height)
      }
      const first = await decode(a),
        second = await decode(b)
      let changedPixels = 0,
        maxChannelDifference = 0
      if (first.width !== second.width || first.height !== second.height)
        return { changedPixels: first.width * first.height, maxChannelDifference: 255 }
      for (let i = 0; i < first.data.length; i += 4) {
        let changed = false
        for (let channel = 0; channel < 4; channel++) {
          const delta = Math.abs(first.data[i + channel] - second.data[i + channel])
          if (delta) changed = true
          maxChannelDifference = Math.max(maxChannelDifference, delta)
        }
        if (changed) changedPixels++
      }
      return { changedPixels, maxChannelDifference }
    },
    [before.toString('base64'), after.toString('base64')],
  )
  expect(difference.maxChannelDifference, message).toBeLessThanOrEqual(1)
  expect(difference.changedPixels, message).toBeLessThanOrEqual(4)
  return difference
}

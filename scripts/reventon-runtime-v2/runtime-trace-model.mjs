/* global structuredClone */
import assert from 'node:assert/strict'
import { digest, relativeResource } from '../asset-package.mjs'

export const TRACE_TEXTURE_SIZE = 256
export const TRACE_TEXTURE_PURPOSE =
  'CPU GI atlas input only; not a visible material or a source master'
export const TRACE_TEXTURE_METHOD = Object.freeze({
  processor: 'sharp',
  ignoreIcc: true,
  gamma: false,
  fit: 'fill',
  kernel: 'lanczos3',
  normalPackingUnchanged: true,
  alphaResampling: 'independent',
  format: 'png',
  channels: 4,
  bitDepth: 8,
})

export function traceTexturePath(output) {
  relativeResource(output)
  assert.match(output, /^[a-zA-Z0-9_.-]+\.ktx2$/, 'Trace image belongs to a runtime KTX2')
  return 'trace/' + output.slice(0, -5) + '.png'
}

/** Image extras become Texture.userData in the existing GLTFLoader. No geometry is rewritten. */
export function withTraceImages(document, tasks) {
  const next = structuredClone(document)
  assert.equal(next.images.length, tasks.length, 'One trace binding per runtime image')
  for (const [index, task] of tasks.entries()) {
    const image = next.images[index]
    assert.equal(image.uri, task.output, 'Runtime image order must match derived tasks')
    assert.equal(image.extras?.treesTraceImage, undefined, 'Do not overwrite a trace binding')
    image.extras = { ...image.extras, treesTraceImage: traceTexturePath(task.output) }
  }
  return next
}

export function createTraceTextureRecord(task, input, bytes) {
  return {
    key: task.key,
    sourceImage: task.sourceImage,
    source: task.source,
    texture: task.output,
    output: traceTexturePath(task.output),
    transfer: task.transfer,
    semantics: [...task.semantics],
    sourceWidth: input.sourceWidth,
    sourceHeight: input.sourceHeight,
    sourceBitDepth: input.sourceBitDepth,
    inputBytes: input.inputBytes,
    inputSha256: input.inputSha256,
    width: TRACE_TEXTURE_SIZE,
    height: TRACE_TEXTURE_SIZE,
    outputBytes: bytes.length,
    outputSha256: digest(bytes),
    purpose: TRACE_TEXTURE_PURPOSE,
    method: { ...TRACE_TEXTURE_METHOD },
  }
}

export function verifyTraceTextureHeader(bytes) {
  assert.ok(bytes.length >= 33, 'Trace PNG header is complete')
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'Trace PNG signature')
  assert.equal(bytes.readUInt32BE(8), 13, 'Trace PNG IHDR length')
  assert.equal(bytes.toString('ascii', 12, 16), 'IHDR', 'Trace PNG starts with IHDR')
  assert.equal(bytes.readUInt32BE(16), TRACE_TEXTURE_SIZE, 'Trace PNG width')
  assert.equal(bytes.readUInt32BE(20), TRACE_TEXTURE_SIZE, 'Trace PNG height')
  assert.equal(bytes[24], 8, 'Trace PNG uses 8 bits per channel')
  assert.equal(bytes[25], 6, 'Trace PNG is RGBA')
  return { width: TRACE_TEXTURE_SIZE, height: TRACE_TEXTURE_SIZE, channels: 4, bitDepth: 8 }
}

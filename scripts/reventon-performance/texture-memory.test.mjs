import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  collectModelTextureDescriptors,
  estimateTextureBytes,
  summarizeModelTextureMemory,
} from './texture-memory.mjs'

const descriptor = (changes = {}) => ({
  width: 4096,
  height: 4096,
  depthOrArrayLayers: 1,
  mipLevelCount: 13,
  sampleCount: 1,
  dimension: '2d',
  format: 'bc7-rgba-unorm',
  ...changes,
})

describe('native model GPU texture logical storage', () => {
  it('counts complete 4K BC7 mip tails as at least one 16-byte block each', () => {
    assert.deepEqual(estimateTextureBytes(descriptor()), {
      known: true,
      bytes: 22369648,
      reason: null,
    })
    assert.equal(
      estimateTextureBytes(descriptor({ format: 'bc7-rgba-unorm-srgb' })).bytes,
      22369648,
    )
    assert.equal(estimateTextureBytes(descriptor({ format: 'bc1-rgba-unorm' })).bytes, 11184824)
  })
  it('accounts for small odd block dimensions, array layers and sample counts', () => {
    assert.equal(
      estimateTextureBytes(
        descriptor({ width: 5, height: 7, mipLevelCount: 3, depthOrArrayLayers: 6 }),
      ).bytes,
      (64 + 16 + 16) * 6,
    )
    assert.equal(
      estimateTextureBytes(
        descriptor({ width: 4, height: 4, mipLevelCount: 1, sampleCount: 4, format: 'rgba8unorm' }),
      ).bytes,
      256,
    )
  })
  it('handles uncompressed HDR and reduces depth only for 3D mip levels', () => {
    const volume = descriptor({
      width: 4,
      height: 4,
      depthOrArrayLayers: 4,
      mipLevelCount: 3,
      format: 'rgba16float',
    })
    assert.equal(estimateTextureBytes({ ...volume, dimension: '3d' }).bytes, (64 + 8 + 1) * 8)
    assert.equal(estimateTextureBytes(volume).bytes, (16 + 4 + 1) * 4 * 8)
    assert.equal(estimateTextureBytes({ ...volume, dimension: '1d' }).bytes, (4 + 2 + 1) * 4 * 8)
  })
  it('keeps unknown and implementation-dependent layouts explicitly unknown', () => {
    for (const format of ['custom-format', 'depth24plus', 'bc7-invalid', undefined]) {
      const result = estimateTextureBytes(descriptor({ format }))
      assert.equal(result.known, false)
      assert.equal(result.bytes, null)
      assert.match(result.reason, /Unknown storage layout/)
    }
    assert.equal(estimateTextureBytes(descriptor({ width: 0 })).known, false)
    assert.equal(estimateTextureBytes(descriptor({ mipLevelCount: undefined })).bytes, null)
  })
  it('deduplicates repeated material references and UV clones sharing one native GPUTexture', () => {
    const original = { isTexture: true },
      uvClone = { isTexture: true },
      notYetInitialized = { isTexture: true },
      gpuTexture = descriptor(),
      materials = [
        { map: original, normalMap: original },
        { map: uvClone, aoMap: notYetInitialized },
      ],
      root = { traverse: (visitor) => materials.forEach((material) => visitor({ material })) },
      allocations = new Map([
        [original, { texture: gpuTexture }],
        [uvClone, { texture: gpuTexture }],
      ]),
      collected = collectModelTextureDescriptors(root, {
        backend: { get: (tex) => allocations.get(tex) },
      }),
      summary = summarizeModelTextureMemory(collected)
    assert.equal(summary.sourceTextures, 3)
    assert.equal(summary.uninitializedSourceTextures, 1)
    assert.equal(summary.initializedNativeTextures, 1)
    assert.equal(summary.nativeTextures[0].sourceTextureCount, 2)
    assert.equal(summary.totalBytes, 22369648)
    assert.match(summary.meaning, /not physical resident VRAM or complete scene/)
  })
  it('supports material arrays, no material and independent native allocations', () => {
    const one = { isTexture: true },
      two = { isTexture: true },
      entries = [{}, { material: [{ map: one }, { normalMap: two }] }],
      root = { traverse: (visit) => entries.forEach(visit) },
      collected = collectModelTextureDescriptors(root, {
        backend: { get: () => ({ texture: descriptor() }) },
      })
    assert.equal(collected.sourceTextures, 2)
    assert.equal(collected.initializedNativeTextures, 2)
    assert.equal(summarizeModelTextureMemory(collected).totalBytes, 44739296)
  })
  it('reports a known subtotal but no fictitious total when any descriptor is unknown', () => {
    const summary = summarizeModelTextureMemory({
      sourceTextures: 2,
      uninitializedSourceTextures: 0,
      initializedNativeTextures: 2,
      nativeTextures: [descriptor(), descriptor({ format: 'vendor-private' })],
    })
    assert.equal(summary.knownBytes, 22369648)
    assert.equal(summary.unknownTextures, 1)
    assert.equal(summary.totalBytes, null)
  })
})

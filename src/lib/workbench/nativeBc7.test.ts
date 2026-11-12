import { zstdDecompressSync } from 'node:zlib'
import { NoColorSpace, RGBA_BPTC_Format, SRGBColorSpace } from 'three'
import { describe, expect, it, vi } from 'vitest'
import {
  createNativeBc7Decoder,
  inspectNativeBc7,
  type NativeBc7Level,
  type NativeBc7Reply,
} from './nativeBc7'

// Independent KTX-Parse fixture: one 4×4 block at each of three levels.
const fixture =
  'q0tUWCAyMLsNChoKkgAAAAEAAAAEAAAABAAAAAAAAAAAAAAAAQAAAAMAAAACAAAAmAAAACwAAADEAAAAOAAAAAAAAAAAAAAAAAAAAAAAAAAuAQAAAAAAABkAAAAAAAAAEAAAAAAAAAAVAQAAAAAAABkAAAAAAAAAEAAAAAAAAAD8AAAAAAAAABkAAAAAAAAAEAAAAAAAAAAsAAAAAAAAAAIAKACGAQIAAwMAABAAAAAAAAAAAAB/AAAAAAAAAAAA/////xIAAABLVFhvcmllbnRhdGlvbgByZAAAABsAAABLVFh3cml0ZXIAS1RYLVBhcnNlIHYxLjAuMQAAKLUv/SAQgQAAAQIDBAUGBwgJCgsMDQ4PECi1L/0gEIEAAAECAwQFBgcICQoLDA0ODxAotS/9IBCBAAABAgMEBQYHCAkKCwwNDg8Q'

const ktx = () => Uint8Array.from(Buffer.from(fixture, 'base64')).buffer

function worker() {
  return {
    onmessage: null as ((event: MessageEvent<NativeBc7Reply>) => void) | null,
    onerror: null,
    onmessageerror: null,
    postMessage: vi.fn<(levels: NativeBc7Level[]) => void>(),
    terminate: vi.fn(),
  }
}

describe('registered BC7 texture decoding', () => {
  it('preserves BC7 blocks, level sizes and color space, leaving portable files to Three', async () => {
    const instance = worker()
    instance.postMessage.mockImplementation((input) => {
      const levels = input.map(({ data }) => Uint8Array.from(zstdDecompressSync(data)))
      instance.onmessage?.(new MessageEvent('message', { data: { levels } }))
    })
    const source = ktx(),
      linear = ktx(),
      portable = ktx()
    new DataView(linear).setUint32(12, 145, true)
    new Uint8Array(linear).set([0, 1], 165) // DFD primaries and transfer
    new DataView(portable).setUint32(12, 0, true)
    expect(inspectNativeBc7(linear)?.colorSpace).toBe(NoColorSpace)
    expect(inspectNativeBc7(portable)).toBeUndefined()
    const decode = createNativeBc7Decoder(new AbortController().signal, () => instance)
    const texture = await decode.load(source)
    expect(texture?.colorSpace).toBe(SRGBColorSpace)
    expect(texture?.format).toBe(RGBA_BPTC_Format)
    expect(texture?.generateMipmaps).toBe(false)
    expect(texture?.mipmaps.map((mip) => [mip.width, mip.height])).toEqual([
      [4, 4],
      [2, 2],
      [1, 1],
    ])
    for (const mip of texture?.mipmaps ?? [])
      expect(Array.from(mip.data)).toEqual(Array.from({ length: 16 }, (_, i) => i + 1))
    expect(new Uint8Array(source)).toEqual(new Uint8Array(ktx()))
    texture?.dispose()
    decode.dispose()
    expect(instance.terminate).toHaveBeenCalledTimes(1)
  })

  it('bounds work to two active inputs and releases all running and queued jobs on cancel', async () => {
    const signal = new AbortController()
    const workers: ReturnType<typeof worker>[] = []
    const decode = createNativeBc7Decoder(signal.signal, () => {
      const instance = worker()
      workers.push(instance)
      return instance
    })
    const pending = Promise.allSettled([decode.load(ktx()), decode.load(ktx()), decode.load(ktx())])
    await vi.waitFor(() => expect(workers).toHaveLength(2))
    expect(workers.every(({ postMessage }) => postMessage.mock.calls.length === 1)).toBe(true)
    const cancelled = new Error('superseded selection')
    signal.abort(cancelled)
    expect(await pending).toEqual(
      Array.from({ length: 3 }, () => ({
        status: 'rejected',
        reason: cancelled,
      })),
    )
    expect(workers.every(({ terminate }) => terminate.mock.calls.length === 1)).toBe(true)
    expect(decode.load(ktx())).toBeUndefined()
    decode.dispose()
  })

  it('keeps the verified input available for the original decoder after a worker failure', async () => {
    const instance = worker(),
      source = ktx()
    instance.postMessage.mockImplementation(() => {
      instance.onmessage?.(new MessageEvent('message', { data: { error: 'decoder failed' } }))
    })
    const decode = createNativeBc7Decoder(new AbortController().signal, () => instance)
    await expect(decode.load(source)).rejects.toThrow('decoder failed')
    expect(inspectNativeBc7(source)?.mips).toHaveLength(3)
    expect(decode.load(source)).toBeUndefined()
    expect(instance.terminate).toHaveBeenCalledTimes(1)
    decode.dispose()
  })
})

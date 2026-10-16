import { readFile } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ClampToEdgeWrapping, LinearMipmapLinearFilter, SRGBColorSpace, Texture } from 'three'
import { loadLoungeCleanRoom, loadLoungeLayerAssets } from './loungeLayerAssets'

const baseUrl = '/studio/amber-lounge/layers-v1/',
  files = ['clean-room.png', 'chair-table.png', 'table-lamp.png'],
  fixtures = new Map(
    await Promise.all(
      files.map(async (file) => {
        const bytes = await readFile(
          new URL('../../../../public' + baseUrl + file, import.meta.url),
        )
        return [baseUrl + file, Uint8Array.from(bytes).buffer] as const
      }),
    ),
  ),
  manifest = JSON.parse(
    await readFile(
      new URL('../../../../public' + baseUrl + 'manifest.json', import.meta.url),
      'utf8',
    ),
  ) as {
    files: {
      file: string
      bytes: number
      sha256: string
      width: number
      height: number
      hasAlpha: boolean
    }[]
  },
  bitmaps: { bitmap: ImageBitmap; close: ReturnType<typeof vi.fn> }[] = []

function bitmap(width: number, height: number) {
  const close = vi.fn(),
    image = { width, height, close } as unknown as ImageBitmap
  bitmaps.push({ bitmap: image, close })
  return image
}

function response(input: RequestInfo | URL) {
  const bytes = fixtures.get(String(input))
  if (!bytes) throw new Error('Unexpected resource ' + String(input))
  return new Response(bytes, { headers: { 'Content-Length': String(bytes.byteLength) } })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((accept) => {
    resolve = accept
  })
  return { promise, resolve }
}

beforeEach(() => {
  bitmaps.length = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => response(input)),
  )
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async (source: Blob) => {
      const header = new DataView(await source.arrayBuffer())
      return bitmap(header.getUint32(16), header.getUint32(20))
    }),
  )
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('fixed generated lounge layer assets', () => {
  it('validates actual bytes against trusted manifest records and owns all textures and bitmaps once', async () => {
    const controller = new AbortController(),
      assets = await loadLoungeLayerAssets(controller.signal),
      textures = [assets.cleanRoom, assets.chair, assets.lamp],
      releases = textures.map((image) => vi.spyOn(image, 'dispose'))
    expect(fetch).toHaveBeenCalledTimes(3)
    for (const [index, image] of textures.entries()) {
      const record = manifest.files.find((entry) => entry.file === files[index])!
      expect(image.userData.loungeLayerAsset).toMatchObject({
        packId: 'amber-lounge-layers-v1',
        file: record.file,
        bytes: record.bytes,
        sha256: record.sha256,
        width: record.width,
        height: record.height,
        hasAlpha: record.hasAlpha,
      })
      expect(image.colorSpace).toBe(SRGBColorSpace)
      expect(image.wrapS).toBe(ClampToEdgeWrapping)
      expect(image.wrapT).toBe(ClampToEdgeWrapping)
      expect(image.minFilter).toBe(LinearMipmapLinearFilter)
      expect(image.generateMipmaps).toBe(true)
      expect(image.flipY).toBe(false)
    }
    for (const [input, options] of vi.mocked(fetch).mock.calls) {
      expect(input).toMatch(/^\/studio\/amber-lounge\/layers-v1\/[^/]+\.png$/)
      expect(options).toMatchObject({
        mode: 'same-origin',
        credentials: 'same-origin',
        redirect: 'error',
      })
    }
    for (const [, options] of vi.mocked(createImageBitmap).mock.calls)
      expect(options).toEqual({
        imageOrientation: 'flipY',
        premultiplyAlpha: 'none',
        colorSpaceConversion: 'none',
      })
    controller.abort()
    expect(releases.every((release) => release.mock.calls.length === 0)).toBe(true)
    assets.dispose()
    assets.dispose()
    for (const release of releases) expect(release).toHaveBeenCalledTimes(1)
    for (const item of bitmaps) expect(item.close).toHaveBeenCalledTimes(1)
  })

  it('rejects corrupt equal-sized PNG bytes and closes any successful siblings', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (!String(input).endsWith('chair-table.png')) return response(input)
        const bytes = new Uint8Array(fixtures.get(String(input))!.slice(0))
        bytes[100] = bytes[100]! ^ 1
        return new Response(bytes)
      }),
    )
    await expect(loadLoungeLayerAssets(new AbortController().signal)).rejects.toThrow('校验失败')
    expect(bitmaps.every((item) => item.bitmap.width !== 1536)).toBe(true)
    for (const item of bitmaps) expect(item.close).toHaveBeenCalledTimes(1)
  })

  it('cleans already decoded siblings after an HTTP failure', async () => {
    const pending = deferred<Response>(),
      releases = vi.spyOn(Texture.prototype, 'dispose')
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).endsWith('table-lamp.png') ? pending.promise : response(input),
      ),
    )
    const result = expect(loadLoungeLayerAssets(new AbortController().signal)).rejects.toThrow(
      '503',
    )
    await vi.waitFor(() => expect(bitmaps).toHaveLength(2))
    pending.resolve(new Response('', { status: 503 }))
    await result
    expect(releases).toHaveBeenCalledTimes(2)
    for (const item of bitmaps) expect(item.close).toHaveBeenCalledTimes(1)
  })

  it('rejects oversized transfers before decode and rejects decoded dimension mismatches', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (input: RequestInfo | URL) =>
          new Response(fixtures.get(String(input)), { headers: { 'Content-Length': '9999999' } }),
      ),
    )
    await expect(loadLoungeLayerAssets(new AbortController().signal)).rejects.toThrow('大小不符')
    expect(createImageBitmap).not.toHaveBeenCalled()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => response(input)),
    )
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => bitmap(1, 1)),
    )
    const releases = vi.spyOn(Texture.prototype, 'dispose')
    await expect(loadLoungeLayerAssets(new AbortController().signal)).rejects.toThrow('尺寸不符')
    expect(releases).not.toHaveBeenCalled()
    for (const item of bitmaps) expect(item.close).toHaveBeenCalledTimes(1)
  })

  it('does not start an aborted request and cancels in-flight fetches before decoding', async () => {
    const cancelled = new AbortController()
    cancelled.abort()
    await expect(loadLoungeLayerAssets(cancelled.signal)).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(fetch).not.toHaveBeenCalled()
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_input: RequestInfo | URL, options?: RequestInit) =>
          new Promise<Response>((_accept, reject) => {
            options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), {
              once: true,
            })
          }),
      ),
    )
    const controller = new AbortController(),
      result = expect(loadLoungeLayerAssets(controller.signal)).rejects.toMatchObject({
        name: 'AbortError',
      })
    controller.abort()
    await result
    expect(createImageBitmap).not.toHaveBeenCalled()
  })

  it('returns promptly after cancellation and closes late non-cancellable ImageBitmap results', async () => {
    const pending: ReturnType<typeof deferred<ImageBitmap>>[] = [],
      releases = vi.spyOn(Texture.prototype, 'dispose')
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(() => {
        const result = deferred<ImageBitmap>()
        pending.push(result)
        return result.promise
      }),
    )
    const controller = new AbortController(),
      result = expect(loadLoungeLayerAssets(controller.signal)).rejects.toMatchObject({
        name: 'AbortError',
      })
    await vi.waitFor(() => expect(pending).toHaveLength(3))
    controller.abort()
    await result
    for (const entry of pending) entry.resolve(bitmap(100, 100))
    await Promise.resolve()
    expect(releases).not.toHaveBeenCalled()
    for (const item of bitmaps) expect(item.close).toHaveBeenCalledTimes(1)
  })
})

describe('clean room without retired furniture assets', () => {
  it('requests only the trusted clean-room PNG and owns its texture and bitmap exactly once', async () => {
    const controller = new AbortController(),
      assets = await loadLoungeCleanRoom(controller.signal),
      release = vi.spyOn(assets.cleanRoom, 'dispose'),
      record = manifest.files.find((entry) => entry.file === 'clean-room.png')!
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe(baseUrl + 'clean-room.png')
    expect(vi.mocked(fetch).mock.calls[0]?.[1]).toMatchObject({
      mode: 'same-origin',
      credentials: 'same-origin',
      redirect: 'error',
    })
    expect(assets.cleanRoom.userData.loungeLayerAsset).toMatchObject({
      file: record.file,
      bytes: record.bytes,
      sha256: record.sha256,
      width: record.width,
      height: record.height,
      hasAlpha: record.hasAlpha,
      key: 'cleanRoom',
      packId: 'amber-lounge-layers-v1',
    })
    expect(assets.cleanRoom.colorSpace).toBe(SRGBColorSpace)
    expect(assets.cleanRoom.flipY).toBe(false)
    expect(bitmaps).toHaveLength(1)
    controller.abort()
    expect(release).not.toHaveBeenCalled()
    expect(bitmaps[0]!.close).not.toHaveBeenCalled()
    assets.dispose()
    assets.dispose()
    expect(release).toHaveBeenCalledTimes(1)
    expect(bitmaps[0]!.close).toHaveBeenCalledTimes(1)
  })

  it('does not request any image when already cancelled', async () => {
    const controller = new AbortController(),
      reason = new Error('clean room no longer needed')
    controller.abort(reason)
    await expect(loadLoungeCleanRoom(controller.signal)).rejects.toBe(reason)
    expect(fetch).not.toHaveBeenCalled()
    expect(createImageBitmap).not.toHaveBeenCalled()
  })

  it('rejects corrupted clean-room bytes before creating a bitmap or texture', async () => {
    const bytes = new Uint8Array(fixtures.get(baseUrl + 'clean-room.png')!.slice(0))
    bytes[100] = bytes[100]! ^ 1
    vi.mocked(fetch).mockResolvedValue(new Response(bytes))
    const release = vi.spyOn(Texture.prototype, 'dispose')
    await expect(loadLoungeCleanRoom(new AbortController().signal)).rejects.toThrow('校验失败')
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(createImageBitmap).not.toHaveBeenCalled()
    expect(release).not.toHaveBeenCalled()
  })

  it('cancels promptly during decode and closes a late bitmap without allocating a texture', async () => {
    const pending = deferred<ImageBitmap>(),
      controller = new AbortController(),
      release = vi.spyOn(Texture.prototype, 'dispose')
    vi.mocked(createImageBitmap).mockReturnValue(pending.promise)
    const rejected = expect(loadLoungeCleanRoom(controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    })
    await vi.waitFor(() => expect(createImageBitmap).toHaveBeenCalledTimes(1))
    controller.abort()
    await rejected
    pending.resolve(bitmap(1774, 887))
    await Promise.resolve()
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(release).not.toHaveBeenCalled()
    expect(bitmaps[0]!.close).toHaveBeenCalledTimes(1)
  })

  it('cancels an in-flight request when the transfer deadline expires', async () => {
    const deadline = new AbortController(),
      reason = new DOMException('clean-room transfer expired', 'TimeoutError')
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal)
    vi.mocked(fetch).mockImplementation(
      (_input, options) =>
        new Promise<Response>((_accept, reject) => {
          options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), {
            once: true,
          })
        }),
    )
    const rejected = expect(loadLoungeCleanRoom(new AbortController().signal)).rejects.toBe(reason)
    expect(timeout).toHaveBeenCalledWith(180_000)
    deadline.abort(reason)
    await rejected
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(createImageBitmap).not.toHaveBeenCalled()
  })
})

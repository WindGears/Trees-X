import { readFile } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ClampToEdgeWrapping,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RepeatWrapping,
  SRGBColorSpace,
  Texture,
} from 'three'
import { loadLoungeAssets } from './loungeAssets'

const files = [
  'lounge-panorama.png',
  'stone-basecolor.png',
  'stone-roughness.png',
  'stone-normal.png',
]
const fixtures = new Map<string, ArrayBuffer>(
  await Promise.all(
    files.map(async (file) => {
      const data = await readFile(
        new URL(`../../../../public/studio/amber-lounge/v1/${file}`, import.meta.url),
      )
      return [`/studio/amber-lounge/v1/${file}`, Uint8Array.from(data).buffer] as const
    }),
  ),
)
const manifest = JSON.parse(
  await readFile(
    new URL('../../../../public/studio/amber-lounge/v1/manifest.json', import.meta.url),
    'utf8',
  ),
) as { files: { file: string; bytes: number; sha256: string; width: number; height: number }[] }

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept
    reject = fail
  })
  return { promise, resolve, reject }
}

const bitmaps: { bitmap: ImageBitmap; close: ReturnType<typeof vi.fn> }[] = []
function bitmap(width: number, height: number) {
  const close = vi.fn()
  const image = { width, height, close } as unknown as ImageBitmap
  bitmaps.push({ bitmap: image, close })
  return image
}

function response(input: RequestInfo | URL) {
  const bytes = fixtures.get(String(input))
  if (!bytes) throw new Error(`Unexpected asset path: ${String(input)}`)
  return new Response(bytes, {
    status: 200,
    headers: { 'Content-Length': String(bytes.byteLength) },
  })
}

beforeEach(() => {
  bitmaps.length = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => response(input)),
  )
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async (source: Blob, options?: ImageBitmapOptions) => {
      expect(options?.imageOrientation).toBe('flipY')
      const data = new DataView(await source.arrayBuffer())
      return bitmap(data.getUint32(16), data.getUint32(20))
    }),
  )
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('amber lounge runtime asset ownership', () => {
  it('verifies all same-origin manifest records, data semantics and idempotent disposal', async () => {
    const pack = await loadLoungeAssets(new AbortController().signal)
    const textures = [pack.panorama, pack.baseColor, pack.roughness, pack.normal]
    const disposals = textures.map((texture) => vi.spyOn(texture, 'dispose'))
    expect(fetch).toHaveBeenCalledTimes(4)
    for (const [index, texture] of textures.entries()) {
      const record = manifest.files.find((entry) => entry.file === files[index])!
      expect(texture.userData.loungeAsset).toMatchObject({
        packId: 'amber-lounge-v1',
        file: record.file,
        bytes: record.bytes,
        sha256: record.sha256,
        width: record.width,
        height: record.height,
      })
      expect(texture.flipY).toBe(false)
      expect(texture.generateMipmaps).toBe(true)
      expect(texture.minFilter).toBe(LinearMipmapLinearFilter)
    }
    for (const call of vi.mocked(fetch).mock.calls) {
      expect(call[0]).toMatch(/^\/studio\/amber-lounge\/v1\/[^/]+\.png$/)
      expect(call[1]).toMatchObject({
        mode: 'same-origin',
        redirect: 'error',
        credentials: 'same-origin',
      })
    }
    for (const call of vi.mocked(createImageBitmap).mock.calls)
      expect(call[1]).toEqual({
        imageOrientation: 'flipY',
        premultiplyAlpha: 'none',
        colorSpaceConversion: 'none',
      })
    expect(pack.panorama.colorSpace).toBe(SRGBColorSpace)
    expect(pack.panorama.wrapS).toBe(RepeatWrapping)
    expect(pack.panorama.wrapT).toBe(ClampToEdgeWrapping)
    expect(pack.baseColor.colorSpace).toBe(SRGBColorSpace)
    expect(pack.baseColor.wrapS).toBe(ClampToEdgeWrapping)
    expect(pack.baseColor.wrapT).toBe(ClampToEdgeWrapping)
    expect(pack.baseColor.repeat.toArray()).toEqual([1, 1])
    for (const texture of [pack.roughness, pack.normal]) {
      expect(texture.colorSpace).toBe(NoColorSpace)
      expect(texture.wrapS).toBe(RepeatWrapping)
      expect(texture.wrapT).toBe(RepeatWrapping)
      expect(texture.repeat.toArray()).toEqual([8, 8])
    }
    pack.dispose()
    pack.dispose()
    for (const dispose of disposals) expect(dispose).toHaveBeenCalledOnce()
    for (const item of bitmaps) expect(item.close).toHaveBeenCalledOnce()
  })

  it('cleans successfully decoded siblings when another resource returns an HTTP error', async () => {
    const pending = deferred<Response>()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).endsWith('stone-normal.png') ? pending.promise : response(input),
      ),
    )
    const dispose = vi.spyOn(Texture.prototype, 'dispose')
    const result = expect(loadLoungeAssets(new AbortController().signal)).rejects.toThrow('503')
    await vi.waitFor(() => expect(bitmaps).toHaveLength(3))
    pending.resolve(new Response('', { status: 503 }))
    await result
    expect(dispose).toHaveBeenCalledTimes(3)
    for (const item of bitmaps) expect(item.close).toHaveBeenCalledOnce()
  })

  it('does not fetch for a previously aborted request', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(loadLoungeAssets(controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetch).not.toHaveBeenCalled()
    expect(createImageBitmap).not.toHaveBeenCalled()
  })

  it('aborts in-flight requests before any texture or decode is created', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_input: RequestInfo | URL, options?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), {
              once: true,
            })
          }),
      ),
    )
    const controller = new AbortController()
    const dispose = vi.spyOn(Texture.prototype, 'dispose')
    const result = expect(loadLoungeAssets(controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    })
    controller.abort()
    await result
    expect(createImageBitmap).not.toHaveBeenCalled()
    expect(dispose).not.toHaveBeenCalled()
  })

  it('rejects promptly on abort and closes late non-cancellable decodes exactly once', async () => {
    const pending: ReturnType<typeof deferred<ImageBitmap>>[] = []
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(() => {
        const result = deferred<ImageBitmap>()
        pending.push(result)
        return result.promise
      }),
    )
    const dispose = vi.spyOn(Texture.prototype, 'dispose')
    const controller = new AbortController()
    const result = expect(loadLoungeAssets(controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    })
    await vi.waitFor(() => expect(pending).toHaveLength(4))
    controller.abort()
    await result
    for (const item of pending) item.resolve(bitmap(512, 512))
    await Promise.resolve()
    for (const item of bitmaps) expect(item.close).toHaveBeenCalledOnce()
    expect(dispose).not.toHaveBeenCalled()
  })

  it('rejects equal-sized corrupt bytes before decoding them and cleans partial successes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (!String(input).endsWith('lounge-panorama.png')) return response(input)
        const corrupt = new Uint8Array(fixtures.get(String(input))!.slice(0))
        corrupt[100] = corrupt[100]! ^ 1
        return new Response(corrupt.buffer, { status: 200 })
      }),
    )
    await expect(loadLoungeAssets(new AbortController().signal)).rejects.toThrow('校验失败')
    for (const item of bitmaps) expect(item.close).toHaveBeenCalledOnce()
    expect(bitmaps.every((item) => item.bitmap.width !== 1774)).toBe(true)
  })

  it('closes a decoded dimension mismatch without publishing its texture', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => bitmap(1, 1)),
    )
    const dispose = vi.spyOn(Texture.prototype, 'dispose')
    await expect(loadLoungeAssets(new AbortController().signal)).rejects.toThrow('尺寸不符')
    for (const item of bitmaps) expect(item.close).toHaveBeenCalledOnce()
    expect(dispose).not.toHaveBeenCalled()
  })
})

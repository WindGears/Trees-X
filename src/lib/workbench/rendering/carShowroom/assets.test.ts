import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadShowroomAssets } from './assets'
import { showroomAssetRecords } from './assetRecords'
import { readFile } from 'node:fs/promises'
import { RepeatWrapping } from 'three'
afterEach(() => vi.unstubAllGlobals())
describe('showroom generated texture ownership', () => {
  it('loads only floor sources and releases every decoded bitmap once', async () => {
    const close = vi.fn()
    let decoded = 0
    vi.stubGlobal('createImageBitmap', async () => {
      const record = showroomAssetRecords[decoded++]!
      return { width: record.width, height: record.height, close }
    })
    const fetch = vi.fn(async (url: string) => new Response(await readFile('public' + url)))
    vi.stubGlobal('fetch', fetch)
    const pack = await loadShowroomAssets(new AbortController().signal)
    expect(pack.floor.map.colorSpace).toBe('srgb')
    expect(pack.floor.normalMap.colorSpace).toBe('')
    expect(pack.floor.normalMap.wrapS).toBe(RepeatWrapping)
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(fetch.mock.calls.every(([url]) => !url.includes('wall'))).toBe(true)
    pack.dispose()
    pack.dispose()
    expect(close).toHaveBeenCalledTimes(3)
  })
  it('rejects corrupt data before decoding', async () => {
    const decode = vi.fn()
    vi.stubGlobal('createImageBitmap', decode)
    vi.stubGlobal('fetch', async () => new Response(new Uint8Array(8)))
    await expect(loadShowroomAssets(new AbortController().signal)).rejects.toThrow('校验失败')
    expect(decode).not.toHaveBeenCalled()
  })
  it('closes a late decode when cancelled', async () => {
    const abort = new AbortController(),
      close = vi.fn()
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response(
          await readFile('public/studio/cold-studio/concept-v2/' + showroomAssetRecords[0].file),
        ),
    )
    vi.stubGlobal('createImageBitmap', async () => {
      abort.abort()
      return { width: 2048, height: 2048, close }
    })
    await expect(loadShowroomAssets(abort.signal)).rejects.toThrow()
    expect(close).toHaveBeenCalledOnce()
  })
})

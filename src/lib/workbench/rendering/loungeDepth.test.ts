import { readFile } from 'node:fs/promises'
import { afterEach, expect, it, vi } from 'vitest'
import { loadLoungeDepth, loungeDepthRecord } from './loungeDepth'

afterEach(() => vi.unstubAllGlobals())

it('decodes the actual pinned DA² payload as finite positive little-endian radial distances', async () => {
  const bytes = await readFile('public/studio/amber-lounge/spatial-v1/radial-distance.f32')
  const fetch = vi.fn().mockResolvedValue(new Response(bytes))
  vi.stubGlobal('fetch', fetch)
  const loaded = await loadLoungeDepth(new AbortController().signal)
  expect(loaded.width).toBe(512)
  expect(loaded.height).toBe(256)
  expect(loaded.distance.length).toBe(131072)
  expect(loaded.distance[0]).toBe(
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getFloat32(0, true),
  )
  expect(loaded.distance.every((value) => Number.isFinite(value) && value > 0)).toBe(true)
  expect(fetch).toHaveBeenCalledWith(
    loungeDepthRecord.url,
    expect.objectContaining({ mode: 'same-origin', redirect: 'error' }),
  )
})

it('rejects cancellation before requesting and rejects failed or changed depth instead of inventing data', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response('unavailable', { status: 503 }))
  vi.stubGlobal('fetch', fetch)
  await expect(loadLoungeDepth(AbortSignal.abort())).rejects.toThrow()
  expect(fetch).not.toHaveBeenCalled()
  await expect(loadLoungeDepth(new AbortController().signal)).rejects.toThrow('503')
  fetch.mockResolvedValue(new Response(new Uint8Array(loungeDepthRecord.bytes)))
  await expect(loadLoungeDepth(new AbortController().signal)).rejects.toThrow('校验')
})

import { readFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import { Texture } from 'three'
import {
  decodeHdrTexture,
  EnvironmentSlot,
  fetchHdrBuffer,
  HDR_BUDGET_BYTES,
  LatestEnvironmentRequest,
} from './environment'

const hdr = await readFile(
  new URL('../../../public/textures/studio_small_05_1k.hdr', import.meta.url),
)
const hdrBuffer = hdr.buffer.slice(hdr.byteOffset, hdr.byteOffset + hdr.byteLength)

describe('cinematic environment resources', () => {
  it('accepts and decodes the self-hosted HDR within budget', async () => {
    const response = new Response(hdrBuffer, {
      status: 200,
      headers: { 'content-length': String(hdr.byteLength) },
    })
    const fetcher = (() => Promise.resolve(response)) as typeof fetch
    const buffer = await fetchHdrBuffer(
      '/textures/studio_small_05_1k.hdr',
      new AbortController().signal,
      fetcher,
    )
    const texture = decodeHdrTexture(buffer)
    expect(buffer.byteLength).toBeLessThanOrEqual(HDR_BUDGET_BYTES)
    expect(texture.image.width).toBe(1024)
    expect(texture.image.height).toBe(512)
    texture.dispose()
  })

  it('surfaces HTTP failure and refuses an oversized response', async () => {
    const failed = (() => Promise.resolve(new Response('', { status: 503 }))) as typeof fetch
    await expect(
      fetchHdrBuffer('/missing.hdr', new AbortController().signal, failed),
    ).rejects.toThrow('503')
    const oversized = (() =>
      Promise.resolve(
        new Response('', {
          status: 200,
          headers: { 'content-length': String(HDR_BUDGET_BYTES + 1) },
        }),
      )) as typeof fetch
    await expect(
      fetchHdrBuffer('/large.hdr', new AbortController().signal, oversized),
    ).rejects.toThrow('2 MB')
  })

  it('honors cancellation before and after a response resolves', async () => {
    const before = new AbortController()
    before.abort()
    await expect(fetchHdrBuffer('/cancel.hdr', before.signal)).rejects.toMatchObject({
      name: 'AbortError',
    })
    const after = new AbortController()
    const response = {
      ok: true,
      status: 200,
      headers: new Headers(),
      arrayBuffer: async () => {
        after.abort()
        return hdrBuffer
      },
    } as Response
    const fetcher = (() => Promise.resolve(response)) as typeof fetch
    await expect(fetchHdrBuffer('/late.hdr', after.signal, fetcher)).rejects.toMatchObject({
      name: 'AbortError',
    })
  })

  it('rejects late results and disposes replaced environments exactly once', () => {
    const requests = new LatestEnvironmentRequest()
    const first = requests.begin()
    const second = requests.begin()
    expect(requests.isCurrent(first)).toBe(false)
    expect(requests.isCurrent(second)).toBe(true)
    requests.cancel()
    expect(requests.isCurrent(second)).toBe(false)

    const slot = new EnvironmentSlot()
    const firstDispose = vi.fn()
    const secondDispose = vi.fn()
    const firstEnvironment = { texture: new Texture(), dispose: firstDispose }
    const secondEnvironment = { texture: new Texture(), dispose: secondDispose }
    slot.replace(firstEnvironment)
    slot.replace(secondEnvironment)
    slot.replace(secondEnvironment)
    expect(firstDispose).toHaveBeenCalledOnce()
    expect(secondDispose).not.toHaveBeenCalled()
    expect(slot.value()).toBe(secondEnvironment)
    slot.dispose()
    slot.dispose()
    expect(secondDispose).toHaveBeenCalledOnce()
  })
})

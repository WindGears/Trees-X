import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DataTexture, EquirectangularReflectionMapping } from 'three'
import type { WebGPURenderer } from 'three/webgpu'
import { createRealtimeReferenceEnvironment } from './referenceEnvironment'
import { realtimeReference } from './reference'

const ownership = vi.hoisted(() => ({ own: vi.fn() }))
vi.mock('../environmentPMREM', () => ({ ownEnvironmentPmrem: ownership.own }))
const original = readFileSync('public/textures/studio_small_05_1k.hdr')
const renderer = {} as WebGPURenderer
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  ownership.own.mockReset()
})

describe('frozen typewriter reference environment', () => {
  it('loads and verifies the real local HDR before transferring unique texture ownership', async () => {
    const request = vi.fn().mockResolvedValue(new Response(original))
    vi.stubGlobal('fetch', request)
    let texture: DataTexture | undefined
    ownership.own.mockImplementation((_renderer, value: DataTexture) => {
      texture = value
      return { texture: value, dispose: () => value.dispose() }
    })
    const signal = new AbortController().signal
    const result = await createRealtimeReferenceEnvironment(renderer, signal)
    expect(request).toHaveBeenCalledWith(realtimeReference.environment.url, { signal })
    expect(texture).toBeInstanceOf(DataTexture)
    expect(texture?.image).toMatchObject({ width: 1024, height: 512 })
    expect(texture?.mapping).toBe(EquirectangularReflectionMapping)
    expect(result.texture).toBe(texture)
    expect(texture?.userData.reference).toEqual(realtimeReference.environment)
    expect(ownership.own).toHaveBeenCalledOnce()
    result.dispose()
  })

  it.each(['http', 'wrong-size', 'wrong-hash'])(
    'rejects %s rather than silently changing the frozen comparison input',
    async (failure) => {
      const bytes = Buffer.from(original)
      if (failure === 'wrong-hash') bytes[100] = bytes[100]! ^ 1
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue(
            failure === 'http'
              ? new Response(null, { status: 503 })
              : new Response(failure === 'wrong-size' ? bytes.subarray(0, 10) : bytes),
          ),
      )
      await expect(createRealtimeReferenceEnvironment(renderer)).rejects.toThrow()
      expect(ownership.own).not.toHaveBeenCalled()
    },
  )

  it('rejects a late read after cancellation before allocating a texture', async () => {
    const abort = new AbortController()
    let resolve!: (value: Response) => void
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>((accept) => (resolve = accept))),
    )
    const pending = createRealtimeReferenceEnvironment(renderer, abort.signal)
    abort.abort()
    resolve(new Response(original))
    await expect(pending).rejects.toThrow()
    expect(ownership.own).not.toHaveBeenCalled()
  })

  it('releases the decoded HDR if acquiring its PMREM owner fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(original)))
    let released = 0
    ownership.own.mockImplementation((_renderer, texture: DataTexture) => {
      texture.addEventListener('dispose', () => released++)
      throw new Error('cache unavailable')
    })
    await expect(createRealtimeReferenceEnvironment(renderer)).rejects.toThrow('cache unavailable')
    expect(released).toBe(1)
  })
})

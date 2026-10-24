import { readFile } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FloatType, LinearSRGBColorSpace, Object3D } from 'three'
import type { WebGPURenderer } from 'three/webgpu'
import { loadBakedStudioProbe } from './bakedProbe'
import { coldStudioConfig } from './config'
import { usesBakedFloorReflection } from './floorReflection'

afterEach(() => vi.unstubAllGlobals())
const renderer = {} as WebGPURenderer
const signal = () => new AbortController().signal
describe('persisted static room HDR', () => {
  it('loads the real lossless asset with matching linear HDR orientation and one owner', async () => {
    vi.stubGlobal('fetch', async (url: string) => new Response(await readFile('public' + url)))
    const probe = await loadBakedStudioProbe(renderer, coldStudioConfig, 'indirect', signal())
    expect(probe.texture.type).toBe(FloatType)
    expect(probe.texture.colorSpace).toBe(LinearSRGBColorSpace)
    expect(probe.texture.flipY).toBe(false)
    expect(probe.texture.image.width).toBe(1024)
    expect(probe.snapshot.cubeColorBytes).toBe(0)
    expect(probe.snapshot.conversionColorBytes).toBe(0)
    const dispose = vi.fn()
    probe.texture.addEventListener('dispose', dispose)
    probe.dispose()
    probe.dispose()
    expect(dispose).toHaveBeenCalledOnce()
  })
  it('rejects changed lighting before downloading stale reflections', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    await expect(
      loadBakedStudioProbe(renderer, { ...coldStudioConfig, exposure: 2 }, 'indirect', signal()),
    ).rejects.toThrow('配置已改变')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('rejects missing and corrupt data rather than inventing a successful bake', async () => {
    vi.stubGlobal('fetch', async () => new Response(null, { status: 404 }))
    await expect(
      loadBakedStudioProbe(renderer, coldStudioConfig, 'indirect', signal()),
    ).rejects.toThrow('读取失败')
    vi.stubGlobal('fetch', async () => new Response(new Uint8Array(32)))
    await expect(
      loadBakedStudioProbe(renderer, coldStudioConfig, 'indirect', signal()),
    ).rejects.toThrow('摘要不符')
  })
  it('rejects a cancelled late response before decompressing or owning a texture', async () => {
    const abort = new AbortController()
    vi.stubGlobal('fetch', async (url: string) => {
      const data = await readFile('public' + url)
      abort.abort()
      return new Response(data)
    })
    await expect(
      loadBakedStudioProbe(renderer, coldStudioConfig, 'indirect', abort.signal),
    ).rejects.toThrow()
  })
  it('only excludes opted-in floor origins; car, other products and old floors retain SSR', () => {
    const object = new Object3D()
    object.userData = { carShowroom: true, showroomId: 'floor' }
    expect(usesBakedFloorReflection(object)).toBe(false)
    object.userData.bakedFloorReflection = true
    expect(usesBakedFloorReflection(object)).toBe(true)
    object.userData.showroomId = 'car'
    expect(usesBakedFloorReflection(object)).toBe(false)
    expect(usesBakedFloorReflection(undefined)).toBe(false)
  })
})

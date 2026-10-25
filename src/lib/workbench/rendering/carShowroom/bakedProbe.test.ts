import { readFile } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FloatType, HalfFloatType, DataUtils, LinearSRGBColorSpace, Object3D } from 'three'
import type { WebGPURenderer } from 'three/webgpu'
import { loadBakedStudioProbe } from './bakedProbe'
import { coldStudioConfig } from './config'
import { usesBakedFloorReflection } from './floorReflection'

afterEach(() => vi.unstubAllGlobals())
const renderer = {} as WebGPURenderer
const signal = () => new AbortController().signal
describe('persisted static room HDR', () => {
  it('loads the Cycles HDR in half precision with all four emitter directions intact', async () => {
    vi.stubGlobal('fetch', async (url: string) => new Response(await readFile('public' + url)))
    const probe = await loadBakedStudioProbe(
      renderer,
      coldStudioConfig,
      'specular',
      signal(),
      'cycles',
    )
    expect(probe.texture.type).toBe(HalfFloatType)
    const image = probe.texture.image
    expect(image.data).toBeInstanceOf(Uint16Array)
    if (!(image.data instanceof Uint16Array)) throw new Error('Expected half-float HDR data')
    for (const light of Object.values(coldStudioConfig.lights)) {
      const delta = light.position.map((v, i) => v - coldStudioConfig.capture.position[i]!)
      const x = Math.floor((Math.atan2(delta[2]!, delta[0]!) / (2 * Math.PI) + 0.5) * image.width)
      const y =
        image.height -
        1 -
        Math.floor((0.5 - Math.asin(delta[1]! / Math.hypot(...delta)) / Math.PI) * image.height)
      for (let channel = 0; channel < 3; channel++)
        expect(
          Math.abs(
            DataUtils.fromHalfFloat(image.data[(y * image.width + x) * 4 + channel]!) -
              light.radiance,
          ),
        ).toBeLessThan(0.05)
    }
    probe.dispose()
  })
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

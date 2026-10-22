import { describe, expect, it, vi } from 'vitest'
import {
  DepthTexture,
  HalfFloatType,
  PerspectiveCamera,
  RenderTarget,
  Source,
  Texture,
} from 'three'
import type { WebGPURenderer } from 'three/webgpu'
import { texture } from 'three/tsl'
import { createCarShadowHistory } from './history'

function fixture() {
  const camera = new PerspectiveCamera(40, 1.44, 0.1, 100),
    signal = new Texture(),
    depth = new DepthTexture(1440, 1000),
    normal = new Texture(),
    velocity = new Texture()
  normal.source = new Source({ width: 1440, height: 1000, depth: 1 })
  const initRenderTarget = vi.fn<(target: RenderTarget) => void>(),
    initTexture = vi.fn<(source: Texture) => void>(),
    copyTextureToTexture = vi.fn(),
    renderer = { initRenderTarget, initTexture, copyTextureToTexture } as unknown as WebGPURenderer
  const owner = createCarShadowHistory(
    renderer,
    camera,
    texture(signal),
    texture(depth),
    texture(normal),
    texture(velocity),
  )
  return {
    owner,
    signal,
    depth,
    normal,
    velocity,
    initRenderTarget,
    initTexture,
    copyTextureToTexture,
  }
}

describe('car key-light visibility complete-frame history', () => {
  it('owns isolated HDR/depth/normal allocations without resizing borrowed textures', () => {
    const f = fixture()
    f.owner.prepare(1440, 1000)
    const previous = f.initRenderTarget.mock.calls[0]![0],
      normal = f.initTexture.mock.calls[0]![0]
    expect(previous.texture.type).toBe(HalfFloatType)
    expect(f.owner.node.value.type).toBe(HalfFloatType)
    expect(previous.depthTexture!.source).not.toBe(f.depth.source)
    expect(normal.source).not.toBe(f.normal.source)
    expect(normal.renderTarget).toBeNull()
    f.owner.prepare(1280, 720)
    expect(f.depth.image).toMatchObject({ width: 1440, height: 1000 })
    expect(f.normal.image).toMatchObject({ width: 1440, height: 1000 })
    expect(previous.depthTexture!.image).toMatchObject({ width: 1280, height: 720 })
    expect(normal.image).toMatchObject({ width: 1280, height: 720 })
    expect(f.owner.snapshot()).toMatchObject({ maxHistory: 8, enabled: 0, committedFrames: 0 })
    expect(f.copyTextureToTexture).not.toHaveBeenCalled()
    f.owner.dispose()
  })

  it('commits signal and guides only after a prepared successful frame', () => {
    const f = fixture()
    expect(() => f.owner.commitFrame()).toThrow('no prepared frame')
    f.owner.prepare(1440, 1000)
    f.owner.cancelFrame()
    expect(() => f.owner.commitFrame()).toThrow('no prepared frame')
    expect(f.copyTextureToTexture).not.toHaveBeenCalled()
    f.owner.prepare(1440, 1000)
    f.owner.commitFrame()
    const target = f.initRenderTarget.mock.calls[0]![0],
      normal = f.initTexture.mock.calls[0]![0]
    expect(f.copyTextureToTexture.mock.calls).toEqual([
      [f.owner.node.value, target.texture],
      [f.depth, target.depthTexture],
      [f.normal, normal],
    ])
    expect(f.owner.snapshot()).toMatchObject({ valid: true, committedFrames: 1, prepared: false })
    f.owner.prepare(1440, 1000)
    expect(f.owner.snapshot().enabled).toBe(1)
    f.owner.dispose()
  })

  it('resets and resizes history without retaining an old light or pose signal', () => {
    const f = fixture()
    f.owner.prepare(1440, 1000)
    f.owner.commitFrame()
    f.owner.prepare(1440, 1000)
    f.owner.resetHistory()
    expect(f.owner.snapshot()).toMatchObject({ valid: false, enabled: 0, prepared: false })
    f.owner.prepare(1440, 1000)
    expect(f.initRenderTarget).toHaveBeenCalledTimes(1)
    expect(f.owner.snapshot().enabled).toBe(0)
    f.owner.commitFrame()
    f.owner.prepare(1280, 720)
    expect(f.owner.snapshot()).toMatchObject({ valid: false, enabled: 0 })
    f.owner.dispose()
  })

  it('a partial guide copy cannot validate the history or advance its successful-frame count', () => {
    const f = fixture()
    f.owner.prepare(1440, 1000)
    f.copyTextureToTexture
      .mockImplementationOnce(() => {})
      .mockImplementationOnce(() => {
        throw new Error('copy failure')
      })
    expect(() => f.owner.commitFrame()).toThrow('copy failure')
    expect(f.owner.snapshot()).toMatchObject({
      valid: false,
      enabled: 0,
      prepared: false,
      committedFrames: 0,
    })
    f.owner.prepare(1440, 1000)
    expect(f.owner.snapshot().enabled).toBe(0)
    f.owner.commitFrame()
    expect(f.owner.snapshot().committedFrames).toBe(1)
    f.owner.dispose()
  })

  it('retries allocation failures and rejects invalid dimensions before allocation', () => {
    const f = fixture()
    for (const [width, height] of [
      [0, 1000],
      [1440, -1],
      [NaN, 1000],
      [1.2, 1000],
    ])
      expect(() => f.owner.prepare(width!, height!)).toThrow('pixel dimensions')
    expect(f.initRenderTarget).not.toHaveBeenCalled()
    f.initTexture.mockImplementationOnce(() => {
      throw new Error('allocation failure')
    })
    expect(() => f.owner.prepare(1440, 1000)).toThrow('allocation failure')
    expect(() => f.owner.commitFrame()).toThrow('no prepared frame')
    f.owner.prepare(1440, 1000)
    expect(f.initRenderTarget).toHaveBeenCalledTimes(2)
    f.owner.commitFrame()
    f.owner.dispose()
  })

  it('disposes each owned allocation once and borrows all surface and signal inputs', () => {
    const f = fixture(),
      borrowed = [f.signal, f.depth, f.normal, f.velocity].map((value) =>
        vi.spyOn(value, 'dispose'),
      )
    f.owner.prepare(1440, 1000)
    const targetDispose = vi.spyOn(f.initRenderTarget.mock.calls[0]![0], 'dispose'),
      normalDispose = vi.spyOn(f.initTexture.mock.calls[0]![0], 'dispose'),
      outputDispose = vi.spyOn(f.owner.node.renderTarget!, 'dispose')
    f.owner.dispose()
    f.owner.dispose()
    expect(targetDispose).toHaveBeenCalledTimes(1)
    expect(normalDispose).toHaveBeenCalledTimes(1)
    expect(outputDispose).toHaveBeenCalledTimes(1)
    for (const dispose of borrowed) expect(dispose).not.toHaveBeenCalled()
    expect(() => f.owner.prepare(1440, 1000)).toThrow('disposed')
    expect(() => f.owner.commitFrame()).toThrow('no prepared frame')
  })

  it('rejects non-native depth without disposing any borrowed input', () => {
    const input = new Texture(),
      dispose = vi.spyOn(input, 'dispose')
    expect(() =>
      createCarShadowHistory(
        {} as WebGPURenderer,
        new PerspectiveCamera(),
        texture(input),
        texture(input),
        texture(input),
        texture(input),
      ),
    ).toThrow('native depth')
    expect(dispose).not.toHaveBeenCalled()
  })
})

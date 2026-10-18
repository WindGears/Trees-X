import { describe, expect, it, vi } from 'vitest'
import {
  DepthTexture,
  HalfFloatType,
  PerspectiveCamera,
  RenderTarget,
  Texture,
  Source,
} from 'three'
import { texture } from 'three/tsl'
import type { WebGPURenderer } from 'three/webgpu'
import { createSignedReflectionHistory } from './signedHistory'

function fixture() {
  const camera = new PerspectiveCamera(40, 1.44, 0.1, 100)
  camera.position.set(0, 0, 8)
  camera.updateMatrixWorld()
  const depth = new DepthTexture(1440, 1000),
    normal = new Texture(),
    signal = new Texture(),
    velocity = new Texture()
  normal.source = new Source({ width: 1440, height: 1000, depth: 1 })
  normal.isRenderTargetTexture = true
  const initRenderTarget = vi.fn<(target: RenderTarget) => void>(),
    initTexture = vi.fn(),
    copyTextureToTexture = vi.fn()
  const renderer = {
    initRenderTarget,
    initTexture,
    copyTextureToTexture,
  } as unknown as WebGPURenderer
  const owner = createSignedReflectionHistory(
    renderer,
    camera,
    texture(signal),
    texture(depth),
    texture(normal),
    texture(velocity),
  )
  return {
    owner,
    camera,
    depth,
    normal,
    signal,
    velocity,
    initRenderTarget,
    initTexture,
    copyTextureToTexture,
  }
}

describe('complete-frame signed reflection history ownership', () => {
  it('invalidates a pose cut without reallocating, copying or disposing the retained targets', () => {
    const f = fixture()
    try {
      f.owner.prepare(1440, 1000)
      f.owner.commitFrame()
      f.owner.prepare(1440, 1000)
      expect(f.owner.snapshot()).toMatchObject({ valid: true, enabled: 1, prepared: true })
      const output = f.owner.node.value,
        release = vi.spyOn(output, 'dispose')
      f.owner.resetHistory()
      expect(f.owner.snapshot()).toMatchObject({ valid: false, enabled: 0, prepared: false })
      expect(() => f.owner.commitFrame()).toThrow('no prepared frame')
      expect(f.copyTextureToTexture).toHaveBeenCalledTimes(3)
      f.owner.prepare(1440, 1000)
      expect(f.owner.snapshot().enabled).toBe(0)
      expect(f.initRenderTarget).toHaveBeenCalledTimes(1)
      expect(f.initTexture).toHaveBeenCalledTimes(1)
      expect(f.owner.node.value).toBe(output)
      expect(release).not.toHaveBeenCalled()
      f.owner.commitFrame()
      f.owner.prepare(1440, 1000)
      expect(f.owner.snapshot().enabled).toBe(1)
      f.owner.cancelFrame()
    } finally {
      f.owner.dispose()
    }
    expect(() => f.owner.resetHistory()).not.toThrow()
  })

  it('rejects unprepared and cancelled commits without copying GPU resources', () => {
    const f = fixture()
    expect(() => f.owner.commitFrame()).toThrow('no prepared frame')
    f.owner.prepare(1440, 1000)
    f.owner.cancelFrame()
    expect(() => f.owner.commitFrame()).toThrow('no prepared frame')
    expect(f.copyTextureToTexture).not.toHaveBeenCalled()
    f.owner.prepare(1440, 1000)
    f.owner.commitFrame()
    expect(f.copyTextureToTexture).toHaveBeenCalledTimes(3)
    expect(() => f.owner.commitFrame()).toThrow('no prepared frame')
    f.owner.dispose()
  })
  it('allocates isolated HDR/depth/normal targets and does not copy before a successful commit', () => {
    const f = fixture()
    f.owner.prepare(1440, 1000)
    const previous = f.initRenderTarget.mock.calls[0]![0],
      previousNormal = f.initTexture.mock.calls[0]![0] as Texture
    expect(previous.texture.type).toBe(HalfFloatType)
    expect(previous.depthTexture!.type).toBe(f.depth.type)
    expect(previous.depthTexture).not.toBe(f.depth)
    expect(previous.depthTexture!.source).not.toBe(f.depth.source)
    expect(previousNormal.source).not.toBe(f.normal.source)
    expect(previousNormal.renderTarget).toBeNull()
    expect(f.owner.node.value.type).toBe(HalfFloatType)
    f.owner.prepare(1440, 1000) // cancelled frame, superseded by the next prepare
    expect(f.copyTextureToTexture).not.toHaveBeenCalled()
    expect(f.initRenderTarget).toHaveBeenCalledTimes(1)
    f.owner.commitFrame()
    expect(f.copyTextureToTexture.mock.calls).toEqual([
      [f.owner.node.value, previous.texture],
      [f.depth, previous.depthTexture],
      [f.normal, previousNormal],
    ])
    expect(() => f.owner.commitFrame()).toThrow('no prepared frame')
    f.owner.dispose()
  })

  it('rejects invalid sizes before allocation and resize never mutates borrowed input dimensions', () => {
    const f = fixture()
    for (const [w, h] of [
      [0, 1000],
      [1440, -1],
      [1.5, 1000],
      [NaN, 1000],
    ])
      expect(() => f.owner.prepare(w!, h!)).toThrow('pixel dimensions')
    expect(f.initRenderTarget).not.toHaveBeenCalled()
    f.owner.prepare(1440, 1000)
    f.owner.commitFrame()
    f.owner.prepare(1280, 720)
    expect(f.copyTextureToTexture).toHaveBeenCalledTimes(3)
    expect(f.initRenderTarget).toHaveBeenCalledTimes(2)
    expect(f.depth.image).toMatchObject({ width: 1440, height: 1000 })
    expect(f.normal.image).toMatchObject({ width: 1440, height: 1000 })
    const previous = f.initRenderTarget.mock.calls[1]![0]
    expect(previous.depthTexture!.image).toMatchObject({ width: 1280, height: 720 })
    f.owner.commitFrame()
    expect(f.copyTextureToTexture).toHaveBeenCalledTimes(6)
    f.owner.dispose()
  })

  it('does not finish a partially copied frame and can retry with a new prepare', () => {
    const f = fixture()
    f.owner.prepare(1440, 1000)
    f.copyTextureToTexture
      .mockImplementationOnce(() => {})
      .mockImplementationOnce(() => {
        throw new Error('copy failed')
      })
    expect(() => f.owner.commitFrame()).toThrow('copy failed')
    expect(f.copyTextureToTexture).toHaveBeenCalledTimes(2)
    expect(() => f.owner.commitFrame()).toThrow('no prepared frame')
    f.copyTextureToTexture.mockReset()
    f.owner.prepare(1440, 1000)
    f.owner.commitFrame()
    expect(f.copyTextureToTexture).toHaveBeenCalledTimes(3)
    f.owner.dispose()
  })

  it('retries a failed allocation instead of arming a partially initialized frame', () => {
    const f = fixture()
    f.initTexture.mockImplementationOnce(() => {
      throw new Error('allocation failed')
    })
    expect(() => f.owner.prepare(1440, 1000)).toThrow('allocation failed')
    expect(() => f.owner.commitFrame()).toThrow('no prepared frame')
    expect(f.copyTextureToTexture).not.toHaveBeenCalled()
    f.owner.prepare(1440, 1000)
    expect(f.initRenderTarget).toHaveBeenCalledTimes(2)
    expect(f.initTexture).toHaveBeenCalledTimes(2)
    f.owner.commitFrame()
    expect(f.copyTextureToTexture).toHaveBeenCalledTimes(3)
    f.owner.dispose()
  })

  it('releases targets and copied normals once, borrowing every source texture', () => {
    const f = fixture(),
      sourceDisposes = [f.depth, f.normal, f.signal, f.velocity].map((t) => vi.spyOn(t, 'dispose'))
    f.owner.prepare(1440, 1000)
    const previous = f.initRenderTarget.mock.calls[0]![0],
      previousNormal = f.initTexture.mock.calls[0]![0] as Texture
    const previousDispose = vi.spyOn(previous, 'dispose'),
      normalDispose = vi.spyOn(previousNormal, 'dispose'),
      outputDispose = vi.spyOn(f.owner.node.renderTarget!, 'dispose')
    f.owner.dispose()
    f.owner.dispose()
    expect(previousDispose).toHaveBeenCalledTimes(1)
    expect(normalDispose).toHaveBeenCalledTimes(1)
    expect(outputDispose).toHaveBeenCalledTimes(1)
    for (const dispose of sourceDisposes) expect(dispose).not.toHaveBeenCalled()
    expect(f.copyTextureToTexture).not.toHaveBeenCalled()
    expect(() => f.owner.prepare(1440, 1000)).toThrow('disposed')
    expect(() => f.owner.commitFrame()).toThrow('no prepared frame')
  })

  it('requires genuine native depth without taking ownership on rejection', () => {
    const source = new Texture(),
      dispose = vi.spyOn(source, 'dispose')
    expect(() =>
      createSignedReflectionHistory(
        {} as WebGPURenderer,
        new PerspectiveCamera(),
        texture(source),
        texture(source),
        texture(source),
        texture(source),
      ),
    ).toThrow('native depth')
    expect(dispose).not.toHaveBeenCalled()
  })
})

import { describe, expect, it, vi } from 'vitest'
import { DepthTexture, PerspectiveCamera, RectAreaLight, Texture } from 'three'
import type { WebGPURenderer } from 'three/webgpu'
import { bool, texture } from 'three/tsl'
import { createCarShadowVisibility } from './visibility'

function fixture(receiverMask?: Texture) {
  const copyTextureToTexture = vi.fn(),
    renderer = {
      initRenderTarget: vi.fn(),
      initTexture: vi.fn(),
      copyTextureToTexture,
    } as unknown as WebGPURenderer
  const light = new RectAreaLight(0xffffff, 7, 6, 3)
  light.position.set(-1, 4, -3)
  light.updateMatrixWorld()
  const owner = createCarShadowVisibility(
    renderer,
    new PerspectiveCamera(),
    {
      depth: texture(new DepthTexture(1440, 1000)),
      normal: texture(new Texture()),
      velocity: texture(new Texture()),
      receiverMask: receiverMask ? texture(receiverMask) : undefined,
    },
    light,
    { occluded: () => bool(false) },
  )
  return { owner, copyTextureToTexture }
}

describe('car rectangular softbox visibility sequence', () => {
  it('accepts the optional opaque-car receiver mask as a borrowed texture', () => {
    const receiverMask = new Texture(),
      dispose = vi.spyOn(receiverMask, 'dispose')
    const f = fixture(receiverMask)
    f.owner.prepare(1440, 1000)
    f.owner.commitFrame()
    f.owner.dispose()
    expect(dispose).not.toHaveBeenCalled()
  })
  it('advances its two-ray sequence only on a successful complete-frame commit', () => {
    const f = fixture()
    f.owner.prepare(1440, 1000)
    expect(f.owner.snapshot()).toMatchObject({ frames: 0, sequence: 0, samples: 2, maxHistory: 8 })
    f.owner.cancelFrame()
    expect(() => f.owner.commitFrame()).toThrow('no prepared frame')
    f.owner.prepare(1440, 1000)
    expect(f.owner.snapshot().sequence).toBe(0)
    f.owner.commitFrame()
    f.owner.prepare(1440, 1000)
    expect(f.owner.snapshot()).toMatchObject({ frames: 1, sequence: 1 })
    f.owner.resetHistory()
    expect(f.owner.snapshot()).toMatchObject({ frames: 1, valid: false, prepared: false })
    f.owner.prepare(1440, 1000)
    expect(f.owner.snapshot().sequence).toBe(1)
    f.owner.dispose()
  })

  it('retains the same stochastic sample after a failed guide commit', () => {
    const f = fixture()
    f.owner.prepare(1440, 1000)
    f.copyTextureToTexture.mockImplementationOnce(() => {
      throw new Error('copy failure')
    })
    expect(() => f.owner.commitFrame()).toThrow('copy failure')
    expect(f.owner.snapshot()).toMatchObject({ frames: 0, valid: false })
    f.owner.prepare(1440, 1000)
    expect(f.owner.snapshot().sequence).toBe(0)
    f.owner.commitFrame()
    expect(f.owner.snapshot().frames).toBe(1)
    f.owner.dispose()
    f.owner.dispose()
    expect(() => f.owner.prepare(1, 1)).toThrow('disposed')
  })
})

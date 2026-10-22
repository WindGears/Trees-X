import { describe, expect, it, vi } from 'vitest'
import { Color, DataTexture, Scene, Vector4, WebGPUCoordinateSystem } from 'three'
import type { WebGPURenderer } from 'three/webgpu'
import { coldStudioConfig } from './config'
import { createColdStudioProbe } from './probe'

// A single readback allocation is shared across tests; no GPU work occurs here.
const pixels = new Float32Array(4096 * 2048 * 4)

function fixture(output = pixels) {
  const retained = { retained: true },
    retainedContext = { context: true }
  let accept!: (value: Float32Array) => void, reject!: (error: Error) => void
  const readback = new Promise<Float32Array>((resolve, fail) => {
    accept = resolve
    reject = fail
  })
  const renderer = {
    coordinateSystem: WebGPUCoordinateSystem,
    reversedDepthBuffer: false,
    toneMapping: 4,
    toneMappingExposure: 1.25,
    outputColorSpace: 'srgb',
    autoClear: false,
    contextNode: retainedContext,
    opaque: false,
    transparent: false,
    depth: false,
    stencil: true,
    xr: { enabled: true },
    shadowMap: { enabled: true },
    getPixelRatio: () => 1.5,
    setPixelRatio: vi.fn(),
    getRenderTarget: () => retained,
    getActiveCubeFace: () => 2,
    getActiveMipmapLevel: () => 1,
    getRenderObjectFunction: () => null,
    setRenderObjectFunction: vi.fn(),
    getMRT: () => null,
    setMRT: vi.fn(),
    getClearAlpha: () => 0.6,
    getClearColor: (value: Color) => value.set('#123456'),
    getViewport: (value: Vector4) => value.set(3, 5, 1440, 1000),
    getScissor: (value: Vector4) => value.set(7, 9, 900, 700),
    getScissorTest: () => true,
    setViewport: vi.fn(),
    setScissor: vi.fn(),
    setScissorTest: vi.fn(),
    setClearColor: vi.fn(),
    setRenderTarget: vi.fn(),
    render: vi.fn(),
    readRenderTargetPixelsAsync: vi.fn(() => readback),
  }
  const targets = () =>
    [...new Set(renderer.setRenderTarget.mock.calls.map((call) => call[0]))]
      .filter((target) => target && target !== retained)
      .map((target) => ({ target, dispose: vi.spyOn(target, 'dispose') }))
  return {
    renderer,
    gpu: renderer as unknown as WebGPURenderer,
    targets,
    retained,
    retainedContext,
    accept: () => accept(output),
    reject,
  }
}

describe('same-room linear HDR probe ownership', () => {
  it('captures six actual 1K faces, restores before readback and releases once', async () => {
    const f = fixture(),
      scene = new Scene()
    const pending = createColdStudioProbe(f.gpu, scene, coldStudioConfig)
    expect(f.renderer.render).toHaveBeenCalledTimes(7)
    expect(f.renderer.toneMapping).toBe(4)
    expect(f.renderer.contextNode).toBe(f.retainedContext)
    expect(f.renderer.xr.enabled).toBe(true)
    expect(f.renderer.opaque).toBe(false)
    expect(f.renderer.depth).toBe(false)
    expect(f.renderer.stencil).toBe(true)
    expect(f.renderer.setRenderTarget).toHaveBeenLastCalledWith(f.retained, 2, 1)
    const targets = f.targets()
    expect(targets.map(({ target }) => [target.width, target.height])).toEqual([
      [1024, 1024],
      [4096, 2048],
    ])
    f.renderer.toneMapping = 9
    f.accept()
    const probe = await pending
    expect(f.renderer.toneMapping).toBe(9)
    expect(probe.texture).toBeInstanceOf(DataTexture)
    expect(probe.texture.image.data).toBe(pixels)
    expect(probe.texture.flipY).toBe(false)
    expect(probe.snapshot).toMatchObject({
      faces: 6,
      faceResolution: 1024,
      width: 4096,
      height: 2048,
      linearHDR: true,
      cpuBytes: 134217728,
    })
    for (const { dispose } of targets) expect(dispose).toHaveBeenCalledTimes(1)
    const dispose = vi.spyOn(probe.texture, 'dispose')
    probe.dispose()
    probe.dispose()
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(scene.children).toHaveLength(0)
  })

  it('cancellation and late readback dispose transient targets without restoring stale host state', async () => {
    const f = fixture(),
      abort = new AbortController()
    const pending = createColdStudioProbe(f.gpu, new Scene(), coldStudioConfig, abort.signal)
    const targets = f.targets(),
      restores = f.renderer.setRenderTarget.mock.calls.length
    abort.abort()
    f.accept()
    await expect(pending).rejects.toThrow()
    expect(f.renderer.setRenderTarget.mock.calls).toHaveLength(restores)
    for (const { dispose } of targets) expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('keeps capture failures explicit and restores all renderer flags', async () => {
    const f = fixture()
    const pending = createColdStudioProbe(f.gpu, new Scene(), coldStudioConfig)
    const targets = f.targets()
    f.reject(new Error('readback failed'))
    await expect(pending).rejects.toThrow('readback failed')
    expect(f.renderer.shadowMap.enabled).toBe(true)
    expect(f.renderer.contextNode).toBe(f.retainedContext)
    for (const { dispose } of targets) expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('does no capture for an already canceled request', async () => {
    const f = fixture(),
      abort = new AbortController()
    abort.abort()
    await expect(
      createColdStudioProbe(f.gpu, new Scene(), coldStudioConfig, abort.signal),
    ).rejects.toThrow()
    expect(f.renderer.render).not.toHaveBeenCalled()
  })

  it('records the separate low-frequency indirect capture at its actual resolution', async () => {
    const indirectPixels = new Float32Array(1024 * 512 * 4),
      f = fixture(indirectPixels)
    const pending = createColdStudioProbe(f.gpu, new Scene(), coldStudioConfig, undefined, {
      role: 'indirect',
    })
    const targets = f.targets()
    expect(targets.map(({ target }) => [target.width, target.height])).toEqual([
      [256, 256],
      [1024, 512],
    ])
    f.accept()
    const probe = await pending
    expect(probe.texture.image.data).toBe(indirectPixels)
    expect(probe.snapshot).toMatchObject({
      role: 'indirect',
      faces: 6,
      faceResolution: 256,
      width: 1024,
      height: 512,
      cpuBytes: 8388608,
    })
    expect(probe.texture.name).toContain('indirect')
    probe.dispose()
    for (const { dispose } of targets) expect(dispose).toHaveBeenCalledTimes(1)
  })
})

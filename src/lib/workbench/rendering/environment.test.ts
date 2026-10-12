import { describe, expect, it, vi } from 'vitest'
import { Color, DataTexture, Vector4, WebGPUCoordinateSystem } from 'three'
import type { WebGPURenderer } from 'three/webgpu'
import { createGpuRoomEnvironment, createGpuStudioEnvironment } from './studioEnvironment'

function gpuCaptureFixture() {
  const retained = { current: true },
    output = new Float32Array(2048 * 1024 * 4)
  let accept!: (result: Float32Array) => void
  let reject!: (reason: Error) => void
  const pending = new Promise<Float32Array>((resolve, fail) => {
    accept = resolve
    reject = fail
  })
  const renderer = {
    coordinateSystem: WebGPUCoordinateSystem,
    reversedDepthBuffer: false,
    toneMapping: 4,
    toneMappingExposure: 1.3,
    outputColorSpace: 'srgb',
    autoClear: false,
    xr: { enabled: true },
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
    getClearColor: (color: Color) => color.set('#123456'),
    getViewport: (value: Vector4) => value.set(3, 5, 1440, 1000),
    getScissor: (value: Vector4) => value.set(7, 9, 900, 700),
    getScissorTest: () => true,
    setViewport: vi.fn(),
    setScissor: vi.fn(),
    setScissorTest: vi.fn(),
    setClearColor: vi.fn(),
    setRenderTarget: vi.fn(),
    render: vi.fn(),
    readRenderTargetPixelsAsync: vi.fn(() => pending),
  }
  const targets = () =>
    [
      ...new Set(
        renderer.setRenderTarget.mock.calls
          .map((call) => call[0])
          .filter((target) => target && target !== retained),
      ),
    ].map((target) => ({ target, dispose: vi.spyOn(target, 'dispose') }))
  return {
    renderer,
    retained,
    gpu: renderer as unknown as WebGPURenderer,
    targets,
    resolve: () => accept(output),
    reject,
  }
}

describe('owned WebGPU environment capture', () => {
  it('restores host state before waiting and gives its HDR and camera sky a unique release owner', async () => {
    const f = gpuCaptureFixture()
    const pending = createGpuStudioEnvironment(f.gpu)
    expect(f.renderer.render).toHaveBeenCalledTimes(7)
    expect(f.renderer.toneMapping).toBe(4)
    expect(f.renderer.xr.enabled).toBe(true)
    expect(f.renderer.setRenderTarget).toHaveBeenLastCalledWith(f.retained, 2, 1)
    const targets = f.targets()
    // Another operation can use the renderer during async readback; a late finally must not restore old state again.
    f.renderer.toneMapping = 9
    f.resolve()
    const environment = await pending
    expect(f.renderer.toneMapping).toBe(9)
    expect(environment.texture).toBeInstanceOf(DataTexture)
    const image = (environment.texture as DataTexture).image
    expect(image.width).toBe(2048)
    expect(image.height).toBe(1024)
    expect(environment.texture.flipY).toBe(false)
    expect(environment.background).toBeDefined()
    for (const { dispose } of targets) expect(dispose).toHaveBeenCalledTimes(1)
    const texture = vi.spyOn(environment.texture, 'dispose'),
      sky = vi.spyOn(environment.background!, 'dispose')
    environment.dispose()
    environment.dispose()
    expect(texture).toHaveBeenCalledTimes(1)
    expect(sky).toHaveBeenCalledTimes(1)
  })

  it('discards canceled capture output and releases both render targets without late host mutation', async () => {
    const f = gpuCaptureFixture(),
      abort = new AbortController()
    const pending = createGpuStudioEnvironment(f.gpu, undefined, abort.signal)
    const targets = f.targets()
    const restores = f.renderer.setRenderTarget.mock.calls.length
    abort.abort()
    f.resolve()
    await expect(pending).rejects.toThrow()
    expect(f.renderer.setRenderTarget.mock.calls.length).toBe(restores)
    for (const { dispose } of targets) expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('keeps failed room capture errors visible while cleaning its targets', async () => {
    const f = gpuCaptureFixture()
    const pending = createGpuRoomEnvironment(f.gpu)
    const targets = f.targets()
    f.reject(new Error('GPU readback failed'))
    await expect(pending).rejects.toThrow('GPU readback failed')
    expect(f.renderer.autoClear).toBe(false)
    expect(f.renderer.xr.enabled).toBe(true)
    for (const { dispose } of targets) expect(dispose).toHaveBeenCalledTimes(1)
  })
})

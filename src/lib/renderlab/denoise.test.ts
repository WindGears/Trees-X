import { beforeEach, expect, it, vi } from 'vitest'
import { ACESFilmicToneMapping, NoToneMapping, PerspectiveCamera, Scene, Texture } from 'three'
import { MeshBasicNodeMaterial, type RenderTarget, type WebGPURenderer } from 'three/webgpu'
import { mrt } from 'three/tsl'
import { createLabDenoise } from './denoise'
import type { LabScene } from './scene'

const mocks = vi.hoisted(() => ({ calls: [] as [Texture, Texture, Texture][], releases: 0 }))
vi.mock('oidn-web', () => ({ UNet: class {}, parseTZA: vi.fn() }))
vi.mock('three-gpu-pathtracer/webgpu', () => ({
  OIDNDenoiser: class {
    texture = new Texture()
    complete = true
    init() {}
    setScene() {}
    reset() {}
    async denoise(color: Texture, albedo: Texture, normal: Texture) {
      mocks.calls.push([color, albedo, normal])
    }
    dispose() {
      mocks.releases++
    }
  },
  RenderToScreenNodeMaterial: class extends MeshBasicNodeMaterial {
    texture: Texture | null = null
    fromTexture: Texture | null = null
    transition = 0
    exposure = 1
  },
}))
beforeEach(() => {
  mocks.calls = []
  mocks.releases = 0
})

function fixture(fail = false) {
  const originalMRT = mrt({}),
    scene = new Scene(),
    camera = new PerspectiveCamera()
  let currentMRT = originalMRT,
    target: RenderTarget | null = null,
    guides: RenderTarget | undefined
  const renderedMRT: (typeof originalMRT)[] = []
  const renderer = {
    domElement: { width: 1440, height: 1000 },
    toneMapping: ACESFilmicToneMapping,
    toneMappingExposure: 1,
    getRenderTarget: () => target,
    getMRT: () => currentMRT,
    setRenderTarget: (value: RenderTarget | null) => (target = value),
    setMRT: (value: typeof originalMRT) => (currentMRT = value),
    render: vi.fn((actualScene: Scene, actualCamera: PerspectiveCamera) => {
      expect(actualScene).toBe(scene)
      expect(actualCamera).toBe(camera)
      expect(renderer.toneMapping).toBe(NoToneMapping)
      expect(target?.textures.map((texture) => texture.name)).toEqual(
        Object.keys(currentMRT.outputNodes),
      )
      expect(target?.textures.map((texture) => texture.name)).toEqual(['output', 'normal'])
      expect(target?.width).toBe(1440)
      expect(target?.height).toBe(1000)
      renderedMRT.push(currentMRT)
      guides = target ?? undefined
      if (fail) throw new Error('Guide render failed')
    }),
  }
  return {
    renderer,
    typedRenderer: renderer as unknown as WebGPURenderer,
    shared: { scene, camera } as unknown as LabScene,
    originalMRT,
    renderedMRT,
    guides: () => guides,
  }
}

it('binds actual MRT attachments by name and restores raster state before guided denoise', async () => {
  const test = fixture(),
    driver = await createLabDenoise(test.typedRenderer, test.shared),
    color = new Texture()
  const result = await driver.execute(color)
  expect(result.complete).toBe(true)
  expect(mocks.calls).toEqual([[color, ...test.guides()!.textures]])
  expect(test.renderer.getRenderTarget()).toBeNull()
  expect(test.renderer.getMRT()).toBe(test.originalMRT)
  expect(test.renderer.toneMapping).toBe(ACESFilmicToneMapping)
  await driver.execute(color)
  expect(test.renderedMRT).toHaveLength(2)
  expect(test.renderedMRT[1]).toBe(test.renderedMRT[0])
  expect(test.renderer.getMRT()).toBe(test.originalMRT)
  const dispose = vi.spyOn(test.guides()!, 'dispose')
  driver.dispose()
  driver.dispose()
  expect(dispose).toHaveBeenCalledTimes(1)
  expect(mocks.releases).toBe(1)
})

it('does not denoise a failed guide draw and restores the renderer on failure', async () => {
  const test = fixture(true),
    driver = await createLabDenoise(test.typedRenderer, test.shared)
  await expect(driver.execute(new Texture())).rejects.toThrow('Guide render failed')
  expect(mocks.calls).toEqual([])
  expect(test.renderer.getRenderTarget()).toBeNull()
  expect(test.renderer.getMRT()).toBe(test.originalMRT)
  expect(test.renderer.toneMapping).toBe(ACESFilmicToneMapping)
  driver.dispose()
})

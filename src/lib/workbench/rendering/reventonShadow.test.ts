import {
  BoxGeometry,
  ClampToEdgeWrapping,
  Color,
  Group,
  LinearFilter,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Scene,
  UnsignedByteType,
  Vector4,
} from 'three'
import { NodeMaterial, RenderTarget, type WebGPURenderer } from 'three/webgpu'
import { describe, expect, it, vi } from 'vitest'
import { createGpuReventonShadow } from './reventonShadow'

function fixture() {
  const retained = new RenderTarget(),
    original = new MeshStandardMaterial(),
    scene = new Scene(),
    model = new Group(),
    geometry = new BoxGeometry(),
    opaque = new Mesh(geometry, original),
    glazing = new Mesh(geometry, new MeshPhysicalMaterial({ transmission: 1 }))
  opaque.layers.set(3)
  model.add(opaque, glazing)
  scene.add(model)
  scene.background = new Color('#123456')
  scene.overrideMaterial = original
  const mrt = {},
    hook = vi.fn(),
    renderer = {
      toneMapping: 4,
      toneMappingExposure: 1.3,
      outputColorSpace: 'srgb',
      autoClear: false,
      opaque: true,
      depth: true,
      stencil: false,
      transparent: true,
      contextNode: null,
      xr: { enabled: true },
      shadowMap: { enabled: true },
      getRenderTarget: () => retained,
      getActiveCubeFace: () => 2,
      getActiveMipmapLevel: () => 1,
      getRenderObjectFunction: () => hook,
      setRenderObjectFunction: vi.fn(),
      getPixelRatio: () => 1.5,
      setPixelRatio: vi.fn(),
      getMRT: () => mrt,
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
      setRenderTarget: vi.fn<(target: RenderTarget | null, face?: number, mip?: number) => void>(),
      render: vi.fn<(scene: Scene, camera: unknown) => void>(),
      compileAsync: vi
        .fn<(scene: Scene, camera: unknown) => Promise<void>>()
        .mockResolvedValue(undefined),
    }
  return {
    retained,
    original,
    scene,
    model,
    geometry,
    opaque,
    glazing,
    mrt,
    hook,
    renderer,
    gpu: renderer as unknown as WebGPURenderer,
  }
}

describe('car WebGPU contact projection', () => {
  it.each(['success', 'failure', 'cancel'] as const)(
    'prepares actual depth and shared blur PSOs with owned state and keeps shadow dirty on %s',
    async (mode) => {
      const f = fixture(),
        abort = new AbortController(),
        background = f.scene.background,
        shadow = createGpuReventonShadow(f.gpu, f.scene, f.model)
      f.renderer.compileAsync.mockImplementation(async (scene) => {
        expect(f.renderer.xr.enabled).toBe(false)
        expect(f.renderer.shadowMap.enabled).toBe(false)
        expect(f.renderer.transparent).toBe(false)
        const target = f.renderer.setRenderTarget.mock.lastCall![0]!
        expect(f.renderer.depth).toBe(target.depthBuffer)
        expect(f.renderer.stencil).toBe(target.stencilBuffer)
        if (scene === f.scene) {
          expect(scene.overrideMaterial).toBeInstanceOf(NodeMaterial)
          expect(f.opaque.frustumCulled).toBe(false)
        }
        if (mode === 'failure') throw new Error('compile failed')
        if (mode === 'cancel') abort.abort()
      })
      try {
        const result = shadow.prepare(abort.signal)
        if (mode === 'success') {
          await result
          expect(f.renderer.compileAsync).toHaveBeenCalledTimes(3)
        } else {
          await expect(result).rejects.toThrow()
          expect(f.renderer.compileAsync).toHaveBeenCalledTimes(1)
        }
        expect(f.renderer.render).not.toHaveBeenCalled()
        expect(f.scene.background).toBe(background)
        expect(f.scene.overrideMaterial).toBe(f.original)
        expect(f.opaque.frustumCulled).toBe(true)
        expect(f.renderer.xr.enabled).toBe(true)
        expect(f.renderer.shadowMap.enabled).toBe(true)
        expect(f.renderer.transparent).toBe(true)
        expect(f.renderer.depth).toBe(true)
        expect(f.renderer.stencil).toBe(false)
        expect(f.renderer.setMRT).toHaveBeenLastCalledWith(f.mrt)
        expect(f.renderer.setRenderTarget).toHaveBeenLastCalledWith(f.retained, 2, 1)
        shadow.render()
        expect(f.renderer.render).toHaveBeenCalledTimes(3)
      } finally {
        shadow.dispose()
        f.geometry.dispose()
        f.original.dispose()
        f.glazing.material.dispose()
        f.retained.dispose()
      }
    },
  )

  it('retains the authored camera, 2048 targets, paired Gaussian, and pose-only redraw ownership', () => {
    const f = fixture(),
      sourceDispose = vi.spyOn(f.geometry, 'dispose'),
      shadow = createGpuReventonShadow(f.gpu, f.scene, f.model),
      plane = f.scene.getObjectByName('Reventon / live contact shadow') as Mesh,
      planeDispose = vi.spyOn(plane.geometry, 'dispose')
    expect(plane.position.y).toBe(0)
    expect(plane.material).toMatchObject({ opacity: 0.8, depthWrite: false, toneMapped: false })
    expect(f.opaque.layers.mask).toBe((1 << 3) | (1 << 7))
    expect(f.glazing.layers.mask).toBe(1)
    shadow.render()
    expect(f.renderer.render).toHaveBeenCalledTimes(3)
    const camera = f.renderer.render.mock.calls[0]![1]
    expect(camera).toMatchObject({ left: -6, right: 6, top: 6, bottom: -6, near: 0, far: 2.4 })
    expect(camera).toHaveProperty('position.y', 0.001)
    const target = f.renderer.setRenderTarget.mock.calls[0]![0] as RenderTarget,
      temporary = f.renderer.setRenderTarget.mock.calls[1]![0] as RenderTarget,
      targetDispose = vi.spyOn(target, 'dispose'),
      temporaryDispose = vi.spyOn(temporary, 'dispose'),
      blurScene = f.renderer.render.mock.calls[1]![0],
      quad = blurScene.children[0] as Mesh,
      blur = quad.material as NodeMaterial,
      samples = new Set<object>()
    expect(target).toMatchObject({ width: 2048, height: 2048 })
    expect(temporary).toMatchObject({ width: 2048, height: 2048, depthBuffer: false })
    expect(target.texture.type).toBe(UnsignedByteType)
    // Pairing is equivalent only on the unchanged texel grid with a linear
    // LOD0 sampler. A future nearest/mip/repeat change must not silently reuse it.
    for (const texture of [target.texture, temporary.texture]) {
      expect(texture.minFilter).toBe(LinearFilter)
      expect(texture.magFilter).toBe(LinearFilter)
      expect(texture.generateMipmaps).toBe(false)
      expect(texture.wrapS).toBe(ClampToEdgeWrapping)
      expect(texture.wrapT).toBe(ClampToEdgeWrapping)
    }
    blur.fragmentNode?.traverse((node) => {
      if (Reflect.get(node, 'isTextureNode') === true && Reflect.get(node, 'uvNode') !== null)
        samples.add(node)
    })
    expect(samples.size).toBe(33)
    shadow.render()
    expect(f.renderer.render).toHaveBeenCalledTimes(3)
    shadow.markDirty()
    shadow.render()
    expect(f.renderer.render).toHaveBeenCalledTimes(6)
    shadow.dispose()
    shadow.dispose()
    expect(f.scene.getObjectByName(plane.name)).toBeUndefined()
    expect(f.opaque.layers.mask).toBe(1 << 3)
    expect(planeDispose).toHaveBeenCalledTimes(1)
    expect(targetDispose).toHaveBeenCalledTimes(1)
    expect(temporaryDispose).toHaveBeenCalledTimes(1)
    expect(sourceDispose).not.toHaveBeenCalled()
    f.geometry.dispose()
    f.original.dispose()
    f.glazing.material.dispose()
    f.retained.dispose()
  })

  it.each([1, 2, 3])(
    'restores renderer/scene state after failure in pass %s and retries the dirty projection',
    (failedPass) => {
      const f = fixture(),
        background = f.scene.background,
        shadow = createGpuReventonShadow(f.gpu, f.scene, f.model)
      let calls = 0
      f.renderer.render.mockImplementation(() => {
        if (++calls === failedPass) throw new Error('injected pass failure')
      })
      expect(() => shadow.render()).toThrow('injected pass failure')
      expect(f.scene.overrideMaterial).toBe(f.original)
      expect(f.scene.background).toBe(background)
      expect(f.renderer.xr.enabled).toBe(true)
      expect(f.renderer.shadowMap.enabled).toBe(true)
      expect(f.renderer.autoClear).toBe(false)
      expect(f.renderer.setRenderTarget).toHaveBeenLastCalledWith(f.retained, 2, 1)
      expect(f.renderer.setMRT).toHaveBeenLastCalledWith(f.mrt)
      expect(f.renderer.setRenderObjectFunction).toHaveBeenLastCalledWith(f.hook)
      expect(f.renderer.setViewport).toHaveBeenLastCalledWith(new Vector4(3, 5, 1440, 1000))
      expect(f.renderer.setScissor).toHaveBeenLastCalledWith(new Vector4(7, 9, 900, 700))
      f.renderer.render.mockReset()
      shadow.render()
      expect(f.renderer.render).toHaveBeenCalledTimes(3)
      shadow.dispose()
      f.geometry.dispose()
      f.original.dispose()
      f.glazing.material.dispose()
      f.retained.dispose()
    },
  )
})

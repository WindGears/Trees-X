import {
  BoxGeometry,
  Color,
  Group,
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
  it('retains the authored camera, 2048 targets, 65 taps, and pose-only redraw ownership', () => {
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
    blur.fragmentNode?.traverse((node) => {
      if (Reflect.get(node, 'isTextureNode') === true && Reflect.get(node, 'uvNode') !== null)
        samples.add(node)
    })
    expect(samples.size).toBe(65)
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

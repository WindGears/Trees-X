import { describe, expect, it, vi } from 'vitest'
import {
  BoxGeometry,
  Color,
  Group,
  HalfFloatType,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Scene,
  ShaderMaterial,
  Vector4,
} from 'three'
import { MeshBasicNodeMaterial, MeshStandardNodeMaterial, type WebGPURenderer } from 'three/webgpu'
import { createGpuStudioGeometry } from './studioGeometry'
import { createGpuStudioReflection } from './studioReflection'
import { createGpuStudioShadow } from './studioShadow'
import { createStudioSkyTexture } from './studioEnvironment'
import { studioDesign } from '../studio/design'

function rendererFixture() {
  const retained = { previous: true },
    renderFunction = vi.fn(),
    mrt = { prior: true }
  const renderer = {
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
    getRenderObjectFunction: () => renderFunction,
    setRenderObjectFunction: vi.fn(),
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
    setRenderTarget: vi.fn(),
    render: vi.fn(),
  }
  return { renderer, retained, renderFunction, mrt, gpu: renderer as unknown as WebGPURenderer }
}

describe('WebGPU authored studio', () => {
  it('retains its physical stage and background while excluding raster approximations from tracing', () => {
    const geometry = createGpuStudioGeometry(-0.15)
    const sky = geometry.group.getObjectByName('Trees X / studio skybox') as Mesh
    const floor = geometry.group.getObjectByName('Trees X / studio floor') as Mesh
    const pedestal = geometry.group.getObjectByName('Trees X / studio pedestal') as Mesh
    expect(sky.material).toBeInstanceOf(MeshBasicNodeMaterial)
    expect(sky.userData.traceExclude).toBe(true)
    expect((sky.material as MeshBasicNodeMaterial).vertexNode).not.toBeNull()
    expect(floor.material).toBeInstanceOf(MeshStandardNodeMaterial)
    expect(floor.userData.traceMaterial).toBeInstanceOf(MeshStandardMaterial)
    expect(floor.userData.traceExclude).toBeUndefined()
    expect(pedestal.material).toBeInstanceOf(MeshPhysicalMaterial)
    expect(pedestal.position.y).toBeCloseTo(-0.15 - studioDesign.height / 2)
    expect(geometry.group.children.some((m) => m.name.includes('lightboard'))).toBe(false)
    geometry.group.traverse((object) => {
      if (object instanceof Mesh) expect(object.material).not.toBeInstanceOf(ShaderMaterial)
    })
    const source = vi.spyOn(pedestal.geometry, 'dispose'),
      trace = vi.spyOn(floor.userData.traceMaterial as MeshStandardMaterial, 'dispose'),
      skyDispose = vi.spyOn(sky.material as MeshBasicNodeMaterial, 'dispose')
    geometry.dispose()
    geometry.dispose()
    expect(source).toHaveBeenCalledTimes(1)
    expect(trace).toHaveBeenCalledTimes(1)
    expect(skyDispose).toHaveBeenCalledTimes(1)
  })

  it('keeps the planar reflection as a separate owned TSL layer', () => {
    const reflection = createGpuStudioReflection()
    expect(reflection.mesh.userData.traceExclude).toBe(true)
    expect(reflection.mesh.material).toBeInstanceOf(MeshBasicNodeMaterial)
    expect(reflection.mesh.rotation.x).toBe(-Math.PI / 2)
    expect(reflection.mesh.position.y).toBeCloseTo(studioDesign.groundY + 0.00035)
    expect(reflection.mesh.children).toHaveLength(1)
    const geometry = vi.spyOn(reflection.mesh.geometry, 'dispose'),
      material = vi.spyOn(reflection.mesh.material, 'dispose')
    const scene = new Scene()
    scene.add(reflection.mesh)
    reflection.dispose()
    reflection.dispose()
    expect(reflection.mesh.parent).toBeNull()
    expect(geometry).toHaveBeenCalledTimes(1)
    expect(material).toHaveBeenCalledTimes(1)
  })

  it('updates pose shadows only when dirty, retries failure and restores renderer state', () => {
    const f = rendererFixture(),
      scene = new Scene(),
      model = new Group(),
      sourceGeometry = new BoxGeometry(),
      opaque = new Mesh(sourceGeometry, new MeshBasicMaterial()),
      glass = new Mesh(sourceGeometry, new MeshPhysicalMaterial({ transmission: 1 }))
    model.add(opaque, glass)
    scene.add(model)
    scene.background = new Color('#dfe4df')
    const oldBackground = scene.background
    const shadow = createGpuStudioShadow(f.gpu, scene, model, studioDesign.groundY)
    expect(opaque.layers.mask).toBe(129)
    expect(glass.layers.mask).toBe(1)
    f.renderer.render.mockImplementationOnce(() => {
      throw new Error('failed GPU depth pass')
    })
    expect(shadow.render).toThrow('failed GPU depth pass')
    expect(scene.background).toBe(oldBackground)
    expect(scene.overrideMaterial).toBeNull()
    expect(f.renderer.autoClear).toBe(false)
    expect(f.renderer.xr.enabled).toBe(true)
    expect(f.renderer.setRenderTarget).toHaveBeenLastCalledWith(f.retained, 2, 1)
    expect(f.renderer.setMRT).toHaveBeenLastCalledWith(f.mrt)
    expect(f.renderer.setRenderObjectFunction).toHaveBeenLastCalledWith(f.renderFunction)
    expect(f.renderer.setViewport).toHaveBeenLastCalledWith(new Vector4(3, 5, 1440, 1000))
    expect(f.renderer.setScissor).toHaveBeenLastCalledWith(new Vector4(7, 9, 900, 700))
    shadow.render()
    shadow.render()
    expect(f.renderer.render).toHaveBeenCalledTimes(4)
    shadow.markDirty()
    shadow.render()
    expect(f.renderer.render).toHaveBeenCalledTimes(7)
    const plane = scene.getObjectByName('Trees X / studio contact shadow') as Mesh
    expect(plane.userData.traceExclude).toBe(true)
    expect((plane.material as MeshBasicNodeMaterial).opacity).toBe(0.46)
    const source = vi.spyOn(sourceGeometry, 'dispose'),
      receiver = vi.spyOn(plane.geometry, 'dispose')
    const targets = [
      ...new Set(
        f.renderer.setRenderTarget.mock.calls
          .map((call) => call[0])
          .filter((target) => target && target !== f.retained),
      ),
    ]
    expect(targets).toHaveLength(2)
    const disposals = targets.map((target) => {
      expect(target.texture.type).toBe(HalfFloatType)
      return vi.spyOn(target, 'dispose')
    })
    shadow.dispose()
    shadow.dispose()
    expect(source).not.toHaveBeenCalled()
    expect(receiver).toHaveBeenCalledTimes(1)
    for (const dispose of disposals) expect(dispose).toHaveBeenCalledTimes(1)
    expect(opaque.layers.mask).toBe(1)
    sourceGeometry.dispose()
    opaque.material.dispose()
    glass.material.dispose()
  })

  it('creates deterministic seamless camera background distinct from lightboard environment', () => {
    const first = createStudioSkyTexture(),
      second = createStudioSkyTexture()
    expect(first.image.data === second.image.data).toBe(false)
    const other = second.image.data as Float32Array
    expect((first.image.data as Float32Array).every((value, index) => value === other[index])).toBe(
      true,
    )
    expect(first.flipY).toBe(false)
    expect(first.image.width).toBe(1024)
    expect(first.image.height).toBe(512)
    const data = first.image.data as Float32Array
    const bottom = new Color(studioDesign.backdrop.bottom),
      top = new Color(studioDesign.backdrop.top)
    expect(data[0]).toBeCloseTo(bottom.r, 6)
    expect(data[data.length - 4]).toBeCloseTo(top.r, 6)
    expect(data.every(Number.isFinite)).toBe(true)
    first.dispose()
    second.dispose()
  })
})

import { describe, expect, it, vi } from 'vitest'
import {
  Box3,
  BoxGeometry,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  PerspectiveCamera,
  Scene,
  ShaderMaterial,
  Vector3,
  Vector4,
  type WebGLRenderer,
} from 'three'
import { createStudioGeometry } from './geometry'
import { createStudioReflection } from './reflection'
import { createStudioContactShadow } from './contactShadow'
import { createTypewriterStudio } from './stage'
import { studioDesign } from './design'

function rendererFixture() {
  const previous = { retained: true }
  const renderer = {
    autoClear: false,
    xr: { enabled: true },
    shadowMap: { autoUpdate: true },
    state: { buffers: { depth: { setMask: vi.fn() } } },
    getRenderTarget: () => previous,
    getActiveCubeFace: () => 2,
    getActiveMipmapLevel: () => 1,
    getClearAlpha: () => 0.6,
    getClearColor: (color: Color) => color.set('#123456'),
    getViewport: (viewport: Vector4) => viewport.set(3, 5, 1440, 1000),
    getScissor: (scissor: Vector4) => scissor.set(7, 9, 900, 700),
    getScissorTest: () => true,
    setViewport: vi.fn(),
    setScissor: vi.fn(),
    setScissorTest: vi.fn(),
    setClearColor: vi.fn(),
    setRenderTarget: vi.fn(),
    clear: vi.fn(),
    render: vi.fn(),
  }
  return { renderer, previous, webgl: renderer as unknown as WebGLRenderer }
}

describe('authored product studio', () => {
  it('shares the visible emitter layout and preserves the chosen model ground height', () => {
    const studio = createStudioGeometry(-0.15)
    expect(studio.group.name).toBe('Trees X / product studio')
    expect(studio.group.userData.studio).toBe(true)
    const pedestal = studio.group.getObjectByName('Trees X / studio pedestal') as Mesh
    expect(new Box3().setFromObject(pedestal).max.y).toBeCloseTo(-0.15, 6)
    const size = new Box3().setFromObject(pedestal).getSize(new Vector3())
    expect(size.x).toBeCloseTo(studioDesign.width, 6)
    expect(size.y).toBeCloseTo(studioDesign.height, 6)
    expect(size.z).toBeCloseTo(studioDesign.depth, 6)
    for (const panel of studioDesign.panels) {
      const mesh = studio.group.getObjectByName(`Trees X / studio ${panel.name} lightboard`) as Mesh
      expect(mesh.position.toArray()).toEqual([...panel.position])
      expect((mesh.material as MeshBasicMaterial).color.r).toBeGreaterThan(1)
    }
    const frame = studio.group.getObjectByName('Trees X / studio window mullion') as Mesh
    const materialDispose = vi.spyOn(frame.material as MeshPhysicalMaterial, 'dispose')
    const geometryDispose = vi.spyOn(pedestal.geometry, 'dispose')
    const scene = new Scene()
    scene.add(studio.group)
    studio.dispose()
    studio.dispose()
    expect(studio.group.parent).toBeNull()
    expect(materialDispose).toHaveBeenCalledTimes(1)
    expect(geometryDispose).toHaveBeenCalledTimes(1)
  })

  it('restores reflection state on interrupted rendering and disposes its own target once', () => {
    const f = rendererFixture(),
      scene = new Scene()
    const studio = createStudioReflection()
    studio.attach(scene)
    scene.updateMatrixWorld(true)
    const camera = new PerspectiveCamera(45, 1, 0.01, 40)
    camera.position.set(0, 2, 4)
    camera.lookAt(0, 0.2, 0)
    camera.updateMatrixWorld(true)
    f.renderer.render.mockImplementationOnce(() => {
      throw new Error('interrupted reflection')
    })
    const reflection = studio.reflection
    expect(() =>
      reflection.onBeforeRender(
        f.webgl,
        scene,
        camera,
        reflection.geometry,
        reflection.material as ShaderMaterial,
        new Group(),
      ),
    ).toThrow('interrupted reflection')
    expect(reflection.visible).toBe(true)
    expect(f.renderer.xr.enabled).toBe(true)
    expect(f.renderer.shadowMap.autoUpdate).toBe(true)
    expect(f.renderer.setRenderTarget).toHaveBeenLastCalledWith(f.previous, 2, 1)
    expect(f.renderer.setViewport).toHaveBeenLastCalledWith(new Vector4(3, 5, 1440, 1000))
    expect(f.renderer.setScissor).toHaveBeenLastCalledWith(new Vector4(7, 9, 900, 700))
    expect(f.renderer.setScissorTest).toHaveBeenLastCalledWith(true)
    const targetDispose = vi.spyOn(reflection.getRenderTarget(), 'dispose')
    const materialDispose = vi.spyOn(reflection.material as ShaderMaterial, 'dispose')
    const geometryDispose = vi.spyOn(reflection.geometry, 'dispose')
    studio.dispose()
    studio.dispose()
    expect(targetDispose).toHaveBeenCalledTimes(1)
    expect(materialDispose).toHaveBeenCalledTimes(1)
    expect(geometryDispose).toHaveBeenCalledTimes(1)
    expect(reflection.parent).toBeNull()
  })

  it('updates shadows only after pose changes, preserves renderer state and retries a failed pass', () => {
    const f = rendererFixture(),
      scene = new Scene(),
      model = new Group()
    scene.background = new Color('#dfe4df')
    const sourceGeometry = new BoxGeometry()
    const opaque = new Mesh(sourceGeometry, new MeshBasicMaterial())
    const glass = new Mesh(sourceGeometry, new MeshPhysicalMaterial({ transmission: 1 }))
    model.add(opaque, glass)
    scene.add(model)
    const shadow = createStudioContactShadow(f.webgl, scene, model, studioDesign.groundY)
    expect(opaque.layers.mask).toBe(129)
    expect(glass.layers.mask).toBe(1)
    const background = scene.background
    f.renderer.render.mockImplementationOnce(() => {
      throw new Error('interrupted depth')
    })
    expect(() => shadow.render()).toThrow('interrupted depth')
    expect(scene.background).toBe(background)
    expect(scene.overrideMaterial).toBeNull()
    expect(f.renderer.autoClear).toBe(false)
    expect(f.renderer.xr.enabled).toBe(true)
    expect(f.renderer.shadowMap.autoUpdate).toBe(true)
    expect(f.renderer.setRenderTarget).toHaveBeenLastCalledWith(f.previous, 2, 1)
    shadow.render()
    shadow.render()
    expect(f.renderer.render).toHaveBeenCalledTimes(4)
    shadow.markDirty()
    shadow.render()
    expect(f.renderer.render).toHaveBeenCalledTimes(7)
    const sourceDispose = vi.spyOn(sourceGeometry, 'dispose')
    const plane = scene.getObjectByName('Trees X / studio contact shadow') as Mesh
    const planeDispose = vi.spyOn(plane.geometry, 'dispose')
    shadow.dispose()
    shadow.dispose()
    expect(planeDispose).toHaveBeenCalledTimes(1)
    expect(sourceDispose).not.toHaveBeenCalled()
    expect(opaque.layers.mask).toBe(1)
    expect(plane.parent).toBeNull()
  })

  it('unmounts all studio objects without releasing or moving the source model', () => {
    const f = rendererFixture(),
      scene = new Scene(),
      model = new Group()
    const geometry = new BoxGeometry(),
      material = new MeshBasicMaterial()
    const mesh = new Mesh(geometry, material)
    model.position.set(0.2, 0.3, -0.1)
    model.add(mesh)
    scene.add(model)
    const sourceDispose = vi.spyOn(geometry, 'dispose')
    const studio = createTypewriterStudio(f.webgl, scene, model)
    expect(scene.getObjectByName('Trees X / studio reflection')).toBeDefined()
    studio.dispose()
    studio.dispose()
    expect(scene.children).toEqual([model])
    expect(model.position.toArray()).toEqual([0.2, 0.3, -0.1])
    expect(sourceDispose).not.toHaveBeenCalled()
    expect(mesh.layers.mask).toBe(1)
  })
})

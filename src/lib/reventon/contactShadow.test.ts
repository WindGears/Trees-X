import { describe, expect, it, vi } from 'vitest'
import {
  BoxGeometry,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  Scene,
} from 'three'
import type { WebGLRenderer } from 'three'
import { createContactShadow } from './contactShadow'

function fixture() {
  const scene = new Scene()
  scene.background = new Color('#dededb')
  const root = new Group()
  const geometry = new BoxGeometry()
  const body = new Mesh(geometry, new MeshBasicMaterial())
  const glass = new Mesh(geometry, new MeshPhysicalMaterial({ transmission: 1 }))
  root.add(body, glass)
  scene.add(root)
  const oldTarget = { previous: true }
  const renderer = {
    autoClear: false,
    shadowMap: { autoUpdate: true },
    getRenderTarget: () => oldTarget,
    getClearAlpha: () => 0.6,
    getClearColor: (color: Color) => color.set('#123456'),
    setClearColor: vi.fn(),
    setRenderTarget: vi.fn(),
    render: vi.fn(),
  }
  const shadow = createContactShadow(renderer as unknown as WebGLRenderer, scene, root)
  return { scene, root, body, glass, geometry, oldTarget, renderer, shadow }
}
describe('Reventon live contact shadow', () => {
  it('isolates opaque geometry and restores render state even when drawing fails', () => {
    const f = fixture()
    const background = f.scene.background
    expect(f.body.layers.mask).toBe(129)
    expect(f.glass.layers.mask).toBe(1)
    f.renderer.render.mockImplementationOnce(() => {
      throw new Error('context lost')
    })
    expect(() => f.shadow.render()).toThrow('context lost')
    expect(f.scene.overrideMaterial).toBeNull()
    expect(f.scene.background).toBe(background)
    expect(f.renderer.autoClear).toBe(false)
    expect(f.renderer.shadowMap.autoUpdate).toBe(true)
    expect(f.renderer.setRenderTarget).toHaveBeenLastCalledWith(f.oldTarget)
    expect(f.renderer.setClearColor).toHaveBeenLastCalledWith(new Color('#123456'), 0.6)
    f.shadow.dispose()
  })
  it('refreshes after a new pose and releases only owned resources once', () => {
    const f = fixture()
    const sourceDispose = vi.spyOn(f.geometry, 'dispose')
    const plane = f.scene.getObjectByName('Reventon / live contact shadow') as Mesh
    const planeDispose = vi.spyOn(plane.geometry, 'dispose')
    const materialDispose = vi.spyOn(plane.material as MeshBasicMaterial, 'dispose')
    f.shadow.render()
    f.shadow.render()
    expect(f.renderer.render).toHaveBeenCalledTimes(3)
    f.shadow.markDirty()
    f.shadow.render()
    expect(f.renderer.render).toHaveBeenCalledTimes(6)
    f.shadow.dispose()
    f.shadow.dispose()
    expect(f.body.layers.mask).toBe(1)
    expect(plane.parent).toBeNull()
    expect(planeDispose).toHaveBeenCalledTimes(1)
    expect(materialDispose).toHaveBeenCalledTimes(1)
    expect(sourceDispose).not.toHaveBeenCalled()
  })
})

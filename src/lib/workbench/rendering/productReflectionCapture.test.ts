import { Color, DirectionalLight, Group, Mesh, Scene } from 'three'
import { describe, expect, it, vi } from 'vitest'
import { createProductCaptureScope } from './productReflectionCapture'

function fixture() {
  const scene = new Scene(),
    product = new Group(),
    studio = new Group(),
    lights = new Group(),
    hidden = new Mesh(),
    color = new Color('#123456')
  lights.add(new DirectionalLight())
  hidden.visible = false
  scene.add(product, studio, lights, hidden)
  scene.background = new Color('#abcdef')
  let alpha = 0.4
  const renderer = {
    getClearColor(target: Color) {
      return target.copy(color)
    },
    getClearAlpha() {
      return alpha
    },
    setClearColor(value: Color | number, next = 1) {
      color.set(value)
      alpha = next
    },
  }
  return { scene, product, studio, lights, hidden, renderer, color }
}

describe('product-only planar reflection scope', () => {
  it('removes background coverage while preserving product, grouped lights and source visibility', () => {
    const f = fixture(),
      original = f.scene.background,
      scope = createProductCaptureScope(f.product),
      disposal = vi.spyOn(f.product, 'removeFromParent')
    expect(
      scope.run(f.scene, f.renderer, () => {
        expect(f.product.visible).toBe(true)
        expect(f.lights.visible).toBe(true)
        expect(f.studio.visible).toBe(false)
        expect(f.hidden.visible).toBe(false)
        expect(f.scene.background).toBeNull()
        expect(f.renderer.getClearAlpha()).toBe(0)
        expect(f.color.getHex()).toBe(0)
        return 42
      }),
    ).toBe(42)
    expect(f.scene.background).toBe(original)
    expect(f.studio.visible).toBe(true)
    expect(f.hidden.visible).toBe(false)
    expect(f.renderer.getClearAlpha()).toBe(0.4)
    expect(f.color.getHex()).toBe(0x123456)
    expect(disposal).not.toHaveBeenCalled()
  })
  it('restores borrowed state after errors and rejects recursive capture', () => {
    const f = fixture(),
      scope = createProductCaptureScope(f.product),
      original = f.scene.background
    expect(() =>
      scope.run(f.scene, f.renderer, () => {
        scope.run(f.scene, f.renderer, () => undefined)
      }),
    ).toThrow('recurse')
    expect(f.scene.background).toBe(original)
    expect(f.studio.visible).toBe(true)
    expect(f.renderer.getClearAlpha()).toBe(0.4)
    expect(scope.run(f.scene, f.renderer, () => true)).toBe(true)
  })
})

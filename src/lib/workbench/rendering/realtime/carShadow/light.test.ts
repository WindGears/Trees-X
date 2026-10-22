import { describe, expect, it, vi } from 'vitest'
import { BoxGeometry, Group, Mesh, MeshPhysicalMaterial, RectAreaLight, Texture } from 'three'
import type { WebGPURenderer } from 'three/webgpu'
import { CarKeyAreaLight, createCarKeyAreaLight, isCarShadowReceiver } from './light'

function receiverFixture() {
  const root = new Group(),
    nested = new Group(),
    geometry = new BoxGeometry(),
    material = new MeshPhysicalMaterial(),
    mesh = new Mesh(geometry, material)
  root.userData.adapter = 'reventon-v1'
  root.userData.carStudioQuality = 'studio'
  root.add(nested)
  nested.add(mesh)
  return {
    root,
    material,
    mesh,
    dispose: () => {
      material.dispose()
      geometry.dispose()
    },
  }
}

describe('renderer-local car key area light', () => {
  it('registers one distinct constructor without replacing ordinary RectAreaLight', () => {
    const ordinary = class OrdinaryLightNode {},
      registered = new Map<unknown, unknown>([[RectAreaLight, ordinary]]),
      getLightNodeClass = vi.fn((type: unknown) => registered.get(type)),
      addLight = vi.fn((node: unknown, type: unknown) => {
        registered.set(type, node)
      }),
      renderer = { library: { getLightNodeClass, addLight } } as unknown as WebGPURenderer
    const first = createCarKeyAreaLight(renderer),
      second = createCarKeyAreaLight(renderer)
    expect(first).toBeInstanceOf(CarKeyAreaLight)
    expect(first).toBeInstanceOf(RectAreaLight)
    expect(second).not.toBe(first)
    expect(first.intensity).toBe(7)
    expect([first.width, first.height]).toEqual([6, 3])
    expect(addLight).toHaveBeenCalledOnce()
    expect(addLight.mock.calls[0]![1]).toBe(CarKeyAreaLight)
    expect(registered.get(RectAreaLight)).toBe(ordinary)
    expect(registered.get(CarKeyAreaLight)).not.toBe(ordinary)
  })

  it('rejects an incompatible or already-owned node library', () => {
    expect(() => createCarKeyAreaLight({ library: {} } as unknown as WebGPURenderer)).toThrow(
      'library contract',
    )
    const renderer = {
      library: { getLightNodeClass: () => class DifferentNode {}, addLight: vi.fn() },
    } as unknown as WebGPURenderer
    expect(() => createCarKeyAreaLight(renderer)).toThrow('already owned')
  })

  it('accepts nested opaque car surfaces and native clearcoat without changing their material', () => {
    const f = receiverFixture()
    f.material.clearcoat = 1
    const original = f.mesh.material
    expect(isCarShadowReceiver(f.mesh, f.material)).toBe(true)
    expect(f.mesh.material).toBe(original)
    expect(f.material.clearcoat).toBe(1)
    f.dispose()
  })

  it('excludes the floor, another product, and a car without the registered studio candidate', () => {
    const f = receiverFixture(),
      floor = new Mesh(f.mesh.geometry, f.material)
    expect(isCarShadowReceiver(floor, f.material)).toBe(false)
    expect(isCarShadowReceiver(f.root, f.material)).toBe(false)
    f.root.userData.adapter = 'piano-v1'
    expect(isCarShadowReceiver(f.mesh, f.material)).toBe(false)
    f.root.userData.adapter = 'reventon-v1'
    f.root.userData.carStudioQuality = 'baseline'
    expect(isCarShadowReceiver(f.mesh, f.material)).toBe(false)
    f.dispose()
  })

  it('excludes native transmission, opacity, transparent decals and alpha-cutout materials', () => {
    const f = receiverFixture(),
      alphaMap = new Texture()
    for (const overrides of [
      { transmission: 1 },
      { opacity: 0.5 },
      { transparent: true },
      { alphaTest: 0.01 },
      { alphaMap },
    ]) {
      const material = f.material.clone()
      Object.assign(material, overrides)
      expect(isCarShadowReceiver(f.mesh, material)).toBe(false)
      material.dispose()
    }
    alphaMap.dispose()
    f.dispose()
  })
})

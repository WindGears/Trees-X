import { DirectionalLight, Scene } from 'three'
import { describe, expect, it, vi } from 'vitest'
import { createReventonStageWithShadow } from './reventonStage'

describe('car shared native and contact shadow ownership', () => {
  it('refreshes before auxiliary passes and shares pose dirtiness without camera churn', () => {
    const scene = new Scene(),
      light = new DirectionalLight(),
      shadow = { markDirty: vi.fn(), render: vi.fn(), dispose: vi.fn() }
    light.castShadow = true
    light.shadow.mapSize.set(2048, 2048)
    light.shadow.bias = -0.00008
    light.shadow.radius = 3
    scene.add(light)
    const stage = createReventonStageWithShadow(scene, () => shadow)
    expect(light.shadow.autoUpdate).toBe(false)
    expect(light.shadow.needsUpdate).toBe(true)
    shadow.render.mockImplementationOnce(() => {
      expect(light.shadow.autoUpdate).toBe(false)
      expect(light.shadow.needsUpdate).toBe(true)
    })
    stage.render()
    expect(shadow.render).toHaveBeenCalledTimes(1)
    light.shadow.needsUpdate = false
    stage.render()
    expect(light.shadow.needsUpdate).toBe(false)
    stage.markDirty()
    expect(shadow.markDirty).toHaveBeenCalledTimes(1)
    stage.render()
    expect(light.shadow.needsUpdate).toBe(true)
    expect(light.shadow.mapSize.toArray()).toEqual([2048, 2048])
    expect(light.shadow.bias).toBe(-0.00008)
    expect(light.shadow.radius).toBe(3)
    stage.dispose()
    stage.dispose()
    stage.markDirty()
    stage.render()
    expect(shadow.dispose).toHaveBeenCalledTimes(1)
    expect(shadow.render).toHaveBeenCalledTimes(3)
    expect(light.shadow.autoUpdate).toBe(true)
    expect(scene.children).toEqual([light])
  })

  it('releases per-light ownership after contact preparation fails or disposal throws', () => {
    const scene = new Scene(),
      light = new DirectionalLight()
    light.castShadow = true
    scene.add(light)
    expect(() =>
      createReventonStageWithShadow(scene, () => {
        expect(light.shadow.autoUpdate).toBe(false)
        throw new Error('contact preparation failed')
      }),
    ).toThrow('contact preparation failed')
    expect(light.shadow.autoUpdate).toBe(true)
    expect(scene.children).toEqual([light])
    const stage = createReventonStageWithShadow(scene, () => ({
      markDirty: vi.fn(),
      render: vi.fn(),
      dispose: () => {
        throw new Error('contact teardown failed')
      },
    }))
    expect(() => stage.dispose()).toThrow('contact teardown failed')
    expect(light.shadow.autoUpdate).toBe(true)
    const rebuilt = createReventonStageWithShadow(scene, () => ({
      markDirty: vi.fn(),
      render: vi.fn(),
      dispose: vi.fn(),
    }))
    expect(light.shadow.needsUpdate).toBe(true)
    rebuilt.dispose()
  })
})

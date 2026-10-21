import { DirectionalLight, RectAreaLight, Scene } from 'three'
import { describe, expect, it, vi } from 'vitest'
import { createReventonStageWithShadow } from './reventonStage'
import { carStudioLighting } from './carStudioQuality'

describe('car shared native and contact shadow ownership', () => {
  it('keeps the baseline lights and applies the frozen studio look only explicitly', () => {
    const scene = new Scene(),
      createShadow = () => ({ render: vi.fn(), markDirty: vi.fn(), dispose: vi.fn() })
    const base = createReventonStageWithShadow(scene, createShadow)
    let lights = scene.children.filter((o): o is RectAreaLight => o instanceof RectAreaLight)
    expect(lights.map((light) => light.intensity)).toEqual([7, 4])
    expect(lights[0]!.position.toArray()).toEqual([-1, 4, -3])
    base.dispose()
    const studio = createReventonStageWithShadow(scene, createShadow, { quality: 'studio' })
    lights = scene.children.filter((o): o is RectAreaLight => o instanceof RectAreaLight)
    for (const [index, profile] of [carStudioLighting.key, carStudioLighting.strip].entries()) {
      expect(lights[index]!.intensity).toBe(profile.intensity)
      expect(lights[index]!.position.toArray()).toEqual(profile.position)
      expect(lights[index]!.width).toBe(profile.width)
      expect(lights[index]!.height).toBe(profile.height)
    }
    studio.dispose()
    expect(scene.children).toEqual([])
  })
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

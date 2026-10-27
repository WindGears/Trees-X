import { describe, expect, it, vi } from 'vitest'
import { Mesh, MeshPhysicalMaterial, RectAreaLight } from 'three'
import {
  LightsNode,
  PhysicalLightingModel,
  RectAreaLightNode,
  type NodeBuilder,
  type WebGPURenderer,
} from 'three/webgpu'
import { vec3 } from 'three/tsl'
import { CarKeyAreaLight } from '../realtime/carShadow/light'
import { coldStudioConfig } from './config'
import { configureShowroomLight, createShowroomAreaLight, withDiffuseAreaLight } from './lights'

function fixture() {
  const ordinary = class OrdinaryRectAreaLightNode {},
    mappings = new Map<unknown, unknown>([[RectAreaLight, ordinary]]),
    getLightNodeClass = vi.fn((type: unknown) => mappings.get(type)),
    addLight = vi.fn((node: unknown, type: unknown) => {
      mappings.set(type, node)
    }),
    renderer = { library: { getLightNodeClass, addLight } } as unknown as WebGPURenderer
  return { ordinary, mappings, getLightNodeClass, addLight, renderer }
}

function inputs(): Parameters<PhysicalLightingModel['directRectArea']>[0] {
  return {
    lightNode: vec3(1),
    lightColor: vec3(1),
    lightPosition: vec3(0, 4, 0),
    halfWidth: vec3(2, 0, 0),
    halfHeight: vec3(0, 0, 1),
    ltc_1: vec3(1),
    ltc_2: vec3(1),
    reflectedLight: {
      directDiffuse: vec3(0).toVar(),
      directSpecular: vec3(0).toVar(),
      indirectDiffuse: vec3(0).toVar(),
      indirectSpecular: vec3(0).toVar(),
    },
  }
}

describe('same-room visible panels and diffuse-only area lights', () => {
  it.each(['wall', 'floor', 'car', 'floor-local', 'cabin'])(
    'routes %s specular consistently with its environment source',
    (receiver) => {
      const f = fixture(),
        light = createShowroomAreaLight(f.renderer, coldStudioConfig.lights.strip),
        NodeClass = f.mappings.get(light.constructor) as new (
          value: RectAreaLight,
        ) => RectAreaLightNode,
        node = new NodeClass(light),
        input = inputs(),
        model = new PhysicalLightingModel(true),
        object = new Mesh(),
        native = vi.fn<PhysicalLightingModel['directRectArea']>()
      object.userData = {
        carShowroom: receiver !== 'car' && receiver !== 'cabin',
        showroomId: receiver === 'floor-local' ? 'floor' : receiver,
        bakedFloorReflection: receiver === 'floor-local',
        bakedFloorLocalLight: receiver === 'floor-local',
      }
      if (receiver === 'cabin') {
        const material = new MeshPhysicalMaterial()
        material.name = 'Reventon / fixed / 18661'
        material.userData.source_vpb_material_id = 18661
        for (const old of Array.isArray(object.material) ? object.material : [object.material])
          old.dispose()
        object.material = material
        object.userData.carStudioCabinLighting = 'local'
      }
      model.directRectArea = native
      const builder = {
        object,
        material: object.material,
        context: { lightingModel: model, reflectedLight: input.reflectedLight },
        lightsNode: new LightsNode(),
      } as unknown as NodeBuilder
      const data = vi.spyOn(node, 'setupDirectRectArea').mockReturnValue(input)
      try {
        node.setup(builder)
        const actual = native.mock.calls[0]![0].reflectedLight.directSpecular
        expect(actual === input.reflectedLight.directSpecular).toBe(
          receiver === 'wall' || receiver === 'floor-local' || receiver === 'cabin',
        )
        expect(model.directRectArea).toBe(native)
      } finally {
        data.mockRestore()
        object.geometry.dispose()
        for (const material of Array.isArray(object.material) ? object.material : [object.material])
          material.dispose()
      }
    },
  )
  it('registers distinct local key/fill constructors without replacing ordinary lights or another renderer', () => {
    const f = fixture(),
      second = fixture()
    const key = createShowroomAreaLight(f.renderer, coldStudioConfig.lights.key),
      fill = createShowroomAreaLight(f.renderer, coldStudioConfig.lights.strip),
      repeated = createShowroomAreaLight(f.renderer, coldStudioConfig.lights.key)
    expect(key).toBeInstanceOf(CarKeyAreaLight)
    expect(fill).toBeInstanceOf(RectAreaLight)
    expect(fill).not.toBeInstanceOf(CarKeyAreaLight)
    expect(repeated.constructor).toBe(key.constructor)
    expect(key.constructor).not.toBe(fill.constructor)
    expect(f.addLight).toHaveBeenCalledTimes(2)
    expect(f.mappings.get(RectAreaLight)).toBe(f.ordinary)
    expect(second.mappings.size).toBe(1)
    expect(second.addLight).not.toHaveBeenCalled()
  })

  it('shares the configured panel transform, neutral color and exact dimensions', () => {
    const light = new RectAreaLight('#ff0000', 1, 1, 1),
      profile = coldStudioConfig.lights.key
    expect(configureShowroomLight(light, profile)).toBe(light)
    expect(light.position.toArray()).toEqual(profile.position)
    expect(light.color.toArray()).toEqual([1, 1, 1])
    expect([light.width, light.height, light.intensity]).toEqual([
      profile.width,
      profile.height,
      profile.intensity,
    ])
    expect(light.userData).toMatchObject({ carShowroomLight: 'key', diffuseOnly: true })
    const expected = new RectAreaLight()
    expected.position.fromArray(profile.position)
    expected.lookAt(...profile.target)
    expect(light.quaternion.toArray()).toEqual(expected.quaternion.toArray())
  })

  it('fails explicitly for missing or conflicting renderer-local library contracts', () => {
    expect(() =>
      createShowroomAreaLight(
        { library: {} } as unknown as WebGPURenderer,
        coldStudioConfig.lights.key,
      ),
    ).toThrow('library contract')
    const f = fixture()
    createShowroomAreaLight(f.renderer, coldStudioConfig.lights.key)
    const type = f.addLight.mock.calls[0]![1]
    f.mappings.set(type, class ConflictingNode {})
    expect(() => createShowroomAreaLight(f.renderer, coldStudioConfig.lights.key)).toThrow(
      'library contract',
    )
  })

  it.each(['key', 'strip'] as const)(
    '%s native light setup accepts Basic capture/prewarm shading without a Physical coat sink',
    (id) => {
      const f = fixture(),
        light = createShowroomAreaLight(f.renderer, coldStudioConfig.lights[id]),
        registered = f.mappings.get(light.constructor)
      expect(typeof registered).toBe('function')
      const NodeClass = registered as new (value: RectAreaLight) => RectAreaLightNode,
        node = new NodeClass(light),
        input = inputs(),
        directRectArea = vi.fn(),
        basicModel = { directRectArea },
        builder = {
          context: { lightingModel: basicModel, reflectedLight: input.reflectedLight },
          lightsNode: new LightsNode(),
        } as unknown as NodeBuilder
      // Only the LTC texture lookup is replaced. The registered showroom setup,
      // native AnalyticLightNode setup and native LightsNode dispatch all run.
      const data = vi.spyOn(node, 'setupDirectRectArea').mockReturnValue(input)
      try {
        expect(() => node.setup(builder)).not.toThrow()
        expect(directRectArea).toHaveBeenCalledExactlyOnceWith(
          { ...input, lightNode: node, reflectedLight: input.reflectedLight },
          builder,
        )
        expect(basicModel.directRectArea).toBe(directRectArea)
        expect('clearcoatSpecularDirect' in basicModel).toBe(false)
        expect(basicModel).not.toBeInstanceOf(PhysicalLightingModel)
      } finally {
        data.mockRestore()
      }
    },
  )

  it('keeps the real diffuse accumulator while routing base/coat specular into disposable sinks', () => {
    const model = new PhysicalLightingModel(true),
      input = inputs(),
      coat = vec3(0.4).toVar(),
      unrelatedModel = new PhysicalLightingModel(true),
      builder = {} as NodeBuilder
    model.clearcoatSpecularDirect = coat
    const native = vi.fn<PhysicalLightingModel['directRectArea']>((received, currentBuilder) => {
      expect(currentBuilder).toBe(builder)
      expect(received.reflectedLight.directDiffuse).toBe(input.reflectedLight.directDiffuse)
      expect(received.reflectedLight.indirectDiffuse).toBe(input.reflectedLight.indirectDiffuse)
      expect(received.reflectedLight.indirectSpecular).toBe(input.reflectedLight.indirectSpecular)
      expect(received.reflectedLight.directSpecular).not.toBe(input.reflectedLight.directSpecular)
      expect(model.clearcoatSpecularDirect).not.toBe(coat)
      expect(received.lightColor).toBe(input.lightColor)
    })
    model.directRectArea = native
    const unrelated = unrelatedModel.directRectArea,
      prototype = PhysicalLightingModel.prototype.directRectArea
    const result = withDiffuseAreaLight(model, () => {
      expect(model.directRectArea).not.toBe(native)
      model.directRectArea(input, builder)
      return 'completed'
    })
    expect(result).toBe('completed')
    expect(native).toHaveBeenCalledOnce()
    expect(model.directRectArea).toBe(native)
    expect(model.clearcoatSpecularDirect).toBe(coat)
    expect(unrelatedModel.directRectArea).toBe(unrelated)
    expect(PhysicalLightingModel.prototype.directRectArea).toBe(prototype)
  })

  it('restores both the instance method and original coat sink when native shading throws', () => {
    const model = new PhysicalLightingModel(true),
      input = inputs(),
      coat = vec3(0.6).toVar()
    model.clearcoatSpecularDirect = coat
    const native = vi.fn<PhysicalLightingModel['directRectArea']>(() => {
      throw new Error('native build rejected')
    })
    model.directRectArea = native
    expect(() =>
      withDiffuseAreaLight(model, () => model.directRectArea(input, {} as NodeBuilder)),
    ).toThrow('native build rejected')
    expect(model.directRectArea).toBe(native)
    expect(model.clearcoatSpecularDirect).toBe(coat)
    expect(() =>
      withDiffuseAreaLight(model, () => {
        throw new Error('outer build rejected')
      }),
    ).toThrow('outer build rejected')
    expect(model.directRectArea).toBe(native)
    expect(model.clearcoatSpecularDirect).toBe(coat)
  })

  it('keeps a material without clearcoat null rather than creating a persistent coat contribution', () => {
    const model = new PhysicalLightingModel(false),
      input = inputs(),
      native = vi.fn<PhysicalLightingModel['directRectArea']>(() => {
        expect(model.clearcoatSpecularDirect).toBeNull()
      })
    model.directRectArea = native
    withDiffuseAreaLight(model, () => model.directRectArea(input, {} as NodeBuilder))
    expect(model.clearcoatSpecularDirect).toBeNull()
    expect(model.directRectArea).toBe(native)
  })
})

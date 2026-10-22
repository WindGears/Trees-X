import { Mesh, RectAreaLight, REVISION, type Object3D } from 'three'
import {
  RectAreaLightNode,
  type Node,
  type NodeBuilder,
  type TextureNode,
  type WebGPURenderer,
} from 'three/webgpu'
import {
  Fn,
  cameraProjectionMatrixInverse,
  float,
  getViewPosition,
  positionView,
  screenUV,
} from 'three/tsl'

export interface CarShadowBinding {
  visibility: TextureNode
  depth: TextureNode
}
export class CarKeyAreaLight extends RectAreaLight {}

export function isCarShadowReceiver(object: Object3D, material: object) {
  if (
    !(object instanceof Mesh) ||
    Reflect.get(material, 'transparent') === true ||
    Number(Reflect.get(material, 'opacity') ?? 1) < 1 ||
    Number(Reflect.get(material, 'transmission') ?? 0) > 0 ||
    Number(Reflect.get(material, 'alphaTest') ?? 0) > 0 ||
    Reflect.get(material, 'alphaMap')
  )
    return false
  let parent: Object3D | null = object
  while (parent) {
    if (parent.userData.adapter === 'reventon-v1' && parent.userData.carStudioQuality === 'studio')
      return true
    parent = parent.parent
  }
  return false
}

type RectDirect = NonNullable<ReturnType<RectAreaLightNode['setupDirectRectArea']>>
class CarKeyAreaLightNode extends RectAreaLightNode {
  setupDirectRectArea(builder: NodeBuilder) {
    const method: unknown = Reflect.get(RectAreaLightNode.prototype, 'setupDirectRectArea')
    if (REVISION !== '185' || typeof method !== 'function')
      throw new Error('Car area shadow requires audited Three r185')
    const direct = method.call(this, builder) as RectDirect
    const current = builder.context && typeof builder.context === 'object' ? builder.context : {}
    const value: unknown = Reflect.get(current, 'treesCarKeyShadow')
    if (
      Reflect.get(current, 'treesCarKeyShadowPass') !== 'beauty' ||
      !value ||
      !isCarShadowReceiver(builder.object, builder.material)
    )
      return direct
    const binding = value as CarShadowBinding
    const visibility = Fn(() => {
      const z = binding.depth.sample(screenUV).r,
        surface = getViewPosition(screenUV, z, cameraProjectionMatrixInverse),
        tolerance = positionView.z.abs().mul(0.0002).max(0.0005),
        matches = z.lessThan(1).and(surface.z.sub(positionView.z).abs().lessThanEqual(tolerance))
      return matches.select(binding.visibility.sample(screenUV).r.clamp(0, 1), float(1))
    })()
    // One scalar visibility modulates only this light's LTC direct terms,
    // including native coat. This is an area-shadow approximation, not a BRDF integral.
    return { ...direct, lightColor: (direct.lightColor as Node<'vec3'>).mul(visibility) }
  }
}

/** Renderer-local registration of a distinct constructor, never ordinary RectAreaLight. */
export function createCarKeyAreaLight(renderer: WebGPURenderer) {
  const library = renderer.library
  const get: unknown = Reflect.get(library, 'getLightNodeClass'),
    add: unknown = Reflect.get(library, 'addLight')
  if (REVISION !== '185' || typeof get !== 'function' || typeof add !== 'function')
    throw new Error('Car key light library contract changed')
  const registered: unknown = get.call(library, CarKeyAreaLight)
  if (registered && registered !== CarKeyAreaLightNode)
    throw new Error('Car key light mapping is already owned')
  if (!registered) add.call(library, CarKeyAreaLightNode, CarKeyAreaLight)
  return new CarKeyAreaLight('#ffffff', 7, 6, 3)
}

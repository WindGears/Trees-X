import { RectAreaLight, REVISION } from 'three'
import {
  PhysicalLightingModel,
  RectAreaLightNode,
  type NodeBuilder,
  type WebGPURenderer,
} from 'three/webgpu'
import { vec3 } from 'three/tsl'
import { CarKeyAreaLight, CarKeyAreaLightNode } from '../realtime/carShadow/light'
import type { CarShowroomLight } from './config'

class ShowroomKeyLight extends CarKeyAreaLight {}
class ShowroomFillLight extends RectAreaLight {}

/** Scope the native LTC evaluation to this light, on this build's lighting model.
 * Panels already supply specular radiance through the room probe. Discard only
 * this light's specular accumulators, preserving native diffuse and key visibility.
 * No shared prototype or material parameters are changed.
 */
export function withDiffuseAreaLight<T>(model: PhysicalLightingModel, evaluate: () => T): T {
  const method = model.directRectArea
  model.directRectArea = function (input, builder) {
    const coat = this.clearcoatSpecularDirect
    try {
      if (coat) this.clearcoatSpecularDirect = vec3(0).toVar()
      method.call(
        this,
        {
          ...input,
          reflectedLight: { ...input.reflectedLight, directSpecular: vec3(0).toVar() },
        },
        builder,
      )
    } finally {
      this.clearcoatSpecularDirect = coat
    }
  }
  try {
    return evaluate()
  } finally {
    model.directRectArea = method
  }
}

class ShowroomAreaLightNode extends RectAreaLightNode {
  override setupDirectRectArea(builder: NodeBuilder) {
    return this.light instanceof ShowroomKeyLight
      ? CarKeyAreaLightNode.prototype.setupDirectRectArea.call(this, builder)
      : super.setupDirectRectArea(builder)
  }
  override setup(builder: NodeBuilder) {
    const context = builder.context && typeof builder.context === 'object' ? builder.context : {}
    const model: unknown = Reflect.get(context, 'lightingModel')
    if (REVISION !== '185') throw new Error('Cold studio requires audited r185 lighting')
    // Shadow/depth and Basic passes do not use a Physical lighting model. They
    // must not fail while the same room is captured or the host prewarms them.
    if (
      !model ||
      typeof model !== 'object' ||
      typeof Reflect.get(model, 'directRectArea') !== 'function' ||
      !('clearcoatSpecularDirect' in model)
    )
      return super.setup(builder)
    return withDiffuseAreaLight(model as PhysicalLightingModel, () => super.setup(builder))
  }
}

export function configureShowroomLight(light: RectAreaLight, config: CarShowroomLight) {
  light.color.set(config.color)
  light.intensity = config.intensity
  light.width = config.width
  light.height = config.height
  light.position.fromArray(config.position)
  light.lookAt(config.target[0], config.target[1], config.target[2])
  light.userData.carShowroomLight = config.id
  light.userData.diffuseOnly = true
  light.updateMatrixWorld(true)
  return light
}

/** Register distinct constructors in this renderer only; ordinary lights stay native. */
export function createShowroomAreaLight(renderer: WebGPURenderer, config: CarShowroomLight) {
  const type = config.id === 'key' ? ShowroomKeyLight : ShowroomFillLight,
    library = renderer.library,
    get: unknown = Reflect.get(library, 'getLightNodeClass'),
    add: unknown = Reflect.get(library, 'addLight')
  if (REVISION !== '185' || typeof get !== 'function' || typeof add !== 'function')
    throw new Error('Cold studio area-light library contract changed')
  const registered: unknown = get.call(library, type)
  if (registered && registered !== ShowroomAreaLightNode)
    throw new Error('Cold studio area-light library contract changed')
  if (!registered) add.call(library, ShowroomAreaLightNode, type)
  return configureShowroomLight(new type(), config)
}

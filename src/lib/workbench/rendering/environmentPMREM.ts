import { REVISION, type Texture } from 'three'
import { EnvironmentNode, PMREMNode, type WebGPURenderer } from 'three/webgpu'

const cacheReader = new EnvironmentNode()

function releasePmremNode(node: unknown) {
  if (node === undefined) return
  if (!(node instanceof PMREMNode)) throw new Error('Three r185 环境缓存未返回受检 PMREMNode')
  const generator: unknown = Reflect.get(node, '_generator')
  if (
    generator !== null &&
    (typeof generator !== 'object' || typeof Reflect.get(generator, 'dispose') !== 'function')
  )
    throw new Error('Three r185 环境 PMREMGenerator 释放接口不兼容')
  // The node owns its generator's LOD geometry/materials and ping-pong target.
  // None of these resources belong to the product loader.
  node.dispose()
}

/** Checked r185 bridge: native texture disposal omits the PMREM node's generator. */
export function ownEnvironmentPmrem(renderer: WebGPURenderer, texture: Texture) {
  if (REVISION !== '185') throw new Error('环境 PMREM 生命周期桥仅支持已核查的 Three r185')
  const method: unknown = Reflect.get(EnvironmentNode.prototype, '_getPMREMNodeCache')
  if (typeof method !== 'function') throw new Error('Three r185 环境 PMREM 缓存接口不兼容')
  const result: unknown = Reflect.apply(method, cacheReader, [renderer])
  if (!(result instanceof WeakMap)) throw new Error('Three r185 环境 PMREM 缓存形状不兼容')
  const cache = result as WeakMap<Texture, unknown>
  let disposed = false

  return {
    texture,
    dispose() {
      if (disposed) return
      disposed = true
      const node = cache.get(texture)
      try {
        // Native PMREMNode's source-texture listener owns its filtered output
        // target. Trigger that owner first; never dispose the output twice.
        texture.dispose()
      } finally {
        try {
          releasePmremNode(node)
        } finally {
          cache.delete(texture)
        }
      }
    },
  }
}

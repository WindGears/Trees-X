import type { Mesh } from 'three'
import type { CarShadowBinding } from './geometry'

/** TLAS reorders objects spatially. A GPU objectIndex is a transform slot, never
 * an index into the input Mesh array. Read the pinned packer's actual map. */
export function carQuerySources(
  data: object,
  bindings: readonly CarShadowBinding[],
): Map<number, Mesh> {
  const getMap: unknown = Reflect.get(data, '_getTransformMap')
  const bvh: unknown = Reflect.get(data, 'bvh')
  if (typeof getMap !== 'function' || !bvh)
    throw new Error('Car scene query transform map unavailable')
  const entries: unknown = getMap.call(data, bvh)
  if (!(entries instanceof Map)) throw new Error('Car scene query transform map changed')
  const sources = new Map(bindings.map((binding) => [binding.proxy, binding.source]))
  const result = new Map<number, Mesh>()
  for (const value of entries.values()) {
    if (!value || typeof value !== 'object')
      throw new Error('Car scene query transform entry changed')
    const entry = value as {
      slot?: unknown
      object?: unknown
      instanceId?: unknown
      root?: unknown
    }
    const source = sources.get(entry.object as CarShadowBinding['proxy'])
    if (
      typeof entry.slot !== 'number' ||
      !Number.isInteger(entry.slot) ||
      entry.slot < 0 ||
      !source ||
      entry.instanceId !== 0 ||
      entry.root !== 0 ||
      result.has(entry.slot)
    ) {
      throw new Error('Car scene query requires one verified transform slot per rigid source')
    }
    result.set(entry.slot, source)
  }
  if (result.size !== bindings.length || new Set(result.values()).size !== bindings.length) {
    throw new Error('Car scene query transform map is incomplete')
  }
  return result
}

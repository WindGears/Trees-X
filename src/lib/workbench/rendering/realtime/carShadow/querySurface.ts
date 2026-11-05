import type { Node, StorageBufferNode } from 'three/webgpu'
import { vec3, vec4, uint, transpose, max, mat4 } from 'three/tsl'
import type { CarSceneHit } from './nearestHit'

// 0.9.16 packs each member as four Float32 values regardless of declared type.
// Keep every member vec4f; integer slot/flags are exact small floats, converted on GPU.
export const carSurfaceLayout = {
  position: 'vec4f',
  normal: 'vec4f',
  tangent: 'vec4f',
  queryUv: 'vec4f',
  queryMeta: 'vec4f',
}
export interface CarQuerySurface {
  position: Node<'vec3'>
  normal: Node<'vec3'>
  localTangent: Node<'vec4'>
  uv: Node<'vec2'>
  uv1: Node<'vec2'>
  materialSlot: Node<'uint'>
  flags: Node<'uint'>
  bevelWeight: Node<'float'>
}

function checkedStorage(value: unknown): StorageBufferNode<'vec4'> {
  if (!value || (typeof value !== 'object' && typeof value !== 'function'))
    throw new Error('Car query storage missing')
  const node: unknown = Reflect.get(value, 'proxyNode')
  if (!node || typeof node !== 'object' || Reflect.get(node, 'isStorageBufferNode') !== true) {
    throw new Error('Car query storage layout changed')
  }
  return node as StorageBufferNode<'vec4'>
}

/** Borrow storage from the single BVH owner. No new targets, buffers or sampler loop. */
export function carHitSurface(storage: Record<string, unknown>, hit: CarSceneHit): CarQuerySurface {
  const attributes = checkedStorage(storage.attributes),
    transforms = checkedStorage(storage.transforms)
  const a = attributes.element(hit.indices.x),
    b = attributes.element(hit.indices.y),
    c = attributes.element(hit.indices.z)
  const interpolate = (name: string) =>
    vec4(a.get(name) as Node<'vec4'>)
      .mul(hit.barycentric.x)
      .add(vec4(b.get(name) as Node<'vec4'>).mul(hit.barycentric.y))
      .add(vec4(c.get(name) as Node<'vec4'>).mul(hit.barycentric.z))
  const transform = transforms.element(hit.objectIndex)
  const world = mat4(transform.get('matrixWorld') as Node<'mat4'>)
  const inverse = mat4(transform.get('inverseMatrixWorld') as Node<'mat4'>)
  const localNormal = interpolate('normal').xyz
  const transformedNormal = transpose(inverse).mul(vec4(localNormal, 0)).xyz.mul(hit.side)
  const lengthSquared = transformedNormal.dot(transformedNormal)
  const normalized = transformedNormal.div(max(lengthSquared, 1e-20).sqrt())
  const uv = interpolate('queryUv')
  const metadata = vec4(a.get('queryMeta') as Node<'vec4'>)
  return {
    position: world.mul(vec4(interpolate('position').xyz, 1)).xyz,
    normal: lengthSquared.greaterThan(1e-16).select(normalized, vec3(hit.normal)),
    localTangent: interpolate('tangent'),
    uv: uv.xy,
    uv1: uv.zw,
    materialSlot: uint(metadata.x),
    flags: uint(metadata.y),
    bevelWeight: interpolate('queryMeta').z,
  }
}

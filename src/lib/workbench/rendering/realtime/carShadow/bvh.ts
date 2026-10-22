import { REVISION } from 'three'
import type { Object3D } from 'three'
import { Node, StructNode, type NodeBuilder, type StructTypeNode } from 'three/webgpu'
import { Fn, nodeObject } from 'three/tsl'
import * as BvhWebGPU from 'three-mesh-bvh/webgpu'
import { buildCarShadowBlas } from './bvhWorker'
import { carShadowSourceVisible, collectCarShadowGeometry } from './geometry'

export interface CarShadowBvhSnapshot {
  meshes: number
  geometries: number
  triangles: number
  excludedMeshes: number
  transformUpdates: number
  buildMs: number
  storageBytes: number
  disposed: boolean
  tlasStrategy: 'one-leaf-per-rigid-mesh'
}

export interface CarShadowBvh {
  occluded(origin: Node<'vec3'>, direction: Node<'vec3'>, maxDistance: Node<'float'>): Node<'bool'>
  sync(): boolean
  snapshot(): CarShadowBvhSnapshot
  dispose(): void
}

interface ComputeData {
  update(): void
  updateTransforms(): void
  dispose(): void
  fns: { raycastFirstHit: unknown }
  storage: Record<string, unknown>
}

interface BvhRuntime {
  BVHComputeData: new (
    objects: Object3D[],
    options: { attributes: Record<string, string>; autogenerateBvh: boolean },
  ) => ComputeData
  rayStruct: StructTypeNode
  rayIntersectionResultStruct: StructTypeNode
}

// 0.9.16 ships runtime exports absent from its declarations. Keep this exact seam local.
function runtimeApi(): BvhRuntime {
  const api = BvhWebGPU as unknown as Partial<BvhRuntime>
  if (
    REVISION !== '185' ||
    typeof api.BVHComputeData !== 'function' ||
    !api.rayStruct?.isStructTypeNode ||
    !api.rayIntersectionResultStruct?.isStructTypeNode
  ) {
    throw new Error('Car key shadow requires Three r185 / three-mesh-bvh 0.9.16 WebGPU API')
  }
  return api as BvhRuntime
}

const RuntimeStruct = StructNode as unknown as new (
  type: StructTypeNode,
  values: Record<string, Node> | null,
) => Node<'vec3'>

/** 0.9.16 interpolates its pointer argument into a tagged signature. r185's
 * signature parser sees only the Ray parameter. Keep the actual two-argument
 * WGSL call explicit here; do not patch the dependency or its global parser. */
class OcclusionCall extends Node<'bool'> {
  constructor(
    private readonly traversal: Node,
    private readonly ray: Node,
    private readonly hitType: StructTypeNode,
  ) {
    super('bool')
  }

  generate(builder: NodeBuilder) {
    const name = this.traversal.build(builder, 'property')
    const ray = this.ray.build(builder),
      hit = `treesCarKeyHit_${this.id}`,
      type = this.hitType.getNodeType(builder)
    // WGSL zero-initializes a function-local structure. Unlike r185's global
    // toVar, this pointer has the exact function address space traversal needs.
    // Keep the upstream traversal's shared scratch variables at shader scope.
    const append: unknown = Reflect.get(builder, 'addLineFlowCode')
    if (typeof append !== 'function') throw new Error('Car shadow flow builder contract changed')
    append.call(builder, `var ${hit}: ${type}`, this)
    return `${name}( ${ray}, &${hit} )`
  }
}

/** BLAS belongs to derived geometries; GPU data and TLAS belong solely to this owner. */
export async function createCarShadowBvh(
  root: Object3D,
  signal: AbortSignal,
): Promise<CarShadowBvh> {
  signal.throwIfAborted()
  const api = runtimeApi()
  const started = performance.now()
  const geometrySet = collectCarShadowGeometry(root)
  const meshes = geometrySet.bindings.length
  const geometries = geometrySet.geometries.length
  let data: ComputeData | null = null
  let disposed = false
  let transformUpdates = 0
  let buildMs = 0
  let storageBytes = 0
  const dispose = () => {
    if (disposed) return
    disposed = true
    signal.removeEventListener('abort', dispose)
    try {
      data?.dispose()
    } finally {
      data = null
      geometrySet.geometries.forEach((geometry) => delete geometry.boundsTree)
      geometrySet.dispose()
    }
  }
  try {
    await buildCarShadowBlas(geometrySet.geometries, signal)
    signal.throwIfAborted()
    data = new api.BVHComputeData(
      geometrySet.bindings.map((binding) => binding.proxy),
      { attributes: { position: 'vec4f' }, autogenerateBvh: false },
    )
    if (
      typeof data.updateTransforms !== 'function' ||
      typeof data.dispose !== 'function' ||
      typeof data.fns.raycastFirstHit !== 'function'
    ) {
      throw new Error('Car key shadow BVH runtime shape changed')
    }
    // The car may have moved while the Worker built BLAS; build TLAS from the current pose.
    root.updateWorldMatrix(true, true)
    for (const binding of geometrySet.bindings) copyBinding(binding)
    data.update()
    storageBytes = countStorageBytes(data.storage)
    signal.throwIfAborted()
    buildMs = performance.now() - started
    signal.addEventListener('abort', dispose, { once: true })
    const traversal: unknown = Reflect.get(data.fns.raycastFirstHit as object, 'proxyNode')
    if (
      !traversal ||
      (typeof traversal !== 'object' && typeof traversal !== 'function') ||
      Reflect.get(traversal, 'isNode') !== true ||
      Reflect.get(traversal, 'isWGSLTagFnNode') !== true ||
      Reflect.get(traversal, 'functionName') !== 'bvh_RaycastFirstHit'
    ) {
      throw new Error('Car key shadow traversal signature changed')
    }
    return {
      occluded(origin, direction, maxDistance) {
        if (disposed) throw new Error('Car key shadow BVH has been disposed')
        return Fn(() => {
          const ray = nodeObject(
            new RuntimeStruct(api.rayStruct, { origin, direction, maxDist: maxDistance }),
          ).toVar()
          return nodeObject(
            new OcclusionCall(traversal as Node, ray, api.rayIntersectionResultStruct),
          )
        })()
      },
      sync() {
        if (disposed || !data) return false
        root.updateWorldMatrix(true, true)
        let changed = false
        for (const binding of geometrySet.bindings) {
          const visible = carShadowSourceVisible(binding.source)
          if (binding.visible !== visible || !binding.matrix.equals(binding.source.matrixWorld)) {
            copyBinding(binding)
            changed = true
          }
        }
        if (changed) {
          data.updateTransforms()
          transformUpdates += 1
        }
        return changed
      },
      snapshot: () => ({
        meshes,
        geometries,
        triangles: geometrySet.triangles,
        excludedMeshes: geometrySet.excludedMeshes,
        transformUpdates,
        buildMs,
        storageBytes,
        disposed,
        tlasStrategy: 'one-leaf-per-rigid-mesh',
      }),
      dispose,
    }
  } catch (error) {
    dispose()
    throw error
  }
}

function copyBinding(binding: ReturnType<typeof collectCarShadowGeometry>['bindings'][number]) {
  binding.matrix.copy(binding.source.matrixWorld)
  binding.proxy.matrix.copy(binding.matrix)
  binding.proxy.matrixWorld.copy(binding.matrix)
  binding.visible = carShadowSourceVisible(binding.source)
  binding.proxy.visible = binding.visible
}

function countStorageBytes(storage: Record<string, unknown>): number {
  let total = 0
  for (const key of ['nodes', 'transforms', 'index', 'attributes']) {
    const node = storage[key] as { value?: { array?: ArrayBufferView } } | undefined
    total += node?.value?.array?.byteLength ?? 0
  }
  return total
}

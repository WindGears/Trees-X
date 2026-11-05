import { Node, StructNode, type NodeBuilder, type StructTypeNode } from 'three/webgpu'
import { nodeObject } from 'three/tsl'

export interface CarSceneHit {
  didHit: Node<'bool'>
  distance: Node<'float'>
  normal: Node<'vec3'>
  barycentric: Node<'vec3'>
  objectIndex: Node<'uint'>
  /** xyz: packed vertex indices; w: packed triangle index, NOT loader indices. */
  indices: Node<'uvec4'>
  side: Node<'float'>
}

// r185 runtime accepts named members; @types still describes positional values.
const RuntimeStruct = StructNode as unknown as new (
  type: StructTypeNode,
  values: Record<string, Node> | null,
) => StructNode & { structTypeNode: StructTypeNode }

/** Keep the pointer in function address space. A single structure is shared by
 * all member reads, so reading distance + normal does not trace twice. */
class NearestHitCall extends RuntimeStruct {
  constructor(
    private readonly traversal: Node,
    private readonly ray: Node,
    hitType: StructTypeNode,
  ) {
    super(hitType, null)
  }

  override generate(builder: NodeBuilder) {
    const name = this.traversal.build(builder, 'property')
    const ray = this.ray.build(builder)
    const hit = `treesCarSceneHit_${this.id}`
    const type = this.structTypeNode.getNodeType(builder)
    const append: unknown = Reflect.get(builder, 'addLineFlowCode')
    if (typeof append !== 'function') throw new Error('Car scene query flow contract changed')
    append.call(builder, `var ${hit}: ${type}`, this)
    append.call(builder, `${name}( ${ray}, &${hit} )`, this)
    return hit
  }
}

export function carNearestHit(
  traversal: Node,
  rayType: StructTypeNode,
  hitType: StructTypeNode,
  origin: Node<'vec3'>,
  direction: Node<'vec3'>,
  maxDistance: Node<'float'>,
): CarSceneHit {
  const ray = nodeObject(new RuntimeStruct(rayType, { origin, direction, maxDist: maxDistance }))
  const hit = nodeObject(new NearestHitCall(traversal, ray, hitType))
  // Field names/types are checked against the pinned runtime layout on owner creation.
  return {
    didHit: hit.get('didHit') as Node<'bool'>,
    distance: hit.get('dist') as Node<'float'>,
    normal: hit.get('normal') as Node<'vec3'>,
    barycentric: hit.get('barycoord') as Node<'vec3'>,
    objectIndex: hit.get('objectIndex') as Node<'uint'>,
    indices: hit.get('indices') as Node<'uvec4'>,
    side: hit.get('side') as Node<'float'>,
  }
}

export function validateCarHitLayout(type: StructTypeNode) {
  const expected: Record<string, string> = {
    indices: 'vec4u',
    normal: 'vec3f',
    didHit: 'bool',
    barycoord: 'vec3f',
    objectIndex: 'uint',
    side: 'float',
    dist: 'float',
  }
  if (
    type.membersLayout.length !== Object.keys(expected).length ||
    type.membersLayout.some(({ name, type }) => expected[name] !== type)
  ) {
    throw new Error('Car scene query hit layout changed')
  }
}

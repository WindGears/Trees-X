import { describe, expect, it } from 'vitest'
import { DepthTexture, PerspectiveCamera, Texture, Vector2, Vector3, Vector4 } from 'three'
import { abs, float, texture, uniform, vec2, vec3, vec4 } from 'three/tsl'
import {
  createSignedReflectionSpatial,
  reflectionNeighborhoodCompatible,
  reflectionRayGuide,
  reflectionRayGuideContribution,
} from './signedSpatial'
import {
  ConditionalNode,
  ConstNode,
  ConvertNode,
  JoinNode,
  MathNode,
  Node,
  OperatorNode,
  SplitNode,
  VarNode,
} from 'three/webgpu'

/** Evaluate the actual production TSL arithmetic with constant shader inputs.
 * This tests geometric policy without a renderer or a duplicate CPU formula.
 */
const compatible = (plane: number, normal: number, roughness: number) =>
  evaluateNode(reflectionNeighborhoodCompatible(float(plane), float(normal), float(roughness)))

function guide(distances: readonly number[]) {
  let sum: Node<'vec2'> = vec2(0)
  for (const distance of distances) sum = sum.add(reflectionRayGuideContribution(float(distance)))
  return evaluateNode(reflectionRayGuide(sum))
}

describe('same-surface reflection neighborhoods', () => {
  it('accepts a slanted coplanar surface despite distinct camera depths', () => {
    const normal = new Vector3(0, 1, 1).normalize(),
      center = new Vector3(0, 0, -5),
      neighbor = new Vector3(0, 0.1, -5.1),
      plane = neighbor.sub(center).dot(normal) / Math.abs(center.z)
    expect(compatible(plane, 1, 0.01)).toBe(true)
    expect(compatible(-plane, 0.96, -0.01)).toBe(true)
  })

  it('rejects another depth plane, a surface edge or a different roughness region independently', () => {
    expect(compatible(0, 1, 0)).toBe(true)
    expect(compatible(0.01, 1, 0)).toBe(false)
    expect(compatible(-0.01, 1, 0)).toBe(false)
    expect(compatible(0, 0.9, 0)).toBe(false)
    expect(compatible(0, 1, 0.2)).toBe(false)
    expect(compatible(0, 1, -0.2)).toBe(false)
    // A neighboring supported pixel is insufficient on its own: geometric
    // discontinuities must not widen the current surface's history clamp.
    expect(compatible(0.00101, 1, 0)).toBe(false)
    expect(compatible(0, 0.949, 0)).toBe(false)
    expect(compatible(0, 1, 0.051)).toBe(false)
  })

  it('rejects non-finite guide comparisons rather than trusting their neighborhood bounds', () => {
    expect(compatible(Number.NaN, 1, 0)).toBe(false)
    expect(compatible(Infinity, 1, 0)).toBe(false)
    expect(compatible(0, Number.NaN, 0)).toBe(false)
    expect(compatible(0, 1, Number.NaN)).toBe(false)
  })
})

describe('bounded local reflection ray-distance guide', () => {
  it('keeps the same radius guide when only the center stochastic ray changes from hit to miss', () => {
    expect(guide([2, 2, 2, 2, 10000])).toBeCloseTo(2)
    expect(guide([10000, 2, 2, 2, 10000])).toBeCloseTo(2)
    expect(guide([0, 2, 2, 2, 10000])).toBeCloseTo(2)
  })

  it('uses a short-distance weighted mean bounded by valid hits, independent of invalid/miss counts', () => {
    const shortLong = guide([1, 9])
    if (typeof shortLong !== 'number') throw new Error('Expected scalar guide')
    expect(shortLong).toBeGreaterThanOrEqual(1)
    expect(shortLong).toBeLessThan(2)
    expect(guide([1, 9, 10000, 9999, 0])).toBe(shortLong)
    expect(guide([9, 1])).toBe(shortLong)
    expect(guide([1, 9, 1, 9])).toBeCloseTo(shortLong)
  })

  it('uses the old miss radius only when no positive finite screen-space hit exists', () => {
    expect(guide([10000, 0, -1, Infinity, Number.NaN])).toBe(0.25)
    expect(guide([0, 0, 0, 0, 0])).toBe(0.25)
    expect(guide([0.00001, 0, 10000])).toBe(0.001)
    expect(guide([0.25, 0.25, 0.25, 0.25, 0.25])).toBeCloseTo(0.25)
  })

  it('still has exactly two owned RTTs and retains the successful-frame sampling protocol', () => {
    const reflection = new Texture(),
      native = new Texture(),
      depth = new DepthTexture(),
      normal = new Texture(),
      owner = createSignedReflectionSpatial(
        texture(reflection),
        texture(native),
        texture(depth),
        texture(normal),
        new PerspectiveCamera(),
      ),
      targets = new Set([owner.raw.renderTarget, owner.node.renderTarget])
    expect(targets.size).toBe(2)
    expect(owner.raw.renderTarget).toBeDefined()
    expect(owner.node.renderTarget).toBeDefined()
    owner.prepare()
    const phase = owner.snapshot().phase
    owner.cancelFrame()
    owner.prepare()
    expect(owner.snapshot().phase).toBe(phase)
    owner.commitFrame()
    expect(owner.snapshot().frames).toBe(1)
    owner.dispose()
    for (const resource of [reflection, native, depth, normal]) resource.dispose()
  })
})

type Value = number | boolean | number[]

function scalar(value: Value): number {
  if (typeof value !== 'number') throw new Error('Oracle expected a numeric scalar')
  return value
}

function binary(a: Value, b: Value, operation: (x: number, y: number) => number): Value {
  if (!Array.isArray(a) && !Array.isArray(b)) return operation(scalar(a), scalar(b))
  const size = Array.isArray(a) ? a.length : (b as number[]).length
  if (Array.isArray(a) && Array.isArray(b) && a.length !== b.length)
    throw new Error('Oracle vector dimensions differ')
  return Array.from({ length: size }, (_, index) =>
    operation(Array.isArray(a) ? a[index]! : scalar(a), Array.isArray(b) ? b[index]! : scalar(b)),
  )
}

/** Evaluate only the constant arithmetic subset used by reflection guide tests.
 * This executes actual production TSL graphs, not a second implementation of
 * their formulas. It deliberately rejects textures, uniforms and mutable flow.
 * It does not validate GPU compilation, precision or rendered appearance.
 */
export function evaluateNode(node: unknown): Value {
  if (!(node instanceof Node)) throw new Error('Oracle expected a Three node')
  if (node instanceof VarNode) return evaluateNode(node.node)
  if (node instanceof ConvertNode) {
    const value = evaluateNode(node.node)
    if (node.convertTo === 'float') return scalar(value)
    const width = /^vec([234])$/.exec(node.convertTo)?.[1]
    if (!width) throw new Error('Oracle unsupported conversion ' + node.convertTo)
    if (!Array.isArray(value)) return Array.from({ length: Number(width) }, () => scalar(value))
    if (value.length !== Number(width)) throw new Error('Oracle unsupported vector conversion')
    return value
  }
  if (node instanceof ConstNode) {
    const value: unknown = node.value
    if (typeof value === 'number' || typeof value === 'boolean') return value
    if (value instanceof Vector2 || value instanceof Vector3 || value instanceof Vector4)
      return value.toArray()
    throw new Error('Oracle unsupported constant')
  }
  if (node instanceof JoinNode)
    return node.nodes.flatMap((part) => {
      const value = evaluateNode(part)
      return Array.isArray(value) ? value : [scalar(value)]
    })
  if (node instanceof SplitNode) {
    const value = evaluateNode(node.node)
    if (!Array.isArray(value)) throw new Error('Oracle expected a vector to swizzle')
    const parts = [...node.components].map((component) => {
      const index = 'xyzw'.indexOf(component)
      if (index < 0 || index >= value.length) throw new Error('Oracle unsupported swizzle')
      return value[index]!
    })
    return parts.length === 1 ? parts[0]! : parts
  }
  if (node instanceof ConditionalNode) {
    const condition = evaluateNode(node.condNode)
    if (typeof condition !== 'boolean') throw new Error('Oracle expected a boolean condition')
    return evaluateNode(condition ? node.ifNode : node.elseNode)
  }
  if (node instanceof OperatorNode) {
    const a = evaluateNode(node.aNode),
      b = evaluateNode(node.bNode)
    switch (node.op) {
      case '+':
        return binary(a, b, (x, y) => x + y)
      case '-':
        return binary(a, b, (x, y) => x - y)
      case '*':
        return binary(a, b, (x, y) => x * y)
      case '/':
        return binary(a, b, (x, y) => x / y)
      case '<':
        return scalar(a) < scalar(b)
      case '<=':
        return scalar(a) <= scalar(b)
      case '>':
        return scalar(a) > scalar(b)
      case '>=':
        return scalar(a) >= scalar(b)
      case '==':
        if (Array.isArray(a) || Array.isArray(b))
          throw new Error('Oracle unsupported vector equality')
        return a === b
      case '!=':
        if (Array.isArray(a) || Array.isArray(b))
          throw new Error('Oracle unsupported vector equality')
        return a !== b
      case '&&':
      case '||':
        if (typeof a !== 'boolean' || typeof b !== 'boolean')
          throw new Error('Oracle expected boolean operands')
        return node.op === '&&' ? a && b : a || b
      default:
        throw new Error('Oracle unsupported operator ' + node.op)
    }
  }
  if (node instanceof MathNode) {
    const a = evaluateNode(node.aNode)
    switch (node.method) {
      case 'abs':
        return binary(a, 0, (x) => Math.abs(x))
      case 'negate':
        return binary(a, 0, (x) => -x)
      case 'oneMinus':
        return binary(a, 0, (x) => 1 - x)
      case 'sqrt':
        return binary(a, 0, (x) => Math.sqrt(x))
      case 'min':
        return binary(a, evaluateNode(node.bNode), Math.min)
      case 'max':
        return binary(a, evaluateNode(node.bNode), Math.max)
      case 'dot': {
        const b = evaluateNode(node.bNode)
        if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length)
          throw new Error('Oracle expected matching dot vectors')
        return a.reduce((sum, value, index) => sum + value * b[index]!, 0)
      }
      default:
        throw new Error('Oracle unsupported math ' + node.method)
    }
  }
  throw new Error('Oracle unsupported node ' + node.constructor.name)
}

describe('constant reflection TSL graph oracle', () => {
  it('evaluates actual vector arithmetic, joins, swizzles, casts and scalar broadcasting', () => {
    const joined = vec4(vec2(float(2), float(3)), float(4), float(5))
    expect(evaluateNode(joined.xyz.add(1).mul(vec3(2, 3, 4)))).toEqual([6, 12, 20])
    expect(evaluateNode(abs(vec3(1, 2, 3).sub(vec3(2, 3, 5))).dot(vec3(2, 3, 4)))).toBe(13)
    expect(evaluateNode(float(joined.w).sub(1).div(2))).toBe(2)
  })

  it('evaluates boolean gates and selects signed numeric branches', () => {
    const gate = float(0.1).lessThanEqual(0.2).and(float(1).greaterThan(0.5))
    expect(evaluateNode(gate)).toBe(true)
    expect(evaluateNode(gate.select(float(-3).max(-2), float(8)))).toBe(-2)
    expect(evaluateNode(float(2).lessThan(1).select(vec2(1, 1), vec2(3, 0)))).toEqual([3, 0])
  })

  it('fails closed on unsupported graph nodes and operations', () => {
    expect(() => evaluateNode(uniform(1))).toThrow('unsupported node')
    expect(() => evaluateNode(float(1).sin())).toThrow('unsupported math sin')
    expect(() => evaluateNode(new ConvertNode(float(1), 'int'))).toThrow('unsupported conversion')
    expect(() => evaluateNode(null)).toThrow('expected a Three node')
  })
})

import {
  BufferAttribute,
  BufferGeometry,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InterleavedBuffer,
  InterleavedBufferAttribute,
  MeshPhysicalMaterial,
  Texture,
} from 'three'
import type { WebGPURenderer } from 'three/webgpu'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ownGeometryAttributes } from './geometryOwnership'

type Attribute = BufferAttribute | InterleavedBufferAttribute
type BufferData = { buffer?: { destroy(): void } }
interface NativeInfo {
  memory: Record<string, number>
  render: { calls: number }
  destroyAttribute(attribute: Attribute): void
}
interface NativeAttributes {
  data: WeakMap<object, unknown>
  backend: Backend
  info: NativeInfo
  update(attribute: Attribute, type: number): void
  delete(attribute: Attribute): unknown
}
interface RenderObject {
  geometry: BufferGeometry
  material: { wireframe?: boolean }
  getAttributes(): Attribute[]
}
interface NativeGeometries {
  attributes: NativeAttributes
  _geometryDisposeListeners: Map<BufferGeometry, () => void>
  initGeometry(object: RenderObject): void
  updateAttributes(object: RenderObject): void
  getIndex(object: RenderObject): Attribute | null
  updateForRender(object: RenderObject): void
}
interface Backend {
  get(resource: object): BufferData
  delete(resource: object): unknown
  createAttribute(attribute: Attribute): void
  createIndexAttribute(attribute: Attribute): void
  createStorageAttribute(attribute: Attribute): void
  createIndirectStorageAttribute(attribute: Attribute): void
  updateAttribute(attribute: Attribute): void
  destroyAttribute(attribute: Attribute): void
}

// These renderer-private modules have no upstream declarations. Keep their
// imports unknown and inspect the constructors; the actual implementations run
// below, with only GPU buffer creation replaced by deterministic test doubles.
async function nativeConstructor<T>(path: string) {
  const imported: unknown = await import(/* @vite-ignore */ path)
  const constructor: unknown =
    imported && typeof imported === 'object' ? Reflect.get(imported, 'default') : undefined
  if (typeof constructor !== 'function') throw new Error('Expected native r185 constructor')
  return constructor as new (...args: unknown[]) => T
}
const NativeInfo = await nativeConstructor<NativeInfo>('three/src/renderers/common/Info.js'),
  NativeAttributes = await nativeConstructor<NativeAttributes>(
    'three/src/renderers/common/Attributes.js',
  ),
  NativeGeometries = await nativeConstructor<NativeGeometries>(
    'three/src/renderers/common/Geometries.js',
  ),
  NativeAttributeUtils = await nativeConstructor<{ destroyAttribute(attribute: Attribute): void }>(
    'three/src/renderers/webgpu/utils/WebGPUAttributeUtils.js',
  )

const activeBridges: ReturnType<typeof ownGeometryAttributes>[] = []
afterEach(() => {
  activeBridges.splice(0).forEach((bridge) => bridge.dispose())
  vi.restoreAllMocks()
})

function fixture() {
  const data = new WeakMap<object, BufferData>(),
    destroyed = new Map<object, number>(),
    order: string[] = []
  const keyOf = (attribute: Attribute) =>
    attribute instanceof InterleavedBufferAttribute ? attribute.data : attribute
  const create = (attribute: Attribute) => {
    const key = keyOf(attribute),
      value = backend.get(key)
    value.buffer ??= {
      destroy() {
        destroyed.set(key, (destroyed.get(key) ?? 0) + 1)
        order.push('destroy:' + attribute.name)
      },
    }
  }
  const backend: Backend = {
    get(resource) {
      let value = data.get(resource)
      if (!value) data.set(resource, (value = {}))
      return value
    },
    delete: (resource) => data.delete(resource),
    createAttribute: create,
    createIndexAttribute: create,
    createStorageAttribute: create,
    createIndirectStorageAttribute: create,
    updateAttribute() {},
    destroyAttribute: (attribute) => utils.destroyAttribute(attribute),
  }
  const utils = new NativeAttributeUtils(backend),
    info = new NativeInfo(),
    attributes = new NativeAttributes(backend, info),
    manager = new NativeGeometries(attributes, info),
    renderer = { _geometries: manager } as unknown as WebGPURenderer
  const original = {
    init: manager.initGeometry,
    update: manager.updateAttributes,
    remove: attributes.delete,
  }
  const install = () => {
    const bridge = ownGeometryAttributes(renderer)
    activeBridges.push(bridge)
    return bridge
  }
  const render = (geometry: BufferGeometry, values: Attribute[]) => {
    info.render.calls++
    manager.updateForRender({ geometry, material: {}, getAttributes: () => values })
  }
  return { data, destroyed, order, info, attributes, manager, renderer, original, install, render }
}

function namedAttribute(name: string, values = [0, 0, 0, 1, 0, 0, 0, 1, 0]) {
  const attribute = new Float32BufferAttribute(values, 3)
  attribute.name = name
  return attribute
}

describe('r185 actual-render geometry attribute ownership', () => {
  it('reproduces the native first-RenderObject leak before installing the bridge', () => {
    const f = fixture(),
      position = namedAttribute('position'),
      normal = namedAttribute('normal'),
      nodeColor = new InstancedBufferAttribute(new Float32Array([1, 1, 1]), 3),
      geometry = new BufferGeometry().setAttribute('position', position)
    f.render(geometry, [position])
    f.render(geometry, [position, normal, nodeColor])
    geometry.dispose()
    expect(f.attributes.data.has(position)).toBe(false)
    expect(f.attributes.data.has(normal)).toBe(true)
    expect(f.attributes.data.has(nodeColor)).toBe(true)
    expect(f.info.memory.attributes).toBe(2)
    f.attributes.delete(normal)
    f.attributes.delete(nodeColor)
  })

  it('frees later MRT and instance-node attributes after native cleanup, exactly once', () => {
    const f = fixture(),
      position = namedAttribute('position'),
      normal = namedAttribute('normal'),
      nodeColor = new InstancedBufferAttribute(new Float32Array([1, 1, 1]), 3),
      unused = namedAttribute('unused'),
      geometry = new BufferGeometry()
        .setAttribute('position', position)
        .setAttribute('unused', unused)
    nodeColor.name = 'node-color'
    const geometryDispose = vi.spyOn(geometry, 'dispose')
    f.install()
    f.render(geometry, [position]) // Depth/shadow branch first.
    f.render(geometry, [position, normal, nodeColor]) // Full material/MRT later.
    const initialArrays = [position.array, normal.array, nodeColor.array]
    geometry.dispose()
    geometry.dispose()
    expect(f.order).toEqual(['destroy:position', 'destroy:normal', 'destroy:node-color'])
    for (const attribute of [position, normal, nodeColor]) {
      expect(f.destroyed.get(attribute)).toBe(1)
      expect(f.attributes.data.has(attribute)).toBe(false)
    }
    expect(f.destroyed.has(unused)).toBe(false)
    expect([position.array, normal.array, nodeColor.array]).toEqual(initialArrays)
    expect(f.info.memory.attributes).toBe(0)
    expect(f.info.memory.geometries).toBe(0)
    expect(geometryDispose).toHaveBeenCalledTimes(2) // Only the test's loader calls.
  })

  it('keeps shared attributes and interleaved backing alive until the last geometry disposes', () => {
    const f = fixture(),
      position = namedAttribute('shared-position'),
      data = new InterleavedBuffer(new Float32Array([0, 0, 0, 1, 1, 1]), 6),
      firstView = new InterleavedBufferAttribute(data, 3, 0),
      secondView = new InterleavedBufferAttribute(data, 3, 3),
      first = new BufferGeometry().setAttribute('position', position),
      second = new BufferGeometry().setAttribute('position', position)
    firstView.name = 'first-view'
    secondView.name = 'second-view'
    f.install()
    f.render(first, [position, firstView])
    f.render(second, [position, secondView])
    first.dispose()
    expect(f.destroyed.size).toBe(0)
    expect(f.attributes.data.has(position)).toBe(true)
    expect(f.data.get(data)?.buffer).toBeDefined()
    // Render the remaining owner: it must reuse a live buffer, not a destroyed one.
    f.render(second, [position, secondView])
    second.dispose()
    expect(f.destroyed.get(position)).toBe(1)
    expect(f.destroyed.get(data)).toBe(1)
    expect(f.info.memory.attributes).toBe(0)
    expect(f.attributes.data.has(firstView)).toBe(false)
    expect(f.attributes.data.has(secondView)).toBe(false)
    expect(f.data.has(data)).toBe(false)
  })

  it('deduplicates several interleaved views in one render and clears stale backing for reuse', () => {
    const f = fixture(),
      data = new InterleavedBuffer(new Float32Array([0, 0, 0, 0, 0, 1]), 6),
      position = new InterleavedBufferAttribute(data, 3, 0),
      normal = new InterleavedBufferAttribute(data, 3, 3),
      geometry = new BufferGeometry().setAttribute('position', position)
    f.install()
    f.render(geometry, [position, normal, position])
    geometry.dispose()
    expect(f.destroyed.get(data)).toBe(1)
    expect(f.info.memory.attributes).toBe(0)
    const next = new BufferGeometry().setAttribute('position', position)
    f.render(next, [position, normal])
    expect(f.data.get(data)?.buffer).toBeDefined()
    next.dispose()
    expect(f.destroyed.get(data)).toBe(2) // Two different allocations, each once.
    expect(f.info.memory.attributes).toBe(0)
  })

  it('can attach to an existing native geometry record and restores host hooks without freeing assets', () => {
    const f = fixture(),
      position = namedAttribute('position'),
      later = namedAttribute('later'),
      geometry = new BufferGeometry().setAttribute('position', position),
      material = new MeshPhysicalMaterial(),
      map = new Texture()
    material.map = map
    const sourceDispose = vi.spyOn(geometry, 'dispose'),
      materialDispose = vi.spyOn(material, 'dispose'),
      mapDispose = vi.spyOn(map, 'dispose')
    f.render(geometry, [position])
    const originalListener = f.manager._geometryDisposeListeners.get(geometry),
      bridge = f.install()
    f.render(geometry, [position, later])
    bridge.dispose()
    bridge.dispose()
    expect(f.manager.initGeometry).toBe(f.original.init)
    expect(f.manager.updateAttributes).toBe(f.original.update)
    expect(f.attributes.delete).toBe(f.original.remove)
    expect(f.manager._geometryDisposeListeners.get(geometry)).toBe(originalListener)
    expect(f.destroyed.size).toBe(0)
    expect(sourceDispose).not.toHaveBeenCalled()
    expect(materialDispose).not.toHaveBeenCalled()
    expect(mapDispose).not.toHaveBeenCalled()
    // The renderer/loader keep their native lifecycle after the host uninstalls.
    geometry.dispose()
    f.attributes.delete(later)
    material.dispose()
    map.dispose()
  })

  it('does not change deletion outside an actual geometry-disposal operation', () => {
    const f = fixture(),
      position = namedAttribute('position'),
      geometry = new BufferGeometry().setAttribute('position', position)
    f.install()
    f.render(geometry, [position])
    f.attributes.delete(position) // Native dynamic wireframe/cache replacement.
    expect(f.destroyed.get(position)).toBe(1)
    expect(f.info.memory.attributes).toBe(0)
    geometry.dispose()
    expect(f.destroyed.get(position)).toBe(1)
  })

  it('finishes omitted-attribute cleanup when a native release callback throws', () => {
    const f = fixture(),
      position = namedAttribute('position'),
      later = namedAttribute('later'),
      geometry = new BufferGeometry().setAttribute('position', position)
    f.render(geometry, [position])
    const native = f.manager._geometryDisposeListeners.get(geometry)!
    const injected = () => {
      native()
      f.order.push('native-complete')
      throw new Error('Injected release-listener failure')
    }
    geometry.removeEventListener('dispose', native)
    geometry.addEventListener('dispose', injected)
    f.manager._geometryDisposeListeners.set(geometry, injected)
    f.install()
    f.render(geometry, [position, later])
    expect(() => geometry.dispose()).toThrow('Injected release-listener failure')
    expect(f.order).toEqual(['destroy:position', 'native-complete', 'destroy:later'])
    expect(f.manager._geometryDisposeListeners.has(geometry)).toBe(false)
    expect(f.info.memory.attributes).toBe(0)
    expect(f.info.memory.geometries).toBe(0)
    expect(() => geometry.dispose()).not.toThrow()
  })

  it('rejects revisions, malformed private contracts and a duplicate owner before replacing hooks', () => {
    const f = fixture()
    expect(() => ownGeometryAttributes(f.renderer, '186')).toThrow('must be reviewed')
    expect(f.manager.updateAttributes).toBe(f.original.update)
    Reflect.set(f.attributes, 'data', new Map())
    expect(() => ownGeometryAttributes(f.renderer)).toThrow('backing contract changed')
    expect(f.manager.initGeometry).toBe(f.original.init)
    Reflect.set(f.attributes, 'data', new WeakMap())
    const first = f.install()
    expect(() => ownGeometryAttributes(f.renderer)).toThrow('already owns')
    first.dispose()
    expect(() => f.install()).not.toThrow()
  })
})

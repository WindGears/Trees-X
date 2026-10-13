import { BufferAttribute, BufferGeometry, InterleavedBufferAttribute, REVISION } from 'three'
import type { WebGPURenderer } from 'three/webgpu'

type Attribute = BufferAttribute | InterleavedBufferAttribute
type Backing = Attribute | InterleavedBufferAttribute['data']
interface RenderGeometry {
  geometry: BufferGeometry
  getAttributes(): Attribute[]
}
interface AttributeManager {
  data: WeakMap<object, unknown>
  delete(attribute: Attribute): unknown
  backend: { delete(resource: object): unknown }
  info: { destroyAttribute(attribute: Attribute): void }
}
interface GeometryManager {
  attributes: AttributeManager
  _geometryDisposeListeners: Map<BufferGeometry, () => void>
  initGeometry(object: RenderGeometry): void
  updateAttributes(object: RenderGeometry): void
  getIndex(object: RenderGeometry): Attribute | null
}
interface GeometryRecord {
  geometry: BufferGeometry
  nativeRelease: () => void
  release: () => void
  backings: Set<Backing>
}
interface BackingRecord {
  owners: Set<BufferGeometry>
  attributes: Set<Attribute>
}

const activeOwners = new WeakMap<object, object>()
const backingOf = (attribute: Attribute): Backing =>
  attribute instanceof InterleavedBufferAttribute ? attribute.data : attribute
const isObject = (value: unknown): value is object => value !== null && typeof value === 'object'
const hasFunction = (value: object, key: string) => typeof Reflect.get(value, key) === 'function'

function checkedManager(renderer: WebGPURenderer, revision: string): GeometryManager {
  if (revision !== '185')
    throw new Error('Geometry ownership must be reviewed for this Three revision')
  const value: unknown = Reflect.get(renderer, '_geometries')
  if (
    !isObject(value) ||
    !['initGeometry', 'updateAttributes', 'getIndex'].every((key) => hasFunction(value, key)) ||
    !(Reflect.get(value, '_geometryDisposeListeners') instanceof Map)
  )
    throw new Error('The inspected r185 geometry ownership contract changed')
  const attributes: unknown = Reflect.get(value, 'attributes')
  if (!isObject(attributes) || !hasFunction(attributes, 'delete'))
    throw new Error('The inspected r185 attribute ownership contract changed')
  const backend: unknown = Reflect.get(attributes, 'backend'),
    info: unknown = Reflect.get(attributes, 'info')
  if (
    !(Reflect.get(attributes, 'data') instanceof WeakMap) ||
    !isObject(backend) ||
    !hasFunction(backend, 'delete') ||
    !isObject(info) ||
    !hasFunction(info, 'destroyAttribute')
  )
    throw new Error('The inspected r185 attribute backing contract changed')
  return value as unknown as GeometryManager
}

/**
 * r185 only frees the attributes of the first RenderObject using a geometry.
 * Aggregate actual draws, including node-level instance attributes. The loader
 * still decides when geometry is disposed; this bridge only owns GPU cleanup.
 */
export function ownGeometryAttributes(renderer: WebGPURenderer, revision = REVISION) {
  const manager = checkedManager(renderer, revision),
    attributes = manager.attributes,
    token = {},
    records = new Map<BufferGeometry, GeometryRecord>(),
    backings = new Map<Backing, BackingRecord>(),
    nativeInit = manager.initGeometry,
    nativeUpdate = manager.updateAttributes,
    nativeDelete = attributes.delete
  if (activeOwners.has(manager)) throw new Error('This renderer already owns a geometry bridge')
  let disposed = false,
    releasing = 0

  function releaseBacking(backing: Backing, record: BackingRecord) {
    if (record.owners.size > 0) return
    // Attributes tracks each interleaved view, while the backend stores one GPU
    // buffer on .data. Destroy through one live view, then remove other views'
    // accounting/cache only. Calling native delete for every view destroys the
    // same backing repeatedly; deleting .data alone skips view accounting.
    let destroyed = false
    for (const attribute of record.attributes) {
      if (!attributes.data.has(attribute)) continue
      if (!destroyed) {
        nativeDelete.call(attributes, attribute)
        destroyed = true
      } else {
        attributes.data.delete(attribute)
        attributes.backend.delete(attribute)
        attributes.info.destroyAttribute(attribute)
      }
    }
    // Native WebGPUAttributeUtils deletes the view key, not its interleaved
    // backing key. Clear the stale destroyed-buffer entry for possible reuse.
    attributes.backend.delete(backing)
    backings.delete(backing)
  }

  function rememberGeometry(geometry: BufferGeometry) {
    let record = records.get(geometry)
    if (record) return record
    const nativeRelease = manager._geometryDisposeListeners.get(geometry)
    if (typeof nativeRelease !== 'function')
      throw new Error('The inspected r185 geometry dispose listener is missing')
    record = {
      geometry,
      nativeRelease,
      backings: new Set(),
      release: () => {
        const current = records.get(geometry)
        if (!current) return
        for (const backing of current.backings) backings.get(backing)?.owners.delete(geometry)
        releasing++
        try {
          current.nativeRelease()
        } finally {
          try {
            // Native cleanup remains first; then free attributes omitted from
            // its first RenderObject. Other living geometries retain backing.
            for (const backing of current.backings) {
              const entry = backings.get(backing)
              if (entry) releaseBacking(backing, entry)
            }
          } finally {
            releasing--
            geometry.removeEventListener('dispose', current.release)
            if (manager._geometryDisposeListeners.get(geometry) === current.release)
              manager._geometryDisposeListeners.delete(geometry)
            records.delete(geometry)
          }
        }
      },
    }
    geometry.removeEventListener('dispose', nativeRelease)
    geometry.addEventListener('dispose', record.release)
    manager._geometryDisposeListeners.set(geometry, record.release)
    records.set(geometry, record)
    return record
  }

  function remember(record: GeometryRecord, value: Attribute | null) {
    if (value === null) return
    if (!(value instanceof BufferAttribute || value instanceof InterleavedBufferAttribute))
      throw new Error('The inspected r185 geometry attribute type changed')
    const backing = backingOf(value)
    let entry = backings.get(backing)
    if (!entry) {
      entry = { owners: new Set(), attributes: new Set() }
      backings.set(backing, entry)
    }
    entry.owners.add(record.geometry)
    entry.attributes.add(value)
    record.backings.add(backing)
  }

  const init: GeometryManager['initGeometry'] = function (this: GeometryManager, object) {
    nativeInit.call(this, object)
    rememberGeometry(object.geometry)
  }
  const update: GeometryManager['updateAttributes'] = function (this: GeometryManager, object) {
    const record = rememberGeometry(object.geometry)
    for (const attribute of object.getAttributes()) remember(record, attribute)
    remember(record, manager.getIndex(object))
    remember(record, object.geometry.indirect)
    nativeUpdate.call(this, object)
  }
  const remove: AttributeManager['delete'] = function (this: AttributeManager, attribute) {
    const backing = backingOf(attribute),
      entry = backings.get(backing)
    if (releasing && entry) {
      if (entry.owners.size === 0) releaseBacking(backing, entry)
      return null
    }
    return nativeDelete.call(this, attribute)
  }
  manager.initGeometry = init
  manager.updateAttributes = update
  attributes.delete = remove
  activeOwners.set(manager, token)

  return {
    dispose() {
      if (disposed) return
      disposed = true
      if (manager.initGeometry === init) manager.initGeometry = nativeInit
      if (manager.updateAttributes === update) manager.updateAttributes = nativeUpdate
      if (attributes.delete === remove) attributes.delete = nativeDelete
      for (const record of records.values()) {
        if (manager._geometryDisposeListeners.get(record.geometry) !== record.release) continue
        record.geometry.removeEventListener('dispose', record.release)
        record.geometry.addEventListener('dispose', record.nativeRelease)
        manager._geometryDisposeListeners.set(record.geometry, record.nativeRelease)
      }
      records.clear()
      backings.clear()
      if (activeOwners.get(manager) === token) activeOwners.delete(manager)
      // Never dispose borrowed geometry or its attributes merely to uninstall
      // this bridge. The host's renderer disposal owns final remaining GPU data.
    },
  }
}

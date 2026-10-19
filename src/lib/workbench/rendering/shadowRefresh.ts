import { DirectionalLight, type DirectionalLightShadow, type Object3D } from 'three'

/** Allocated once per light; reading a frame does not allocate vectors or arrays. */
class ShadowSnapshot {
  private readonly values = new Float64Array(80)
  private index = 0
  private changed = false
  private initialized = false

  begin() {
    this.index = 0
    this.changed = !this.initialized
  }

  number(value: number) {
    if (!Object.is(this.values[this.index], value)) this.changed = true
    this.values[this.index++] = value
  }

  matrix(elements: readonly number[]) {
    for (let index = 0; index < 16; index++) this.number(elements[index]!)
  }

  finish() {
    this.initialized = true
    return this.changed
  }
}

interface ShadowEntry {
  light: DirectionalLight
  shadow: DirectionalLightShadow
  camera: DirectionalLightShadow['camera']
  autoUpdate: boolean
  parameters: ShadowSnapshot
  snapshot: ShadowSnapshot
  initialized: boolean
  seen: number
}

// A LightShadow has one refresh owner, even when two scene adapters overlap.
const owners = new WeakMap<DirectionalLightShadow, object>()

/**
 * Pose/light-driven native directional shadows, shared by WebGL and WebGPU.
 * r185 ShadowNode.updateBefore and WebGLShadowMap both consume each light's
 * needsUpdate || autoUpdate. Never change renderer.shadowMap's global flags.
 * Call beforeRender before any car pass; call markDirty for caster changes.
 */
export function createShadowRefresh(root: Object3D) {
  const token = {},
    entries: ShadowEntry[] = [],
    lookup = new Map<DirectionalLight, ShadowEntry>()
  let disposed = false,
    dirty = true,
    epoch = 0

  function release(entry: ShadowEntry) {
    if (owners.get(entry.shadow) !== token) return
    owners.delete(entry.shadow)
    entry.shadow.autoUpdate = entry.autoUpdate
    // Retain a pending refresh; teardown must not suppress an unrendered pose.
  }

  function acquire(light: DirectionalLight): ShadowEntry {
    if (owners.has(light.shadow)) throw new Error('Directional shadow already has a refresh owner')
    const entry: ShadowEntry = {
      light,
      shadow: light.shadow,
      camera: light.shadow.camera,
      autoUpdate: light.shadow.autoUpdate,
      parameters: new ShadowSnapshot(),
      snapshot: new ShadowSnapshot(),
      initialized: false,
      seen: epoch,
    }
    owners.set(entry.shadow, token)
    entry.shadow.autoUpdate = false
    entry.shadow.needsUpdate = true
    entries.push(entry)
    lookup.set(light, entry)
    return entry
  }

  function capture(entry: ShadowEntry) {
    const { light, shadow, parameters, snapshot } = entry,
      camera = shadow.camera,
      view = camera.view
    light.updateWorldMatrix(true, false)
    light.target.updateWorldMatrix(true, false)
    parameters.begin()
    parameters.number(camera.left)
    parameters.number(camera.right)
    parameters.number(camera.top)
    parameters.number(camera.bottom)
    parameters.number(camera.near)
    parameters.number(camera.far)
    parameters.number(camera.zoom)
    parameters.number(camera.coordinateSystem)
    parameters.number(Number(camera.reversedDepth))
    parameters.number(Number(view?.enabled ?? false))
    parameters.number(view?.fullWidth ?? 0)
    parameters.number(view?.fullHeight ?? 0)
    parameters.number(view?.offsetX ?? 0)
    parameters.number(view?.offsetY ?? 0)
    parameters.number(view?.width ?? 0)
    parameters.number(view?.height ?? 0)
    const parameterChanged = parameters.finish(),
      cameraChanged = entry.camera !== camera
    // Scalar edits must affect the actual projection. Preserve an explicitly
    // supplied projection matrix when the public camera parameters are stable.
    if (entry.initialized && (parameterChanged || cameraChanged)) camera.updateProjectionMatrix()
    snapshot.begin()
    snapshot.matrix(light.matrixWorld.elements)
    snapshot.matrix(light.target.matrixWorld.elements)
    snapshot.matrix(camera.projectionMatrix.elements)
    snapshot.number(camera.up.x)
    snapshot.number(camera.up.y)
    snapshot.number(camera.up.z)
    snapshot.number(camera.layers.mask)
    snapshot.number(light.layers.mask)
    snapshot.number(shadow.mapSize.x)
    snapshot.number(shadow.mapSize.y)
    snapshot.number(shadow.bias)
    snapshot.number(shadow.normalBias)
    snapshot.number(shadow.radius)
    snapshot.number(shadow.blurSamples)
    snapshot.number(shadow.intensity)
    snapshot.number(shadow.mapType)
    const changed = snapshot.finish()
    if (dirty || changed || parameterChanged || cameraChanged || shadow.autoUpdate)
      shadow.needsUpdate = true
    shadow.autoUpdate = false
    entry.camera = camera
    entry.initialized = true
    entry.seen = epoch
  }

  const visit = (object: Object3D) => {
    if (!(object instanceof DirectionalLight) || !object.castShadow) return
    let entry = lookup.get(object)
    if (entry && entry.shadow !== object.shadow) {
      release(entry)
      lookup.delete(object)
      entries.splice(entries.indexOf(entry), 1)
      entry = undefined
    }
    capture(entry ?? acquire(object))
  }

  return {
    markDirty() {
      if (!disposed) dirty = true
    },
    beforeRender() {
      if (disposed) return
      epoch++
      root.traverse(visit)
      for (let index = entries.length - 1; index >= 0; index--) {
        const entry = entries[index]!
        if (entry.seen === epoch) continue
        release(entry)
        lookup.delete(entry.light)
        entries.splice(index, 1)
      }
      // Native renderers clear each needsUpdate only after its shadow succeeds.
      // Retain pending native flags through auxiliary passes and render errors.
      dirty = false
    },
    dispose() {
      if (disposed) return
      disposed = true
      for (let index = 0; index < entries.length; index++) release(entries[index]!)
      entries.length = 0
      lookup.clear()
    },
  }
}

/* global window, navigator, document, performance */

/** Test-page-only interception. Install with addInitScript before application code.
 * Counts native API requests, NOT driver cache hits or GPU execution time.
 * No prototypes, render callbacks, drawing clocks or source WGSL are retained.
 */
export function installPipelineObservation(options = {}) {
  if (window.__carPipelineAudit) return
  const limit = Number.isSafeInteger(options.maxRecords)
      ? Math.min(5000, Math.max(1, options.maxRecords))
      : 5000,
    records = [],
    marks = [],
    patches = [],
    issues = [],
    counts = {},
    identities = new WeakMap(),
    patched = new WeakMap()
  let stopped = false,
    nextIdentity = 1,
    dropped = 0,
    pending = 0,
    stage = 'navigation'
  const now = () => performance.now(),
    short = (value) => (typeof value === 'string' ? value.slice(0, 256) : (value ?? null)),
    identity = (value) => {
      if (!value || (typeof value !== 'object' && typeof value !== 'function')) return null
      if (!identities.has(value)) identities.set(value, nextIdentity++)
      return identities.get(value)
    },
    freeze = (value) => {
      if (value && typeof value === 'object') {
        for (const child of Object.values(value)) freeze(child)
        Object.freeze(value)
      }
      return value
    },
    shaderStage = (value) =>
      value
        ? {
            module: identity(value.module),
            entryPoint: short(value.entryPoint),
            constants: Object.fromEntries(
              Object.entries(value.constants ?? {})
                .slice(0, 64)
                .map(([key, value]) => [short(key), value]),
            ),
          }
        : null,
    describe = (name, value = {}) => {
      const result = { label: short(value.label) }
      if (name === 'createShaderModule') return { ...result, codeUnits: value.code?.length ?? null }
      if (name.startsWith('createComputePipeline'))
        return {
          ...result,
          layout: value.layout === 'auto' ? 'auto' : identity(value.layout),
          compute: shaderStage(value.compute),
        }
      if (!name.startsWith('createRenderPipeline')) return result
      return {
        ...result,
        layout: value.layout === 'auto' ? 'auto' : identity(value.layout),
        vertex: shaderStage(value.vertex),
        buffers: (value.vertex?.buffers ?? []).map((buffer) =>
          buffer
            ? {
                arrayStride: buffer.arrayStride,
                stepMode: buffer.stepMode ?? 'vertex',
                attributes: [...buffer.attributes].map(({ shaderLocation, offset, format }) => ({
                  shaderLocation,
                  offset,
                  format,
                })),
              }
            : null,
        ),
        fragment: shaderStage(value.fragment),
        targets: (value.fragment?.targets ?? []).map((target) =>
          target
            ? {
                format: target.format,
                writeMask: target.writeMask ?? 15,
                blend: target.blend
                  ? { color: { ...target.blend.color }, alpha: { ...target.blend.alpha } }
                  : null,
              }
            : null,
        ),
        depthStencil: value.depthStencil
          ? {
              ...value.depthStencil,
              stencilFront: { ...value.depthStencil.stencilFront },
              stencilBack: { ...value.depthStencil.stencilBack },
            }
          : null,
        primitive: {
          topology: 'triangle-list',
          frontFace: 'ccw',
          cullMode: 'none',
          ...value.primitive,
        },
        multisample: {
          count: 1,
          mask: 4294967295,
          alphaToCoverageEnabled: false,
          ...value.multisample,
        },
      }
    },
    context = () => {
      const root = document.querySelector('.workbench'),
        element = document.querySelector('.wb-stage')
      return {
        stage,
        status: root?.dataset.status ?? null,
        sceneStatus: element?.dataset.sceneStatus ?? null,
        lightingPhase: element?.dataset.lightingPhase ?? null,
      }
    },
    note = (message) => {
      if (issues.length < 32) issues.push(String(message).slice(0, 512))
    },
    patch = (owner, name, make) => {
      if (stopped || !owner || typeof owner[name] !== 'function') return
      if (patched.get(owner)?.has(name)) return
      const original = owner[name],
        own = Object.getOwnPropertyDescriptor(owner, name),
        wrapper = make(original)
      try {
        Object.defineProperty(owner, name, { configurable: true, writable: true, value: wrapper })
        patches.push({ owner, name, own, wrapper })
        if (!patched.has(owner)) patched.set(owner, new Set())
        patched.get(owner).add(name)
      } catch (error) {
        note(`${name}: ${error}`)
      }
    },
    observe = (owner, name) =>
      patch(
        owner,
        name,
        (original) =>
          function (...args) {
            if (stopped) return Reflect.apply(original, this, args)
            const observedAtMs = now()
            counts[name] = (counts[name] ?? 0) + 1
            let record
            try {
              if (records.length < limit) {
                record = {
                  id: records.length + 1,
                  device: identity(owner),
                  method: name,
                  ...context(),
                  observedAtMs,
                  descriptor: freeze(JSON.parse(JSON.stringify(describe(name, args[0])))),
                  callMs: null,
                  settledAtMs: null,
                  elapsedMs: null,
                  status: 'calling',
                }
                records.push(record)
              } else dropped++
            } catch (error) {
              note(error)
            }
            const startedAtMs = now()
            if (record)
              Object.assign(record, { startedAtMs, metadataMs: startedAtMs - observedAtMs })
            let result
            try {
              result = Reflect.apply(original, this, args)
            } catch (error) {
              if (record)
                Object.assign(record, {
                  callMs: now() - startedAtMs,
                  status: 'threw',
                  error: String(error).slice(0, 512),
                })
              throw error
            }
            const returnedAtMs = now()
            if (record) record.callMs = returnedAtMs - startedAtMs
            if (name.endsWith('Async')) {
              pending++
              if (record) record.status = 'pending'
              result.then(
                () => {
                  pending--
                  if (record)
                    Object.assign(record, {
                      status: 'resolved',
                      settledAtMs: now(),
                      elapsedMs: now() - startedAtMs,
                    })
                },
                (error) => {
                  pending--
                  if (record)
                    Object.assign(record, {
                      status: 'rejected',
                      settledAtMs: now(),
                      elapsedMs: now() - startedAtMs,
                      error: String(error).slice(0, 512),
                    })
                },
              )
            } else if (record)
              Object.assign(record, {
                status: 'returned',
                settledAtMs: returnedAtMs,
                elapsedMs: returnedAtMs - startedAtMs,
              })
            return result
          },
      ),
    device = (value) => {
      for (const name of [
        'createShaderModule',
        'createRenderPipeline',
        'createRenderPipelineAsync',
        'createComputePipeline',
        'createComputePipelineAsync',
      ])
        observe(value, name)
    },
    factory = (owner, name, accept) =>
      patch(
        owner,
        name,
        (original) =>
          function (...args) {
            const result = Reflect.apply(original, this, args)
            result.then(
              (value) => {
                if (!stopped && value) {
                  try {
                    accept(value)
                  } catch (error) {
                    note(error)
                  }
                }
              },
              () => {},
            )
            return result
          },
      ),
    snapshot = (options = {}) =>
      JSON.parse(
        JSON.stringify({
          schemaVersion: 1,
          supported: Boolean(navigator.gpu),
          stopped,
          pending,
          limit,
          dropped,
          counts,
          records: options.records === false ? undefined : records,
          recorded: records.length,
          marks,
          issues,
          meaning:
            'Native WebGPU creation requests and CPU invocation / async readiness spans. These are not measured native cache misses, driver cache hits, GPU execution or display presentation. Identity numbers are local to one page; compare semantic descriptors, not IDs, across runs.',
        }),
      )
  const api = {
    mark(value) {
      stage = String(value).slice(0, 128)
      if (marks.length < 128) marks.push({ stage, atMs: now() })
    },
    snapshot,
    stop() {
      stopped = true
      let restored = true
      for (const { owner, name, own, wrapper } of patches.reverse()) {
        if (owner[name] !== wrapper) {
          restored = false
          note(`${name}: ownership changed; not overwritten`)
          continue
        }
        try {
          if (own) Object.defineProperty(owner, name, own)
          else delete owner[name]
        } catch (error) {
          restored = false
          note(error)
        }
      }
      patches.length = 0
      return { ...snapshot(), restored }
    },
  }
  Object.defineProperty(window, '__carPipelineAudit', { configurable: true, value: api })
  factory(navigator.gpu, 'requestAdapter', (adapter) => factory(adapter, 'requestDevice', device))
}

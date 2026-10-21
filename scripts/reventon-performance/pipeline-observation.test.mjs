import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { installPipelineObservation } from './pipeline-observation.mjs'

function fixture(options = {}) {
  let tick = 0
  const calls = [],
    prototype = {
      createShaderModule(descriptor) {
        calls.push({ owner: this, descriptor })
        return descriptor
      },
      createRenderPipeline(descriptor) {
        calls.push({ owner: this, descriptor })
        return descriptor
      },
      createRenderPipelineAsync(descriptor) {
        calls.push({ owner: this, descriptor })
        return descriptor.promise
      },
      createComputePipeline(descriptor) {
        calls.push({ owner: this, descriptor })
        if (descriptor.error) throw descriptor.error
        return descriptor
      },
      createComputePipelineAsync(descriptor) {
        calls.push({ owner: this, descriptor })
        return descriptor.promise
      },
    },
    device = Object.create(prototype),
    adapter = {
      requestDevice() {
        assert.equal(this, adapter)
        return Promise.resolve(device)
      },
    },
    gpu = {
      requestAdapter() {
        assert.equal(this, gpu)
        return Promise.resolve(adapter)
      },
    },
    window = {},
    document = { querySelector: () => null }
  runInNewContext(`(${installPipelineObservation.toString()})(${JSON.stringify(options)})`, {
    window,
    document,
    navigator: { gpu },
    performance: { now: () => ++tick },
  })
  return { gpu, adapter, device, prototype, calls, audit: window.__carPipelineAudit }
}

async function connect(value) {
  await (await value.gpu.requestAdapter()).requestDevice()
  return value
}

test('records native requests without changing arguments, this, return values or prototypes', async () => {
  const value = await connect(fixture()),
    descriptor = { label: 'shader', code: 'private source' }
  assert.equal(value.device.createShaderModule(descriptor), descriptor)
  const row = value.audit.snapshot().records[0]
  assert.equal(row.method, 'createShaderModule')
  assert.equal(row.descriptor.codeUnits, descriptor.code.length)
  assert.equal(JSON.stringify(row).includes('private source'), false)
  assert.equal(value.calls[0].descriptor, descriptor)
  assert.equal(value.calls[0].owner, value.device)
  assert.equal(Object.hasOwn(value.device, 'createShaderModule'), true)
  assert.equal(Object.hasOwn(value.prototype, 'createShaderModule'), true)
  assert.equal(value.audit.stop().restored, true)
  assert.equal(Object.hasOwn(value.device, 'createShaderModule'), false)
})

test('keeps original async promises and reports readiness, not execution or cache hits', async () => {
  const { device, audit } = await connect(fixture())
  let resolve
  const promise = new Promise((complete) => {
      resolve = complete
    }),
    descriptor = {
      promise,
      fragment: { module: {}, targets: [{ format: 'rgba16float' }] },
      multisample: { count: 4 },
    }
  audit.mark('first-door')
  assert.equal(device.createRenderPipelineAsync(descriptor), promise)
  assert.equal(audit.snapshot().pending, 1)
  resolve({})
  await promise
  const result = audit.snapshot(),
    row = result.records[0]
  assert.equal(row.stage, 'first-door')
  assert.equal(row.status, 'resolved')
  assert.equal(row.descriptor.targets[0].format, 'rgba16float')
  assert.equal(row.descriptor.multisample.count, 4)
  assert.ok(row.elapsedMs >= row.callMs)
  assert.equal(result.pending, 0)
  assert.equal('cacheHit' in row, false)
})

test('preserves rejection and synchronous exception objects', async () => {
  const { device, audit } = await connect(fixture()),
    error = new Error('native compilation failed'),
    promise = Promise.reject(error)
  assert.equal(device.createComputePipelineAsync({ promise }), promise)
  await assert.rejects(promise, (value) => value === error)
  assert.throws(
    () => device.createComputePipeline({ error }),
    (value) => value === error,
  )
  assert.deepEqual(
    [...audit.snapshot().records].map((row) => row.status),
    ['rejected', 'threw'],
  )
  assert.equal(audit.snapshot().pending, 0)
})

test('snapshots copy descriptors, preserve MRT/depth/blend/vertex state, and omit WGSL', async () => {
  const { device, audit } = await connect(fixture()),
    module = {},
    descriptor = {
      label: 'beauty',
      layout: 'auto',
      vertex: {
        module,
        entryPoint: 'main',
        buffers: [
          { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] },
        ],
      },
      fragment: {
        module,
        targets: [
          {
            format: 'rgba16float',
            blend: {
              color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
              alpha: { operation: 'add' },
            },
          },
          null,
        ],
      },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true },
      primitive: { cullMode: 'back' },
      multisample: { count: 4 },
    }
  device.createRenderPipeline(descriptor)
  assert.equal(Object.isFrozen(descriptor.fragment.targets[0]), false)
  descriptor.fragment.targets[0].format = 'bgra8unorm'
  const first = audit.snapshot().records[0].descriptor
  first.targets[0].format = 'changed outside'
  const immutable = audit.snapshot().records[0].descriptor
  assert.equal(immutable.targets[0].format, 'rgba16float')
  assert.equal(immutable.targets[1], null)
  assert.equal(immutable.vertex.module, immutable.fragment.module)
  assert.equal(immutable.buffers[0].attributes[0].format, 'float32x3')
  assert.equal(immutable.depthStencil.format, 'depth24plus')
  assert.equal(immutable.primitive.cullMode, 'back')
  assert.equal(audit.snapshot({ records: false }).records, undefined)
  assert.equal(audit.snapshot({ records: false }).recorded, 1)
})

test('bounds retained data without suppressing native calls and does not wrap a repeated device twice', async () => {
  const value = await connect(fixture({ maxRecords: 2 }))
  await connect(value)
  for (let index = 0; index < 5; index++) value.device.createShaderModule({ code: 'x' })
  const result = value.audit.snapshot()
  assert.equal(result.records.length, 2)
  assert.equal(result.dropped, 3)
  assert.equal(result.counts.createShaderModule, 5)
  assert.equal(value.calls.length, 5)
})

test('restores only owned instance methods and does not patch devices arriving after stop', async () => {
  const value = await connect(fixture()),
    laterWrapper = () => null
  value.device.createShaderModule = laterWrapper
  assert.equal(value.audit.stop().restored, false)
  assert.equal(value.device.createShaderModule, laterWrapper)
  const pending = fixture(),
    promise = pending.gpu.requestAdapter()
  pending.audit.stop()
  const adapter = await promise
  await adapter.requestDevice()
  assert.equal(Object.hasOwn(pending.device, 'createShaderModule'), false)
})

test('stopping with async work pending returns an immutable snapshot and never cancels native work', async () => {
  const { device, audit } = await connect(fixture())
  let resolve
  const promise = new Promise((complete) => {
    resolve = complete
  })
  device.createComputePipelineAsync({ promise })
  const stopped = audit.stop()
  resolve({})
  await promise
  assert.equal(stopped.records[0].status, 'pending')
  assert.equal(audit.snapshot().records[0].status, 'resolved')
  assert.equal(audit.snapshot().pending, 0)
})

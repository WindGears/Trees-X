import assert from 'node:assert/strict'
import test from 'node:test'
import { installCarShadowVisibilityObservation } from './visibility-observation.mjs'

function fixture({ format = 'rgba16float', data, width = 2, height = 2 } = {}) {
  const targets = ['rawVisibility', 'filteredVisibility'].map((suffix) => ({
    width,
    height,
    textures: [{ name: 'TreesX.CarShadow.' + suffix, uuid: suffix }],
  }))
  const calls = [],
    original = function (target) {
      calls.push(target)
    }
  const renderer = {
    info: { frame: 7 },
    setRenderTarget: original,
    backend: {
      isWebGPUBackend: true,
      get: () => ({ textureDescriptorGPU: { format } }),
      device: { queue: { async onSubmittedWorkDone() {} } },
    },
    async readRenderTargetPixelsAsync(...args) {
      calls.push(args)
      return data
    },
  }
  const environment = { __demo: { scene: { renderer: { instance: renderer } } } }
  installCarShadowVisibilityObservation(environment)
  for (const target of targets) renderer.setRenderTarget(target)
  return {
    renderer,
    environment,
    original,
    targets,
    calls,
    observer: environment.__carShadowVisibilityObservation,
  }
}

test('actual half-float channels decode and skip 256-byte padding rather than inventing shadows', async () => {
  const data = new Uint16Array((256 + 16) / 2)
  data.fill(0x7e00)
  for (const [offset, value] of [
    [0, 0x0000],
    [4, 0x3800],
    [128, 0x3c00],
    [132, 0x3c00],
  ])
    data.set([value, value, value, 0x3c00], offset)
  const f = fixture({ data })
  const result = await f.observer.read()
  assert.equal(result.raw.finite, 4)
  assert.equal(result.raw.nonFinite, 0)
  assert.equal(result.raw.min, 0)
  assert.equal(result.raw.max, 1)
  assert.equal(result.raw.mean, 0.625)
  assert.equal(result.raw.shadowed, 2)
  assert.equal(result.raw.fractional, 1)
  assert.equal(result.raw.shadowedFractionOfAllReadPixels, 0.5)
  assert.equal(result.raw.nontrivialVisibility, true)
  assert.equal(result.raw.rgbMismatch, 0)
  assert.equal(result.raw.nativeBytes, 272)
  assert.equal(result.raw.alpha.max, 1)
  assert.equal(f.observer.stop().restored, true)
  assert.equal(f.renderer.setRenderTarget, f.original)
  await assert.rejects(() => f.observer.read(), /stopped/)
})

test('half-float special values and subnormals are reported rather than clamped', async () => {
  const data = new Uint16Array((5 * 8) / 2)
  for (const [index, value] of [0x0001, 0x7c00, 0xfc00, 0x7e00, 0xbc00].entries())
    data.set([value, value, value, 0x4800], index * 4)
  const f = fixture({ width: 5, height: 1, data })
  const result = (await f.observer.read()).raw
  assert.equal(result.finite, 2)
  assert.equal(result.nonFinite, 3)
  assert.equal(result.min, -1)
  assert.equal(result.max, 2 ** -24)
  assert.equal(result.outsideUnitRange, 1)
  assert.equal(result.alpha.max, 8)
})

test('unknown GPU format and mismatched native return type fail explicitly', async () => {
  const unknown = fixture({ format: 'rgba16unorm', data: new Uint16Array(8) })
  await assert.rejects(() => unknown.observer.read(), /Unreviewed/)
  const wrong = fixture({ data: new Float32Array(8) })
  await assert.rejects(() => wrong.observer.read(), /typed array/)
  const short = fixture({ data: new Uint16Array(8) })
  await assert.rejects(() => short.observer.read(), /padding/)
})

test('no observed target, oversized reads, duplicate hooks and overlapping reads are rejected', async () => {
  const f = fixture({
    width: 1,
    height: 1,
    data: new Uint16Array([0x3c00, 0x3c00, 0x3c00, 0x3c00]),
  })
  assert.throws(() => installCarShadowVisibilityObservation(f.environment), /already has an owner/)
  await assert.rejects(() => f.observer.read({ x: 0, y: 0, width: 2, height: 1 }), /bounded/)
  let release
  f.renderer.backend.device.queue.onSubmittedWorkDone = () =>
    new Promise((resolve) => {
      release = resolve
    })
  const reading = f.observer.read()
  await assert.rejects(() => f.observer.read(), /already reading/)
  release()
  await reading
  f.observer.stop()
  f.renderer.backend.device.queue.onSubmittedWorkDone = async () => {}
  installCarShadowVisibilityObservation(f.environment)
  await assert.rejects(
    () => f.environment.__carShadowVisibilityObservation.read(),
    /has not rendered/,
  )
})

test('stop never overwrites a newer owner of setRenderTarget', () => {
  const f = fixture()
  const next = () => {}
  f.renderer.setRenderTarget = next
  assert.equal(f.observer.stop().restored, false)
  assert.equal(f.renderer.setRenderTarget, next)
})

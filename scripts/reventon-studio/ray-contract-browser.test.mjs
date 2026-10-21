import assert from 'node:assert/strict'
import test from 'node:test'
import { installCarRayContractProbe } from './ray-contract-browser.mjs'
import { rayContractCases } from './ray-contract.mjs'

function fixture() {
  const previous = globalThis.window,
    state = { phase: 'ready', frames: 10, generation: 1, revision: 4, error: null, active: true },
    frame = {
      frameId: 10,
      updateBeforeNode(node) {
        if (node.type === 'SSRNode') node._noiseIndex.value++
        return 'updated'
      },
    },
    inspector = { finish: () => 'finished' },
    clears = [],
    reads = [],
    makeTarget = (name) => ({
      width: 4,
      height: 4,
      texture: { type: 1016, uuid: name },
      textures: [{ type: 1016, uuid: name }],
    })
  const native = makeTarget('native'),
    rawTarget = makeTarget('raw'),
    surface = { renderTarget: native, getTexture: () => native.textures[0] },
    first = {
      type: 'SSRNode',
      uuid: 'first',
      _noiseIndex: { value: 0 },
      getRenderTarget: () => firstTarget,
      depthNode: { passNode: surface },
    },
    second = {
      type: 'SSRNode',
      uuid: 'second',
      _noiseIndex: { value: 104729 },
      getRenderTarget: () => secondTarget,
      depthNode: { passNode: surface },
    },
    firstTarget = makeTarget('first-target'),
    secondTarget = makeTarget('second-target'),
    raw = {
      type: 'RTTNode',
      value: { name: 'TreesX.Reflection.rawDelta' },
      renderTarget: rawTarget,
    },
    renderer = {
      backend: {
        isWebGPUBackend: true,
        get: () => ({
          texture: { createView: () => ({}) },
          textureDescriptorGPU: { format: 'rgba16float' },
        }),
        device: {
          createCommandEncoder: () => ({
            beginRenderPass(options) {
              clears.push(options)
              return { end() {} }
            },
            finish() {
              return {}
            },
          }),
          queue: { submit() {} },
        },
      },
      _nodes: { nodeFrame: frame },
      _inspector: inspector,
      readRenderTargetPixelsAsync(target, ...args) {
        reads.push([target, ...args])
        return Promise.resolve(new Uint16Array(4 * 4 * 4))
      },
    },
    originalUpdate = frame.updateBeforeNode,
    originalFinish = inspector.finish
  globalThis.window = {
    __demo: { scene: { renderer: { instance: renderer } } },
    __carLighting: { snapshot: () => ({ ...state }) },
  }
  installCarRayContractProbe()
  const probe = globalThis.window.__carRayContract
  return {
    state,
    frame,
    inspector,
    first,
    second,
    raw,
    probe,
    clears,
    reads,
    originalUpdate,
    originalFinish,
    cleanup() {
      probe.restore()
      globalThis.window = previous
    },
  }
}

test('copies both native rays and matching MRT/raw only after a successful full frame', async () => {
  const f = fixture()
  try {
    const capture = f.probe.capture(rayContractCases[0])
    for (const node of [f.first, f.second, f.raw]) f.frame.updateBeforeNode(node)
    f.state.frames++
    assert.equal(f.inspector.finish(), 'finished')
    f.frame.frameId++ // A later frame must not change the queued copy provenance.
    const result = await capture
    assert.equal(result.nativeFrameId, 10)
    assert.equal(result.completedFrame, 11)
    assert.equal(result.rays.length, 2)
    assert.equal(result.rays[1].noiseIndex - result.rays[0].noiseIndex, 104729)
    assert.equal(f.reads.length, 4)
    assert.equal(f.clears.length, 2)
    assert.deepEqual(f.clears[0].colorAttachments[0].clearValue, { r: 0.5, g: 1, b: 2, a: 2 })
    assert.deepEqual(f.clears[1].colorAttachments[0].clearValue, { r: 3, g: 2, b: 1, a: 10000 })
  } finally {
    f.cleanup()
  }
})

test('rejects failed, stale or missing native work instead of copying diagnostic targets', async () => {
  for (const kind of ['failed', 'stale', 'missing-second']) {
    const f = fixture()
    try {
      const capture = f.probe.capture(rayContractCases[0]),
        rejected = assert.rejects(capture)
      f.frame.updateBeforeNode(f.first)
      f.frame.updateBeforeNode(f.raw)
      if (kind !== 'failed') f.state.frames++
      if (kind === 'stale') f.state.generation++
      f.inspector.finish()
      await rejected
      assert.equal(f.reads.length, 0)
    } finally {
      f.cleanup()
    }
  }
})

test('restores hooks and cancels a pending capture without another rendering clock', async () => {
  const f = fixture()
  try {
    const capture = f.probe.capture(rayContractCases[0]),
      rejected = assert.rejects(capture, /cancelled/)
    assert.throws(() => f.probe.capture(rayContractCases[0]), /pending/)
    assert.equal(f.probe.restore(), true)
    await rejected
    assert.equal(f.frame.updateBeforeNode, f.originalUpdate)
    assert.equal(f.inspector.finish, f.originalFinish)
    assert.equal(f.reads.length, 0)
    assert.throws(() => f.probe.capture(rayContractCases[0]), /stopped/)
  } finally {
    f.cleanup()
  }
})

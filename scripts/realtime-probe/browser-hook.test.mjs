import test from 'node:test'
import assert from 'node:assert/strict'
import { installProbe } from './browser-hook.mjs'

function fixture() {
  const previous = globalThis.window,
    state = { phase: 'ready', frames: 4, error: null, active: true, generation: 1, revision: 2 },
    frame = {
      frameId: 4,
      updateBeforeNode() {
        return 'updated'
      },
    },
    inspector = {
      finish() {
        return 'finished'
      },
    }
  let reads = 0
  const renderer = {
    backend: { isWebGPUBackend: true },
    _nodes: { nodeFrame: frame },
    _inspector: inspector,
    readRenderTargetPixelsAsync() {
      reads++
      throw new Error('Unexpected read')
    },
  }
  const originalUpdate = frame.updateBeforeNode,
    originalFinish = inspector.finish
  globalThis.window = {
    __demo: { scene: { renderer: { instance: renderer } } },
    __reflectionLighting: { snapshot: () => ({ ...state }) },
  }
  installProbe()
  const probe = globalThis.window.__reflectionProbe
  return {
    probe,
    state,
    frame,
    inspector,
    originalUpdate,
    originalFinish,
    reads: () => reads,
    cleanup() {
      probe.restore()
      globalThis.window = previous
    },
  }
}

test('a finally-finished failed draw cannot be captured as a complete frame', async () => {
  const f = fixture()
  try {
    const capture = f.probe.capture(),
      rejected = assert.rejects(capture, /No successful/)
    assert.equal(f.inspector.finish(), 'finished')
    await rejected
    assert.equal(f.reads(), 0)
  } finally {
    f.cleanup()
  }
})

test('a changed selection cannot read old product targets', async () => {
  const f = fixture()
  try {
    const capture = f.probe.capture(),
      rejected = assert.rejects(capture, /current-product/)
    f.state.frames++
    f.state.generation++
    f.inspector.finish()
    await rejected
    assert.equal(f.reads(), 0)
  } finally {
    f.cleanup()
  }
})

test('restoration cancels a pending read and removes both interception hooks', async () => {
  const f = fixture()
  try {
    f.state.phase = 'loading'
    assert.throws(() => f.probe.capture(), /ready active/)
    f.state.phase = 'ready'
    const capture = f.probe.capture(),
      rejected = assert.rejects(capture, /cancelled/)
    assert.equal(f.probe.restore(), true)
    await rejected
    assert.equal(f.frame.updateBeforeNode, f.originalUpdate)
    assert.equal(f.inspector.finish, f.originalFinish)
    assert.equal(f.reads(), 0)
  } finally {
    f.cleanup()
  }
})

/* global URL */
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  showroomOptions,
  showroomUrl,
  verifyShowroomState,
  verifyStaticCapture,
  showroomHtmlReport,
  viewNames,
} from './model.mjs'

const snapshot = () => ({
  product: 'reventon',
  sha256: 'sha',
  backend: 'webgpu',
  canvases: 1,
  sameCanvas: true,
  sameRenderer: true,
  output: [1440, 1000],
  gpuErrors: [],
  carStudioQuality: 'studio',
  environment: 'same-probe',
  oldGroundVisible: false,
  showroom: {
    requested: true,
    phase: 'ready',
    error: null,
    probe: { captures: 6, resolution: 1024 },
  },
  architecture: [
    'floor',
    'ceiling',
    'back wall',
    'front wall',
    'left wall',
    'right wall',
    'key softbox',
    'strip softbox',
    'back floor cove',
    'front floor cove',
    'left floor cove',
    'right floor cove',
  ].map((id) => ({ id })),
  lighting: {
    error: null,
    indirectLighting: { actual: 'ddgi', error: null },
    signals: { reflectionRays: { requested: 2, actual: 2, error: null, frames: 3, seeds: [0, 1] } },
    keyShadow: {
      requested: true,
      phase: 'ready',
      error: null,
      generation: 1,
      frames: 3,
      blasBuilds: 1,
      transformUpdates: 0,
      historyResets: 0,
    },
  },
})

test('showroom CLI is local, explicit, bounded and always headless', () => {
  assert.deepEqual(showroomOptions([], {}).variants, ['baseline', 'showroom'])
  assert.deepEqual(showroomOptions(['--mode', 'performance'], {}).variants, ['showroom'])
  assert.equal(showroomOptions([], { REVENTON_HEADLESS: '0' }).headless, true)
  assert.equal(showroomOptions(['--mode', 'performance'], {}).seconds, 30)
  for (const args of [
    ['--variants', 'showroom,showroom'],
    ['--variants', 'unknown'],
    ['--headless', '0'],
    ['--seconds', '121'],
    ['--mode', 'reload'],
    ['--output', '../outside'],
  ])
    assert.throws(() => showroomOptions(args, {}))
  const baseline = new URL(showroomUrl('http://127.0.0.1:5181', 'baseline'))
  const showroom = new URL(showroomUrl('http://127.0.0.1:5181', 'showroom', true))
  assert.equal(baseline.searchParams.has('carShowroom'), false)
  assert.equal(showroom.searchParams.get('carShowroom'), 'cold-studio')
  assert.equal(showroom.searchParams.get('carKeyShadow'), '1')
  assert.equal(showroom.searchParams.get('renderDiagnostics'), '1')
  assert.equal(
    showroom.searchParams.has('carReflection'),
    false,
    'No node-two reflection experiment',
  )
})

test('actual architecture, six full-resolution captures and no duplicate floor required', () => {
  verifyShowroomState(snapshot(), 'showroom', 'sha')
  const baseline = snapshot()
  baseline.showroom = null
  verifyShowroomState(baseline, 'baseline', 'sha')
  for (const [key, value] of [
    ['phase', 'preparing'],
    ['requested', false],
    ['error', 'failed'],
  ]) {
    const state = snapshot()
    state.showroom[key] = value
    assert.throws(() => verifyShowroomState(state, 'showroom', 'sha'))
  }
  for (const mutate of [
    (state) => {
      state.showroom.probe.captures = 0
    },
    (state) => {
      state.showroom.probe.resolution = 512
    },
    (state) => {
      state.oldGroundVisible = true
    },
    (state) => {
      state.architecture.pop()
    },
    (state) => {
      state.architecture = state.architecture.filter((entry) => entry.id !== 'ceiling')
    },
    (state) => {
      state.sameRenderer = false
    },
  ]) {
    const state = snapshot()
    mutate(state)
    assert.throws(() => verifyShowroomState(state, 'showroom', 'sha'))
  }
})

test('static studio capture is invariant under camera and rigid product movement', () => {
  verifyStaticCapture(snapshot(), snapshot())
  const changed = snapshot()
  changed.showroom.probe.captures = 12
  assert.throws(() => verifyStaticCapture(snapshot(), changed))
  changed.showroom.probe.captures = 6
  changed.environment = 'other'
  assert.throws(() => verifyStaticCapture(snapshot(), changed))
})

test('report includes whole-range shots, escapes labels, and preserves quality caveat', () => {
  assert.ok(viewNames.includes('outside-room') && viewNames.includes('top'))
  const html = showroomHtmlReport({
    passed: true,
    runs: [{ variant: '<script>', captures: [] }],
    limitations: [],
  })
  assert.ok(html.includes('&lt;script>'))
  assert.ok(html.includes('outside-room'))
  assert.ok(html.includes('remain unvalidated'))
  assert.ok(html.includes('Actual showroom and capture state'))
})

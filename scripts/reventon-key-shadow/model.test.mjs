/* global URL */
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  keyShadowOptions,
  keyShadowUrl,
  verifyKeyShadowState,
  verifyShadowMotion,
  keyShadowHtmlReport,
} from './model.mjs'
import { imageDifference } from './pixels.mjs'

const snapshot = (variant = 'shadow') => ({
  product: 'reventon',
  sha256: 'sha',
  backend: 'webgpu',
  canvases: 1,
  sameCanvas: true,
  sameRenderer: true,
  output: [1440, 1000],
  gpuErrors: [],
  carStudioQuality: 'studio',
  lighting: {
    error: null,
    indirectLighting: { actual: 'ddgi', error: null },
    signals: { reflectionRays: { requested: 2, actual: 2, error: null, frames: 3, seeds: [0, 1] } },
    keyShadow: {
      requested: variant === 'shadow',
      phase: variant === 'shadow' ? 'ready' : 'disabled',
      error: null,
      generation: 1,
      frames: 3,
      blasBuilds: 2,
      transformUpdates: 4,
      historyResets: 1,
    },
  },
})

test('headless shadow CLI remains bounded, local, explicit and cannot take focus', () => {
  assert.deepEqual(keyShadowOptions([], {}).variants, ['baseline', 'shadow'])
  assert.deepEqual(keyShadowOptions(['--mode', 'performance'], {}).variants, ['shadow'])
  assert.equal(keyShadowOptions([], { REVENTON_HEADLESS: '0' }).headless, true)
  for (const args of [
    ['--variants', 'baseline,baseline'],
    ['--variants', 'materials'],
    ['--headless', '0'],
    ['--output', '../outside'],
    ['--mode', 'reload'],
    ['--seconds', '121'],
  ])
    assert.throws(() => keyShadowOptions(args, {}))
  const baseline = new URL(keyShadowUrl('http://127.0.0.1:5181', 'baseline'))
  const shadow = new URL(keyShadowUrl('http://127.0.0.1:5181', 'shadow', true))
  assert.equal(baseline.searchParams.has('carKeyShadow'), false)
  assert.equal(shadow.searchParams.get('carKeyShadow'), '1')
  assert.equal(shadow.searchParams.get('carQuality'), 'studio')
  assert.equal(shadow.searchParams.get('renderDiagnostics'), '1')
  assert.equal(shadow.searchParams.has('carStudioReflections'), false)
})

test('actual identity, ready execution and transform counters are mandatory', () => {
  verifyKeyShadowState(snapshot(), 'shadow', 'sha')
  verifyKeyShadowState(snapshot('baseline'), 'baseline', 'sha')
  for (const [key, value] of [
    ['phase', 'loading'],
    ['frames', 0],
    ['blasBuilds', 0],
    ['error', 'failed'],
    ['transformUpdates', -1],
    ['generation', 0],
  ]) {
    const state = snapshot()
    state.lighting.keyShadow[key] = value
    assert.throws(() => verifyKeyShadowState(state, 'shadow', 'sha'))
  }
  const stationary = snapshot()
  stationary.lighting.keyShadow.transformUpdates = 0
  verifyKeyShadowState(stationary, 'shadow', 'sha')
})

test('continuous rigid motion updates transforms without rebuilding geometry', () => {
  const start = snapshot(),
    end = snapshot()
  end.lighting.keyShadow.transformUpdates++
  end.lighting.keyShadow.frames++
  verifyShadowMotion(start, end)
  assert.throws(() => verifyShadowMotion(start, start))
  end.lighting.keyShadow.blasBuilds++
  assert.throws(() => verifyShadowMotion(start, end))
})

test('pixel evidence is descriptive and report does not claim visual or display acceptance', () => {
  assert.deepEqual(
    imageDifference(Uint8Array.of(1, 2, 3, 0, 0, 0), Uint8Array.of(1, 2, 3, 2, 0, 0)),
    { pixels: 2, changedOverOneByte: 1, maxByteDifference: 2, meanByteDifference: 1 / 3 },
  )
  const report = keyShadowHtmlReport({
    passed: true,
    runs: [{ variant: '<unsafe>', captures: [] }],
    limitations: [],
  })
  assert.ok(report.includes('&lt;unsafe>'))
  assert.ok(report.includes('remain unvalidated'))
  assert.ok(report.includes('do not prove quality'))
})

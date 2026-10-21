/* global URL */
import assert from 'node:assert/strict'
import test from 'node:test'
import { htmlReport, studioOptions, studioUrl, verifyStudioState } from './model.mjs'

test('studio options remain explicit, local and bounded', () => {
  const defaults = studioOptions([], {})
  assert.equal(defaults.mode, 'visual')
  assert.deepEqual(defaults.variants, ['baseline', 'materials', 'studio'])
  assert.equal(defaults.seconds, 30)
  assert.equal(defaults.gpu, false)
  assert.equal(defaults.video, true)
  assert.equal(defaults.headless, true)
  assert.equal(studioOptions([], { REVENTON_HEADLESS: '0' }).headless, true)
  assert.deepEqual(studioOptions(['--mode', 'performance'], {}).variants, ['studio'])
  for (const args of [
    ['--output', '../outside'],
    ['--seconds', '0'],
    ['--seconds', '121'],
    ['--variants', 'studio,studio'],
    ['--gpu', 'yes'],
    ['--mode', 'reload'],
    ['--fake', '1'],
    ['--video'],
  ])
    assert.throws(() => studioOptions(args, {}))
})

test('variant switches isolate material / light from reflection ray count', () => {
  const urls = ['baseline', 'materials', 'studio'].map(
    (variant) => new URL(studioUrl('http://127.0.0.1:5181', variant)),
  )
  for (const url of urls) {
    assert.equal(url.searchParams.get('reventonAsset'), 'runtime-v2')
    assert.equal(url.searchParams.get('assetLoading'), 'streaming')
    assert.equal(url.searchParams.get('indirectLighting'), 'ddgi')
  }
  assert.equal(urls[0].searchParams.has('carQuality'), false)
  assert.equal(urls[1].searchParams.get('carQuality'), 'studio')
  assert.equal(urls[1].searchParams.get('carStudioReflections'), '1')
  assert.equal(urls[2].searchParams.get('carQuality'), 'studio')
  assert.equal(urls[2].searchParams.has('carStudioReflections'), false)
  assert.equal(
    new URL(studioUrl(urls[0], 'studio', true)).searchParams.get('renderDiagnostics'),
    '1',
  )
})

test('actual candidate identity, independent samples and frame commits are required', () => {
  const state = {
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
      signals: {
        reflectionRays: { requested: 2, actual: 2, error: null, frames: 2, seeds: [0, 1] },
      },
    },
  }
  verifyStudioState(state, 'studio', 'sha')
  state.lighting.signals.reflectionRays.seeds = [1, 1]
  assert.throws(() => verifyStudioState(state, 'studio', 'sha'))
  state.lighting.signals.reflectionRays.seeds = [0, 1]
  state.lighting.signals.reflectionRays.actual = 1
  assert.throws(() => verifyStudioState(state, 'studio', 'sha'))
  state.lighting.signals.reflectionRays.actual = 2
  state.lighting.signals.reflectionRays.frames = 0
  assert.throws(() => verifyStudioState(state, 'studio', 'sha'))
})

test('comparison HTML escapes input and never claims visual or presentation acceptance', () => {
  const html = htmlReport({
    passed: true,
    runs: [{ variant: '<unsafe>', captures: [{ name: 'whole', file: 'whole.png' }] }],
    limitations: ['JS submission < display time'],
  })
  assert.ok(html.includes('&lt;unsafe>'))
  assert.ok(!html.includes('<unsafe>'))
  assert.ok(html.includes('remain unvalidated'))
})

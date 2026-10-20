/* global URL */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  distribution,
  gpuSummary,
  intervals,
  performanceOptions,
  performanceUrl,
  presentationEvidence,
} from './metrics.mjs'

describe('car performance measurement semantics', () => {
  it('defaults to original full-size headed Edge, optimized scheduling and three 30s rounds', () => {
    const options = performanceOptions({})
    assert.equal(options.seconds, 30)
    assert.equal(options.rounds, 3)
    assert.equal(options.headless, false)
    assert.equal(options.channel, 'msedge')
    assert.equal(options.trace, true)
    assert.equal(options.gpuTiming, true)
    const url = new URL(performanceUrl(options))
    assert.equal(url.searchParams.get('renderDiagnostics'), '1')
    assert.equal(url.searchParams.get('carRenderTuning'), 'optimized')
    assert.equal(url.searchParams.has('reventonAsset'), false)
  })
  it('can isolate GPU and JS timing from heavy CDP trace overhead without certifying display', () => {
    const options = performanceOptions({ REVENTON_PERF_TRACE: '0' })
    assert.equal(options.trace, false)
    assert.equal(options.rounds, 3)
    assert.equal(options.seconds, 30)
    assert.equal(presentationEvidence([], 'actual-page-id').presentedBudgetValidated, false)
  })
  it('can measure JS submissions without enabling timestamp-query instrumentation', () => {
    const options = performanceOptions({ REVENTON_GPU_TIMING: '0', REVENTON_PERF_TRACE: '0' })
    assert.equal(options.gpuTiming, false)
    assert.equal(new URL(performanceUrl(options)).searchParams.has('renderDiagnostics'), false)
    assert.equal(options.rounds, 3)
    assert.equal(options.seconds, 30)
  })
  it('supports explicit runtime and legacy comparisons without changing the viewport', () => {
    const options = performanceOptions({
      REVENTON_ASSET: 'runtime-v2',
      REVENTON_TUNING: 'legacy',
      REVENTON_HEADLESS: '1',
    })
    const url = new URL(performanceUrl(options))
    assert.equal(options.headless, true)
    assert.equal(url.searchParams.get('reventonAsset'), 'runtime-v2')
    assert.equal(url.searchParams.get('carRenderTuning'), 'legacy')
  })
  it('rejects invalid modes and incomplete measurement parameters', () => {
    for (const options of [
      { REVENTON_ASSET: 'fake' },
      { REVENTON_TUNING: 'fast' },
      { REVENTON_INDIRECT: 'both' },
      { REVENTON_PERF_SECONDS: '0' },
      { REVENTON_PERF_ROUNDS: '1.5' },
    ])
      assert.throws(() => performanceOptions(options))
  })
  it('reports finite intervals and labelled GPU pass distributions separately', () => {
    assert.deepEqual(intervals([5, 15, 30]), [10, 15])
    assert.equal(distribution([]).p95Ms, null)
    assert.equal(distribution([1, 2, NaN, 10]).samples, 3)
    const values = gpuSummary([
      { type: 'render', label: { target: 'surface', context: 1 }, durationMs: 3 },
      { type: 'render', label: { target: 'surface', context: 1 }, durationMs: 5 },
      { type: 'compute', label: { name: 'DDGI' }, durationMs: 8 },
    ])
    assert.equal(values.length, 2)
    assert.equal(values[0].durations.samples, 2)
    assert.equal(values[1].type, 'compute')
  })
  it('never certifies RAF, swap or unassociated display events as page presentation', () => {
    const data = presentationEvidence(
      [
        { name: 'DrawFrame', ts: 10 },
        { name: 'FramePresented', ts: 20, args: { frame_token: 1 } },
        {
          name: 'FrameDisplayed',
          args: { data: { frame: 'other', frame_token: 2, presentation_timestamp_us: 30 } },
        },
      ],
      'target',
    )
    assert.equal(data.candidates, 2)
    assert.equal(data.attributableFrames, 0)
    assert.equal(data.presentedBudgetValidated, false)
  })
  it('uses explicit display time and deduplicates frame tokens when attributable evidence exists', () => {
    const frame = (token, time) => ({
      name: 'FramePresented',
      args: {
        data: {
          frame: 'target',
          frame_token: token,
          presentation_timestamp_us: time,
        },
      },
    })
    const data = presentationEvidence(
      [frame(1, 0), frame(2, 30000), frame(2, 30000), frame(3, 60000)],
      'target',
    )
    assert.equal(data.attributableFrames, 3)
    assert.equal(data.intervals.p95Ms, 30)
    assert.equal(data.presentedBudgetValidated, true)
    assert.equal(
      presentationEvidence([frame(1, 0), frame(2, 30000), frame(3, 60000)], 'target', 90000)
        .presentedBudgetValidated,
      false,
    )
  })
})

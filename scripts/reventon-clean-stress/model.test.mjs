import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  candidateIdentity,
  options,
  originalIdentity,
  resourceAccountingMeaning,
  resourceAssessment,
  resourceTolerance,
} from './model.mjs'

test('formal defaults require real duration and thirty reloads; smoke is explicit', () => {
  assert.equal(options({}).reloads, 30)
  assert.equal(options({}).seconds, 1200)
  assert.equal(options({}).headless, false)
  assert.throws(() => options({ REVENTON_STRESS_RELOADS: '2' }), /SMOKE/)
  assert.equal(options({ REVENTON_STRESS_SMOKE: '1', REVENTON_STRESS_RELOADS: '2' }).reloads, 2)
})
test('invalid paths, ranges, scope and remote destinations are refused', () => {
  for (const input of [
    { REVENTON_STRESS_OUTPUT: '../outside' },
    { REVENTON_STRESS_SECONDS: '0' },
    { REVENTON_STRESS_SCOPE: 'fake' },
    { CHECK_URL: 'https://example.com' },
    { CHECK_URL: 'http://admin:private@localhost:5181' },
    { CHECK_URL: 'http://localhost:5181/admin' },
    { CHECK_URL: 'http://localhost:5181/?token=private' },
    { CHECK_URL: 'http://localhost:5181/#private' },
  ])
    assert.throws(() => options(input))
  assert.equal(options({ CHECK_URL: 'http://[::1]:5181/' }).base, 'http://[::1]:5181')
})
const memory = Object.fromEntries(
  Object.keys(resourceTolerance).map((key) => [key, key === 'total' ? 100000000 : 100]),
)
test('equal resource platform is measured against an immutable baseline', () => {
  const baseline = { ...memory }
  const result = resourceAssessment([{ index: 4, memory: { ...memory } }], baseline)
  assert.equal(result.withinBaseline, true)
  assert.equal(result.earlyFailure, false)
  assert.deepEqual(baseline, memory)
})
test('large repeated target allocations stop immediately', () => {
  const result = resourceAssessment(
    [
      {
        index: 4,
        memory: {
          ...memory,
          total: memory.total + 70 * 1024 * 1024,
          renderTargets: 104,
          textures: 104,
        },
      },
    ],
    memory,
  )
  assert.equal(result.largeTargetIncrease, true)
  assert.equal(result.earlyFailure, true)
})
test('sustained increase cannot be hidden by rebasing and a one-off increase still fails final bounds', () => {
  const growing = [1, 2, 3, 4].map((value) => ({
    index: value + 3,
    memory: { ...memory, geometries: 100 + value },
  }))
  assert.deepEqual(resourceAssessment(growing, memory).sustained, ['geometries'])
  const one = resourceAssessment([{ index: 4, memory: { ...memory, programs: 104 } }], memory)
  assert.equal(one.earlyFailure, false)
  assert.equal(one.withinBaseline, false)
})
test('unknown counters fail instead of fabricating a zero allocation', () => {
  assert.throws(() => resourceAssessment([{ index: 4, memory: {} }], memory), /Unavailable/)
})

test('compressed-texture growth is checked by count even when ledger bytes remain unchanged', () => {
  const growing = [1, 2, 3, 4].map((value) => ({
    index: value + 3,
    memory: { ...memory, textures: memory.textures + value },
  }))
  const result = resourceAssessment(growing, memory)
  assert.deepEqual(result.sustained, ['textures'])
  assert.equal(result.values.total.delta, 0)
  assert.equal(result.earlyFailure, true)
  assert.equal(result.withinBaseline, false)
  assert.match(resourceAccountingMeaning, /counts each compressed texture as one byte/)
  assert.match(result.accounting, /not physical VRAM/)
})

test('loading comparisons pin distinct immutable original and runtime bundle identities', () => {
  assert.equal(originalIdentity.version, 1)
  assert.equal(candidateIdentity.version, 2)
  assert.notEqual(originalIdentity.sha256, candidateIdentity.sha256)
  for (const identity of [originalIdentity, candidateIdentity])
    assert.match(identity.sha256, /^[a-f0-9]{64}$/)
})

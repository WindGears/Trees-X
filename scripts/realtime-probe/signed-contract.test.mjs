import test from 'node:test'
import assert from 'node:assert/strict'
import { verifySignedContract } from './signed-contract.mjs'
const rgba = (...values) => Float32Array.from(values)
const fixture = () => ({
  width: 2,
  height: 1,
  forcedAllMiss: true,
  ssr: rgba(0, 0, 0, 10000, 0, 0, 0, 10000),
  native: rgba(2, 3, 4, 1, 7, 8, 9, 0.5),
  rawDelta: rgba(0, 0, 0, 10000, 0, 0, 0, 10000),
  filteredDelta: rgba(0, 0, 0, 16, 0, 0, 0, 16),
})
test('nonuniform native with forced misses preserves exact zero correction', () => {
  const r = verifySignedContract(fixture())
  assert.equal(r.passed, true)
  assert.equal(r.counts.supportedMisses, 2)
  assert.equal(r.minFiltered, 0)
  assert.equal(r.maxRawError, 0)
})
test('a tiny miss residual is a contract failure, not tolerated half-float noise', () => {
  const f = fixture()
  f.rawDelta[0] = 1e-8
  f.filteredDelta[4] = -1e-8
  assert.equal(verifySignedContract(f).passed, false)
})
test('true black hits retain a negative correction rather than being classified as misses', () => {
  const f = fixture()
  f.forcedAllMiss = false
  f.ssr[3] = 2
  f.rawDelta.set([-2, -3, -4], 0)
  f.filteredDelta.set([-2, -3, -4], 0)
  const r = verifySignedContract(f)
  assert.equal(r.passed, true)
  assert.equal(r.counts.supportedHits, 1)
  assert.equal(r.minFiltered, -4)
})
test('finite HDR has signed channels and applies the native capture weight once', () => {
  const f = fixture()
  f.forcedAllMiss = false
  f.ssr.set([20, 4, 1, 3], 4)
  f.rawDelta.set([3, -6, -8.5], 4)
  f.filteredDelta.set([3, -6, -8.5], 4)
  assert.equal(verifySignedContract(f).passed, true)
})
test('unsupported raw and filtered values must remain zero', () => {
  const f = fixture()
  f.native[3] = 0
  f.filteredDelta[0] = -0.1
  const r = verifySignedContract(f)
  assert.equal(r.counts.unsupported, 1)
  assert.equal(r.passed, false)
})
test('non-finite values fail without being silently clamped or averaged', () => {
  const f = fixture()
  f.native[0] = Infinity
  f.rawDelta[4] = NaN
  const r = verifySignedContract(f)
  assert.equal(r.passed, false)
  assert.equal(r.counts.invalid, 2)
})
test('malformed dimensions and buffers are rejected', () => {
  assert.throws(() => verifySignedContract({ ...fixture(), width: 1.5 }), /resolution/)
  assert.throws(() => verifySignedContract({ ...fixture(), rawDelta: [] }), /Float32Array/)
})

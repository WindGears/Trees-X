import assert from 'node:assert/strict'
import test from 'node:test'
import { analyzeReflectionProbe } from './metrics.mjs'

/** Pixel form [r, g, b] or [r, g, b, a]; alpha is only spelled out where classification matters. */
const rgba = (pixels) => pixels.flatMap(([r, g, b, a = 0]) => [r, g, b, a])
const probe = ({ width, height, support, ssr, native, replacement, previousReplacement }) =>
  analyzeReflectionProbe({
    width,
    height,
    support: Float32Array.from(support),
    ssr: Float32Array.from(rgba(ssr)),
    native: Float32Array.from(rgba(native)),
    replacement: Float32Array.from(rgba(replacement)),
    ...(previousReplacement === undefined
      ? {}
      : { previousReplacement: Float32Array.from(rgba(previousReplacement)) }),
  })

const NULL_STATS = { samples: 0, min: null, max: null, mean: null, rms: null }
const stats = (samples, min, max, mean, rms) => ({ samples, min, max, mean, rms })

function assertStats(actual, expected, label) {
  assert.equal(actual.samples, expected.samples, `${label}.samples`)
  for (const key of ['min', 'max', 'mean', 'rms'])
    if (expected[key] === null) assert.equal(actual[key], null, `${label}.${key}`)
    else
      assert.ok(
        Math.abs(actual[key] - expected[key]) <= 1e-12,
        `${label}.${key}: ${actual[key]} != ${expected[key]}`,
      )
}

/** Group scalars pool the RGB channels (samples = count * 3); per-channel scalars use count. */
function expectGroup(group, count, min, max, mean, rms, label) {
  assert.equal(group.count, count, `${label}.count`)
  assertStats(group, stats(count * 3, min, max, mean, rms), label)
  for (const [channel, entry] of Object.entries(group.channels))
    assertStats(entry, stats(count, min, max, mean, rms), `${label}.${channel}`)
}

function expectEmpty(group, label) {
  assert.equal(group.count, 0, `${label}.count`)
  assertStats(group, NULL_STATS, label)
  for (const [channel, entry] of Object.entries(group.channels))
    assertStats(entry, NULL_STATS, `${label}.${channel}`)
}

/** Expected order: hits, misses, unsupported, invalid, supported, valid, total. */
function expectCounts(result, expected) {
  const counts = result.counts
  const actual = [
    counts.supportedHits,
    counts.supportedMisses,
    counts.unsupported,
    counts.invalidPixels,
  ].concat(counts.supported, counts.valid, counts.total)
  assert.deepEqual(actual, expected)
  assert.deepEqual(
    [result.supportedHits, result.supportedMisses, result.unsupported, result.invalidPixels],
    expected.slice(0, 4),
  )
}

test('all-miss probe with nonuniform native and replacement = native reports exact zero residual', () => {
  const native = [
    [1, 2, 3],
    [-4, 0.5, 8],
    [0, 0, 0.0001],
    [2.5, -1.25, 100],
  ]
  const result = probe({
    width: 2,
    height: 2,
    support: [1, 1, 1, 1],
    ssr: [
      [0, 0, 0, 10000],
      [0.5, 0.5, 0.5, 10000],
      [9, 9, 9, 10000],
      [-1, -1, -1, 10000],
    ],
    native,
    replacement: native,
  })
  assert.equal(result.analysisOnly, true)
  assert.equal(result.visualAcceptance, 'not evaluated')
  assert.equal(result.passThresholds, null)
  assert.equal(result.frameTimeCompared, false)
  assert.match(result.measurementMethod, /[Oo]ne-shot/)
  assert.match(result.measurementMethod, /displayed-frame budget are not measured/)
  expectCounts(result, [0, 4, 0, 0, 4, 4, 4])
  assert.deepEqual(result.invalidValues.bySource, { ssr: 0, native: 0, replacement: 0, support: 0 })
  expectEmpty(result.correction.supportedHits, 'hit')
  expectGroup(result.correction.supportedMisses, 4, 0, 0, 0, 0, 'miss')
  // Negative finite HDR (pixel 1) stays legal data: it was counted, never filtered away.
  assert.equal(result.temporal, null)
})

test('a deliberately filtered replacement of nonuniform native leaves a nonzero residual', () => {
  const result = probe({
    width: 2,
    height: 1,
    support: [1, 1],
    ssr: [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ],
    native: [
      [2, 2, 2],
      [4, 4, 4],
    ],
    replacement: [
      [3, 3, 3],
      [3, 3, 3],
    ],
  })
  expectCounts(result, [0, 2, 0, 0, 2, 2, 2])
  expectEmpty(result.correction.supportedHits, 'hit')
  // Both rays miss, so "miss implies replacement - native = 0" is false once filtering ran.
  expectGroup(result.correction.supportedMisses, 2, -1, 1, 0, 1, 'filtered miss')
  assert.notEqual(result.correction.supportedMisses.rms, 0)
})

test('unsupported pixels are separated instead of contaminating hit and miss statistics', () => {
  const result = probe({
    width: 2,
    height: 2,
    support: [2, 1, -0.5, 0],
    ssr: [
      [0, 0, 0, 4],
      [0, 0, 0, 10000],
      [0, 0, 0, 3],
      [0, 0, 0, 10000],
    ],
    native: [
      [0, 0, 0],
      [5, 5, 5],
      [10, 10, 10],
      [-3, -3, -3],
    ],
    replacement: [
      [2, 2, 2],
      [5, 5, 5],
      [14, 14, 14],
      [3, 3, 3],
    ],
  })
  expectCounts(result, [1, 1, 2, 0, 2, 4, 4])
  expectGroup(result.correction.supportedHits, 1, 2, 2, 2, 2, 'hit')
  expectGroup(result.correction.supportedMisses, 1, 0, 0, 0, 0, 'miss')
  expectGroup(result.correction.unsupported, 2, 4, 6, 5, Math.sqrt(26), 'unsupported')
  // The support <= 0 residuals (4 and 6) must not reach the hit or miss groups above.
  assert.equal(result.correction.supportedHits.max, 2)
  assert.equal(result.correction.supportedMisses.max, 0)
})

test('hit classification opens strictly between alpha 0 and 9999; 0, 9999 and 10000 are misses', () => {
  const result = probe({
    width: 3,
    height: 2,
    support: [1, 1, 1, 0, 1, 1],
    ssr: [
      [0, 0, 0, 1],
      [0, 0, 0, 9998.5],
      [0, 0, 0, 9999],
      [0, 0, 0, 4],
      [0, 0, 0, 0],
      [0, 0, 0, -5],
    ],
    native: [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ],
    replacement: [
      [1, 1, 1],
      [2, 2, 2],
      [3, 3, 3],
      [4, 4, 4],
      [-1, -1, -1],
      [0, 0, 0],
    ],
  })
  expectCounts(result, [2, 3, 1, 0, 5, 6, 6])
  expectGroup(result.correction.supportedHits, 2, 1, 2, 1.5, Math.sqrt(2.5), 'hit')
  expectGroup(result.correction.supportedMisses, 3, -1, 3, 2 / 3, Math.sqrt(10 / 3), 'miss')
  expectGroup(result.correction.unsupported, 1, 4, 4, 4, 4, 'unsupported')
  // Alpha 9999 (residual 3) and the unsupported pixel (4) stay out of hit statistics.
  assert.equal(result.correction.supportedHits.max, 2)
})

test('non-finite support and channels are reported per source and excluded from statistics', () => {
  const result = probe({
    width: 4,
    height: 2,
    support: [1, 1, 1, 1, NaN, 3, 2, 2],
    ssr: [
      [0, 0, 0, 5],
      [NaN, 0, 0, 5],
      [0, 0, 0, 5],
      [0, 0, 0, 5],
      [0, 0, 0, 5],
      [0, 0, 0, Infinity],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ],
    native: [
      [1, 1, 1],
      [1, 1, 1],
      [1, 1, Infinity],
      [1, 1, 1],
      [1, 1, 1],
      [1, 1, 1],
      [1, -Infinity, 1],
      [0, 0, 0],
    ],
    replacement: [
      [3, 3, 3],
      [1, 1, 1],
      [1, 1, 1],
      [NaN, 1, 1],
      [1, 1, 1],
      [1, 1, 1],
      [1, 1, 1],
      [0, 0, 0],
    ],
  })
  expectCounts(result, [1, 1, 0, 6, 2, 2, 8])
  assert.deepEqual(result.invalidValues.bySource, { ssr: 2, native: 2, replacement: 1, support: 1 })
  assert.equal(result.invalidValues.sampleLimit, 8)
  const shaped = result.invalidValues.samples.map(
    ({ pixel, source, channel, kind }) => `${pixel}:${source}.${channel}:${kind}`,
  )
  assert.deepEqual(shaped, [
    '1:ssr.r:NaN',
    '2:native.b:Infinity',
    '3:replacement.r:NaN',
    '4:support.value:NaN',
    '5:ssr.a:Infinity',
    '6:native.g:-Infinity',
  ])
  // Only pixel 0 (hit residual 2) and pixel 7 (miss residual 0) survive into the statistics.
  expectGroup(result.correction.supportedHits, 1, 2, 2, 2, 2, 'hit')
  expectGroup(result.correction.supportedMisses, 1, 0, 0, 0, 0, 'miss')
  expectEmpty(result.correction.unsupported, 'unsupported')
})

test('previousReplacement reports same-pixel temporal RGB differences, not a perceived-noise score', () => {
  const result = probe({
    width: 3,
    height: 1,
    support: [1, 1, 1],
    ssr: [
      [0, 0, 0, 5],
      [0, 0, 0, 5],
      [0, 0, 0, 5],
    ],
    native: [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ],
    replacement: [
      [2, 2, 2],
      [-1, -1, -1],
      [3, 3, 3],
    ],
    previousReplacement: [
      [1, 1, 1],
      [0, 0, 0],
      [NaN, 3, 3],
    ],
  })
  // A NaN previous value is temporal-only evidence, not an invalid spatial pixel.
  expectCounts(result, [3, 0, 0, 0, 3, 3, 3])
  expectGroup(result.correction.supportedHits, 3, -1, 3, 4 / 3, Math.sqrt(14 / 3), 'correction')
  assert.equal(result.temporal.performed, true)
  assert.equal(result.temporal.snapshots, 2)
  assert.equal(result.temporal.perceivedNoise, 'not evaluated')
  assert.equal(Object.hasOwn(result.temporal, 'noiseScore'), false)
  assert.match(result.temporal.definition, /not a perceived-noise score/)
  expectGroup(result.temporal.supportedHits, 2, -1, 1, 0, 1, 'temporal hit')
  assert.deepEqual(
    [result.temporal.excludedPixels.supportedHits, result.temporal.excludedPixels.total],
    [1, 1],
  )
  assert.match(result.temporal.excludedPixels.reason, /non-finite/)
  expectEmpty(result.temporal.supportedMisses, 'temporal miss')
  expectEmpty(result.temporal.unsupported, 'temporal unsupported')
})

test('resolution and buffer guards reject malformed probes', () => {
  const valid = {
    width: 1,
    height: 1,
    support: Float32Array.from([1]),
    ssr: Float32Array.from([0, 0, 0, 5]),
    native: Float32Array.from([0, 0, 0, 0]),
    replacement: Float32Array.from([2, 2, 2, 0]),
  }
  assert.deepEqual(analyzeReflectionProbe(valid).resolution, { width: 1, height: 1, pixels: 1 })
  assert.throws(() => analyzeReflectionProbe(null), /one options object/)
  assert.throws(
    () => analyzeReflectionProbe({ ...valid, width: 0 }),
    /width must be a positive integer/,
  )
  assert.throws(() => analyzeReflectionProbe({ ...valid, width: -4 }), TypeError)
  assert.throws(() => analyzeReflectionProbe({ ...valid, width: 1.5 }), TypeError)
  assert.throws(() => analyzeReflectionProbe({ ...valid, width: NaN }), TypeError)
  assert.throws(
    () => analyzeReflectionProbe({ ...valid, height: Infinity }),
    /height must be a positive integer/,
  )
  assert.throws(() => analyzeReflectionProbe({ ...valid, height: '1' }), TypeError)
  assert.throws(
    () => analyzeReflectionProbe({ ...valid, ssr: new Float32Array(3) }),
    /ssr must have length 4/,
  )
  assert.throws(() => analyzeReflectionProbe({ ...valid, native: [0, 0, 0, 0] }), /Float32Array/)
  assert.throws(
    () => analyzeReflectionProbe({ ...valid, replacement: new Float64Array(4) }),
    TypeError,
  )
  assert.throws(
    () => analyzeReflectionProbe({ ...valid, support: new Float32Array(2) }),
    /support must have length 1/,
  )
  assert.throws(
    () => analyzeReflectionProbe({ ...valid, previousReplacement: new Float32Array(8) }),
    /previousReplacement must have length 4/,
  )
})

test('analysis never mutates the caller arrays and stays deterministic', () => {
  const input = {
    width: 2,
    height: 1,
    support: Float32Array.from([1, 0]),
    ssr: Float32Array.from([0, 0, 0, 4, 0, 0, 0, 9999]),
    native: Float32Array.from([1, -2, 3, 0, 4, 5, 6, 0]),
    replacement: Float32Array.from([2, 3, 4, 0, 7, 8, 9, 0]),
    previousReplacement: Float32Array.from([1, -2, 3, 0, 4, 5, 6, 0]),
  }
  const buffers = Object.entries(input).filter(([, value]) => value instanceof Float32Array)
  const snapshot = Object.fromEntries(buffers.map(([key, value]) => [key, Array.from(value)]))
  const first = analyzeReflectionProbe(input)
  for (const [key, values] of Object.entries(snapshot))
    assert.deepEqual(Array.from(input[key]), values, `${key} must be untouched`)
  assert.equal(Object.keys(snapshot).length, 5)
  assert.deepEqual(analyzeReflectionProbe(input), first)
  assert.equal(
    Object.values(first).some((value) => value instanceof Float32Array),
    false,
  )
})

test('empty categories and all-unsupported probes report null scalars, never NaN', () => {
  const result = probe({
    width: 2,
    height: 1,
    support: [0, -1],
    ssr: [
      [0, 0, 0, 10000],
      [0, 0, 0, 3],
    ],
    native: [
      [5, 5, 5],
      [5, 5, 5],
    ],
    replacement: [
      [7, 7, 7],
      [7, 7, 7],
    ],
  })
  expectCounts(result, [0, 0, 2, 0, 0, 2, 2])
  expectEmpty(result.correction.supportedHits, 'hit')
  expectEmpty(result.correction.supportedMisses, 'miss')
  expectGroup(result.correction.unsupported, 2, 2, 2, 2, 2, 'unsupported')
  assert.equal(result.temporal, null)
  assert.equal(JSON.stringify(result.correction).includes('NaN'), false)
  assert.equal(JSON.stringify(result.correction).includes('null'), true)
})

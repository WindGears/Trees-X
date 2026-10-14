/**
 * Trees X — realtime reflection-probe readback metrics (analysis only).
 *
 * Pure numeric reduction of one-shot WebGPU texture readbacks captured elsewhere: this module
 * never renders, never schedules GPU work, never touches the network and never mutates inputs.
 * Every buffer is a Float32Array at full resolution indexed by pixel * 4 + channel: `ssr` alpha is
 * the r185 world ray length read before any temporal/spatial filtering, `native` is the native
 * single-scattering term, `replacement` is the signal actually used for composition, `support`
 * holds one eligibility scalar per pixel and the optional `previousReplacement` is the previous
 * snapshot of `replacement`. No pass threshold, frame-time comparison, perceived-noise score or
 * image-quality verdict is produced here.
 */

const RGBA_SOURCES = ['ssr', 'native', 'replacement']
const CHANNEL_NAMES = ['r', 'g', 'b', 'a']
const HIT_ALPHA_MIN = 0 // exclusive
const HIT_ALPHA_MAX = 9999 // exclusive; r185 SSR writes 10000 for an environment miss
const MAX_INVALID_SAMPLES = 8

const MEASUREMENT_METHOD =
  'One-shot snapshots of the exact GPU textures: every pixel is read back once from the SSR ray ' +
  'texture (alpha = r185 world ray length), the native single-scattering term, the replacement ' +
  'signal used for composition and the per-pixel support mask. Every returned number is plain ' +
  'arithmetic over those Float32 values; no GPU timer, frame pacing, temporal accumulation or ' +
  'perceptual model takes part, so GPU frame time and displayed-frame budget are not measured.'

const CORRECTION_DEFINITION =
  'Per pixel and channel: replacement[channel] - native[channel] over otherwise valid pixels. ' +
  'min/max/mean/rms pool the RGB channel values of the category (samples = count * 3) and ' +
  'channels.* repeat them per channel. Negative finite HDR radiance is legal, so signed ' +
  'corrections are reported unclamped.'

const TEMPORAL_DEFINITION =
  'Per pixel and channel: replacement[channel] - previousReplacement[channel] between two ' +
  'independent one-shot snapshots, only for pixels that are valid and have finite previous RGB. ' +
  'That raw same-pixel difference moves with camera, object and lighting change as much as with ' +
  'reconstruction variation, so it is explicitly not a perceived-noise score.'

const CLASSIFICATION = {
  hit: 'finite support > 0 and finite ssr alpha with 0 < alpha < 9999 (r185 SSR ray length)',
  miss: 'finite support > 0 with ssr alpha outside (0, 9999), including 0, 9999, 10000 and negatives',
  unsupported:
    'finite support <= 0, reported separately so it cannot contaminate hit/miss statistics',
  invalid:
    'any non-finite (NaN / Infinity) support, ssr, native or replacement value, counted per source and excluded from every statistic instead of being clamped or silently dropped',
  negativeHdr: 'negative finite radiance is legal data, never invalid and never a miss sentinel',
  supportSemantics: 'support values are used as-is; support <= 0 is unsupported, not invalid',
}

function createAccumulator() {
  return { samples: 0, min: Infinity, max: -Infinity, sum: 0, sumSquares: 0 }
}

function accumulate(target, value) {
  target.samples += 1
  if (value < target.min) target.min = value
  if (value > target.max) target.max = value
  target.sum += value
  target.sumSquares += value * value
}

function createGroup() {
  return {
    pixels: 0,
    rgb: createAccumulator(),
    r: createAccumulator(),
    g: createAccumulator(),
    b: createAccumulator(),
  }
}

function addSample(group, r, g, b) {
  group.pixels += 1
  accumulate(group.rgb, r)
  accumulate(group.rgb, g)
  accumulate(group.rgb, b)
  accumulate(group.r, r)
  accumulate(group.g, g)
  accumulate(group.b, b)
}

function summarize(accumulator) {
  if (accumulator.samples === 0) return { samples: 0, min: null, max: null, mean: null, rms: null }
  return {
    samples: accumulator.samples,
    min: accumulator.min,
    max: accumulator.max,
    mean: accumulator.sum / accumulator.samples,
    rms: Math.sqrt(accumulator.sumSquares / accumulator.samples),
  }
}

/** Empty categories report count 0 and null scalars, never NaN. */
function summarizeGroup(group) {
  const pooled = summarize(group.rgb)
  return {
    count: group.pixels,
    samples: pooled.samples,
    min: pooled.min,
    max: pooled.max,
    mean: pooled.mean,
    rms: pooled.rms,
    channels: { r: summarize(group.r), g: summarize(group.g), b: summarize(group.b) },
  }
}

function readResolution(width, height) {
  for (const [name, value] of [
    ['width', width],
    ['height', height],
  ])
    if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0)
      throw new TypeError(`${name} must be a positive integer, received ${String(value)}`)
  const pixels = width * height
  if (!Number.isSafeInteger(pixels)) throw new RangeError('width * height must be a safe integer')
  return { width, height, pixels }
}

function readBuffer(name, value, expectedLength, unit) {
  if (!(value instanceof Float32Array)) throw new TypeError(`${name} must be a Float32Array`)
  if (value.length !== expectedLength)
    throw new RangeError(
      `${name} must have length ${expectedLength} (${unit}), received ${value.length}`,
    )
  return value
}

const nonFiniteKind = (value) =>
  Number.isNaN(value) ? 'NaN' : value > 0 ? 'Infinity' : '-Infinity'

function nonFiniteFindings(pixel, offset, support, views) {
  const findings = []
  if (!Number.isFinite(support))
    findings.push({ pixel, source: 'support', channel: 'value', kind: nonFiniteKind(support) })
  for (const source of RGBA_SOURCES)
    for (let channel = 0; channel < 4; channel += 1) {
      const value = views[source][offset + channel]
      if (!Number.isFinite(value))
        findings.push({
          pixel,
          source,
          channel: CHANNEL_NAMES[channel],
          kind: nonFiniteKind(value),
        })
    }
  return findings
}

function hasFiniteRgb(buffer, offset) {
  return (
    Number.isFinite(buffer[offset]) &&
    Number.isFinite(buffer[offset + 1]) &&
    Number.isFinite(buffer[offset + 2])
  )
}

function classify(support, alpha) {
  if (support <= 0) return 'unsupported'
  return alpha > HIT_ALPHA_MIN && alpha < HIT_ALPHA_MAX ? 'supportedHits' : 'supportedMisses'
}

export function analyzeReflectionProbe(input) {
  if (input === null || typeof input !== 'object')
    throw new TypeError('analyzeReflectionProbe expects one options object')
  const resolution = readResolution(input.width, input.height)
  const pixels = resolution.pixels
  const views = {
    ssr: readBuffer('ssr', input.ssr, pixels * 4, 'width * height * 4'),
    native: readBuffer('native', input.native, pixels * 4, 'width * height * 4'),
    replacement: readBuffer('replacement', input.replacement, pixels * 4, 'width * height * 4'),
    support: readBuffer('support', input.support, pixels, 'width * height'),
  }
  const optionalPrevious = input.previousReplacement ?? null
  const previous =
    optionalPrevious === null
      ? null
      : readBuffer('previousReplacement', optionalPrevious, pixels * 4, 'width * height * 4')
  const correction = {
    supportedHits: createGroup(),
    supportedMisses: createGroup(),
    unsupported: createGroup(),
  }
  const temporal = {
    supportedHits: createGroup(),
    supportedMisses: createGroup(),
    unsupported: createGroup(),
  }
  const temporalExcluded = { supportedHits: 0, supportedMisses: 0, unsupported: 0, total: 0 }
  const invalidBySource = { ssr: 0, native: 0, replacement: 0, support: 0 }
  const invalidSamples = []
  let invalidPixels = 0

  for (let pixel = 0; pixel < pixels; pixel += 1) {
    const offset = pixel * 4
    const support = views.support[pixel]
    const findings = nonFiniteFindings(pixel, offset, support, views)
    if (findings.length > 0) {
      invalidPixels += 1
      for (const finding of findings) {
        invalidBySource[finding.source] += 1
        if (invalidSamples.length < MAX_INVALID_SAMPLES) invalidSamples.push(finding)
      }
      continue
    }
    const category = classify(support, views.ssr[offset + 3])
    addSample(
      correction[category],
      views.replacement[offset] - views.native[offset],
      views.replacement[offset + 1] - views.native[offset + 1],
      views.replacement[offset + 2] - views.native[offset + 2],
    )
    if (previous === null) continue
    if (hasFiniteRgb(previous, offset))
      addSample(
        temporal[category],
        views.replacement[offset] - previous[offset],
        views.replacement[offset + 1] - previous[offset + 1],
        views.replacement[offset + 2] - previous[offset + 2],
      )
    else {
      temporalExcluded[category] += 1
      temporalExcluded.total += 1
    }
  }

  const counts = {
    supportedHits: correction.supportedHits.pixels,
    supportedMisses: correction.supportedMisses.pixels,
    unsupported: correction.unsupported.pixels,
    invalidPixels,
    supported: correction.supportedHits.pixels + correction.supportedMisses.pixels,
    valid: pixels - invalidPixels,
    total: pixels,
  }
  return {
    analysisOnly: true,
    visualAcceptance: 'not evaluated',
    perceivedNoise: 'not evaluated',
    passThresholds: null,
    frameTimeCompared: false,
    measurementMethod: MEASUREMENT_METHOD,
    classification: CLASSIFICATION,
    resolution,
    counts,
    // Flat copies of the four category counts, reported because callers read them directly.
    supportedHits: counts.supportedHits,
    supportedMisses: counts.supportedMisses,
    unsupported: counts.unsupported,
    invalidPixels: counts.invalidPixels,
    invalidValues: {
      bySource: invalidBySource,
      samples: invalidSamples,
      sampleLimit: MAX_INVALID_SAMPLES,
      note: 'Invalid pixels are reported here and excluded from every spatial and temporal statistic; no value is replaced, clamped or silently dropped.',
    },
    correction: {
      definition: CORRECTION_DEFINITION,
      supportedHits: summarizeGroup(correction.supportedHits),
      supportedMisses: summarizeGroup(correction.supportedMisses),
      unsupported: summarizeGroup(correction.unsupported),
    },
    temporal:
      previous === null
        ? null
        : {
            performed: true,
            snapshots: 2,
            definition: TEMPORAL_DEFINITION,
            perceivedNoise: 'not evaluated',
            supportedHits: summarizeGroup(temporal.supportedHits),
            supportedMisses: summarizeGroup(temporal.supportedMisses),
            unsupported: summarizeGroup(temporal.unsupported),
            excludedPixels: {
              supportedHits: temporalExcluded.supportedHits,
              supportedMisses: temporalExcluded.supportedMisses,
              unsupported: temporalExcluded.unsupported,
              total: temporalExcluded.total,
              reason:
                'previousReplacement had a non-finite RGB value at that otherwise valid pixel, so no same-pixel difference was computed there',
            },
          },
  }
}

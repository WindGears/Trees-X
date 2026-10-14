/** Numeric contract for actual signed GPU payloads, never an image-quality score. */
export function verifySignedContract({
  width,
  height,
  ssr,
  native,
  rawDelta,
  filteredDelta,
  forcedAllMiss = false,
}) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1)
    throw new TypeError('Positive integer resolution required')
  const pixels = width * height
  if (!Number.isSafeInteger(pixels)) throw new TypeError('Resolution overflow')
  const buffers = { ssr, native, rawDelta, filteredDelta }
  for (const [name, data] of Object.entries(buffers))
    if (!(data instanceof Float32Array) || data.length !== pixels * 4)
      throw new TypeError(`${name}: full RGBA Float32Array required`)
  const errors = [],
    counts = { supportedHits: 0, supportedMisses: 0, unsupported: 0, invalid: 0 }
  let failures = 0,
    maxRawError = 0,
    minFiltered = Infinity,
    maxFiltered = -Infinity
  const fail = (pixel, reason) => {
    failures++
    if (errors.length < 16) errors.push({ pixel, reason })
  }
  for (let pixel = 0; pixel < pixels; pixel++) {
    const offset = pixel * 4
    let finite = true
    for (const [name, data] of Object.entries(buffers))
      for (let channel = 0; channel < 4; channel++)
        if (!Number.isFinite(data[offset + channel])) {
          finite = false
          fail(pixel, `${name}: non-finite channel ${channel}`)
        }
    if (!finite) {
      counts.invalid++
      continue
    }
    const supported = native[offset + 3] > 0,
      hit = ssr[offset + 3] > 0 && ssr[offset + 3] < 9999
    counts[supported ? (hit ? 'supportedHits' : 'supportedMisses') : 'unsupported']++
    if (forcedAllMiss && ssr[offset + 3] !== 10000) fail(pixel, 'Forced-miss sentinel absent')
    for (let channel = 0; channel < 3; channel++) {
      const raw = rawDelta[offset + channel],
        filtered = filteredDelta[offset + channel]
      const expected =
        supported && hit ? ssr[offset + channel] * native[offset + 3] - native[offset + channel] : 0
      const error = Math.abs(raw - expected)
      maxRawError = Math.max(maxRawError, error)
      // Representation tolerance only: two half-float inputs and half-float output.
      // Miss/unsupported zero invariants below have no tolerance.
      const tolerance = Math.max(1e-6, 0.002 * Math.max(Math.abs(raw), Math.abs(expected)))
      if (expected === 0 ? raw !== 0 : error > tolerance)
        fail(pixel, `Raw signed channel ${channel} differs from its ray contract`)
      if ((!supported || forcedAllMiss) && filtered !== 0)
        fail(pixel, `Filtered channel ${channel} changed retained native IBL`)
      minFiltered = Math.min(minFiltered, filtered)
      maxFiltered = Math.max(maxFiltered, filtered)
    }
  }
  return {
    analysisOnly: true,
    visualAcceptance: 'not evaluated',
    passed: failures === 0,
    errors,
    failures,
    counts,
    maxRawError,
    minFiltered: Number.isFinite(minFiltered) ? minFiltered : null,
    maxFiltered: Number.isFinite(maxFiltered) ? maxFiltered : null,
    tolerance: 'Half-float representation only; miss and unsupported zero remain exact',
  }
}

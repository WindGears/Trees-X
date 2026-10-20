/* global URL */
export function performanceOptions(environment = process.env) {
  const integer = (name, fallback) => {
    const value = Number(environment[name] ?? fallback)
    if (!Number.isSafeInteger(value) || value < 1)
      throw new Error(`${name} must be a positive integer`)
    return value
  }
  const asset = environment.REVENTON_ASSET ?? 'original',
    tuning = environment.REVENTON_TUNING ?? 'optimized',
    indirect = environment.REVENTON_INDIRECT ?? 'ddgi'
  if (!['original', 'runtime-v2'].includes(asset)) throw new Error('Invalid REVENTON_ASSET')
  if (!['legacy', 'optimized'].includes(tuning)) throw new Error('Invalid REVENTON_TUNING')
  if (!['ssgi', 'ddgi'].includes(indirect)) throw new Error('Invalid REVENTON_INDIRECT')
  return {
    base: environment.CHECK_URL || 'http://127.0.0.1:5181',
    output: environment.REVENTON_PERF_OUTPUT || `artifacts/car-performance/${asset}-${tuning}`,
    asset,
    tuning,
    indirect,
    seconds: integer('REVENTON_PERF_SECONDS', 30),
    rounds: integer('REVENTON_PERF_ROUNDS', 3),
    warmupSeconds: integer('REVENTON_PERF_WARMUP_SECONDS', 3),
    headless: environment.REVENTON_HEADLESS === '1' || environment.REVENTON_HEADED === '0',
    trace: environment.REVENTON_PERF_TRACE !== '0',
    gpuTiming: environment.REVENTON_GPU_TIMING !== '0',
    channel: environment.REVENTON_BROWSER_CHANNEL || 'msedge',
    expectedBundle: environment.REVENTON_EXPECTED_BUNDLE || null,
  }
}

export function performanceUrl(options) {
  const url = new URL('/', options.base)
  for (const [key, value] of Object.entries({
    product: 'reventon',
    renderPipeline: 'realtime',
    indirectLighting: options.indirect,
    assetLoading: 'streaming',
    ...(options.gpuTiming === false ? {} : { renderDiagnostics: '1' }),
    carRenderTuning: options.tuning,
    ...(options.asset === 'runtime-v2' ? { reventonAsset: 'runtime-v2' } : {}),
  }))
    url.searchParams.set(key, value)
  return url.href
}

export function distribution(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b)
  const percentile = (fraction) =>
    sorted.length
      ? sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))]
      : null
  return {
    samples: sorted.length,
    minMs: sorted[0] ?? null,
    medianMs: percentile(0.5),
    p95Ms: percentile(0.95),
    maxMs: sorted.at(-1) ?? null,
    meanMs: sorted.length ? sorted.reduce((sum, value) => sum + value, 0) / sorted.length : null,
  }
}

export const intervals = (times) => times.slice(1).map((time, index) => time - times[index])

export function gpuSummary(samples) {
  const groups = new Map()
  for (const sample of samples) {
    const key = [
      sample.type,
      sample.label?.target ?? '',
      sample.label?.context ?? '',
      sample.label?.attachments?.join('|') ?? '',
      sample.label?.name ?? 'unlabelled',
    ].join(':')
    let group = groups.get(key)
    if (!group) {
      group = { type: sample.type, label: sample.label, values: [] }
      groups.set(key, group)
    }
    group.values.push(sample.durationMs)
  }
  return [...groups.values()].map(({ values, ...group }) => ({
    ...group,
    durations: distribution(values),
  }))
}

/** Swap, RAF, DrawFrame and GPU completion events are not presentation evidence.
 * Accept only an explicitly timestamped display event attributable to this page.
 * Chromium builds without these fields remain unvalidated and retain raw traces.
 */
export function presentationEvidence(events, mainFrameId, minimumDurationMs = 0) {
  const names = new Set(['FramePresented', 'FrameDisplayed', 'Display::FrameDisplayed']),
    candidates = events.filter((event) => names.has(event.name)),
    accepted = []
  for (const event of candidates) {
    const data = event.args?.data ?? event.args ?? {}
    if (
      !mainFrameId ||
      data.frame !== mainFrameId ||
      !Number.isFinite(data.presentation_timestamp_us)
    )
      continue
    const token = data.frame_token
    if (typeof token !== 'number' && typeof token !== 'string') continue
    accepted.push({ token: String(token), timeMs: data.presentation_timestamp_us / 1000 })
  }
  const unique = [...new Map(accepted.map((entry) => [entry.token, entry])).values()].sort(
    (a, b) => a.timeMs - b.timeMs,
  )
  const stats = distribution(intervals(unique.map((entry) => entry.timeMs))),
    durationMs = unique.length > 1 ? unique.at(-1).timeMs - unique[0].timeMs : 0,
    coverageValidated = unique.length >= 3 && durationMs >= minimumDurationMs
  return {
    method: 'explicit display presentation_timestamp_us + page frame identity + unique frame token',
    candidates: candidates.length,
    attributableFrames: unique.length,
    durationMs,
    minimumDurationMs,
    coverageValidated,
    intervals: stats,
    evidenceAvailable: unique.length >= 3,
    presentedBudgetValidated: coverageValidated && stats.p95Ms <= 33.4,
    reason:
      unique.length < 3
        ? 'Trace lacks enough explicit display timestamps attributable to this page; no RAF/swap substitution.'
        : !coverageValidated
          ? 'Attributable display evidence does not cover the required measurement duration.'
          : stats.p95Ms <= 33.4
            ? 'Measured attributable display intervals meet the target.'
            : 'Measured display target not met.',
  }
}

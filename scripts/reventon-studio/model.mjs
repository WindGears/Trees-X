/* global URL */
import assert from 'node:assert/strict'
import { resolve, sep } from 'node:path'
import { localAuditOrigin } from '../reventon-performance/audit-origin.mjs'

export const variants = ['baseline', 'materials', 'studio']

export function studioOptions(args = process.argv.slice(2), environment = process.env) {
  const input = new Map()
  for (let index = 0; index < args.length; index += 2) {
    assert.ok(args[index].startsWith('--') && args[index + 1], 'Options require --name value')
    assert.ok(!input.has(args[index]), 'Duplicate option: ' + args[index])
    input.set(args[index], args[index + 1])
  }
  for (const key of input.keys())
    assert.ok(
      ['--mode', '--variants', '--seconds', '--output', '--gpu', '--video'].includes(key),
      'Unknown option: ' + key,
    )
  const mode = input.get('--mode') ?? 'visual'
  assert.ok(['visual', 'performance', 'all'].includes(mode), 'Invalid mode')
  const selected = (
    input.get('--variants') ?? (mode === 'performance' ? 'studio' : variants.join(','))
  )
    .split(',')
    .filter(Boolean)
  assert.ok(
    selected.length && new Set(selected).size === selected.length,
    'Unique variants required',
  )
  assert.ok(
    selected.every((value) => variants.includes(value)),
    'Invalid variant',
  )
  const seconds = Number(input.get('--seconds') ?? 30)
  assert.ok(
    Number.isSafeInteger(seconds) && seconds >= 1 && seconds <= 120,
    'Seconds must be 1–120',
  )
  const boolean = (key, fallback) => {
    const value = input.get(key) ?? fallback
    assert.ok(['0', '1'].includes(value), key + ' must be 0 or 1')
    return value === '1'
  }
  const output = resolve(input.get('--output') ?? 'artifacts/car-studio/' + mode)
  assert.ok(output.startsWith(resolve('artifacts') + sep), 'Output must stay inside artifacts/')
  return {
    mode,
    variants: selected,
    seconds,
    output,
    gpu: boolean('--gpu', '0'),
    video: boolean('--video', mode === 'performance' ? '0' : '1'),
    base: localAuditOrigin(environment.CHECK_URL ?? 'http://127.0.0.1:5181'),
    channel: environment.REVENTON_BROWSER_CHANNEL ?? 'msedge',
    // User requires background testing without taking focus. This cannot be
    // overridden by a stale REVENTON_HEADLESS=0 shell setting.
    headless: true,
  }
}

export function studioUrl(base, variant, gpu = false) {
  assert.ok(variants.includes(variant))
  const url = new URL('/', base)
  for (const [key, value] of Object.entries({
    product: 'reventon',
    renderPipeline: 'realtime',
    indirectLighting: 'ddgi',
    assetLoading: 'streaming',
    reventonAsset: 'runtime-v2',
    ...(variant === 'baseline' ? {} : { carQuality: 'studio' }),
    ...(variant === 'materials' ? { carStudioReflections: '1' } : {}),
    ...(gpu ? { renderDiagnostics: '1' } : {}),
  }))
    url.searchParams.set(key, value)
  return url.href
}

export function verifyStudioState(state, variant, sha256) {
  assert.equal(state.product, 'reventon')
  assert.equal(state.sha256, sha256, 'The audited runtime-v2 must actually be loaded')
  assert.equal(state.backend, 'webgpu')
  assert.equal(state.canvases, 1)
  assert.equal(state.sameCanvas && state.sameRenderer, true)
  assert.deepEqual(state.output, [1440, 1000])
  assert.equal(state.lighting.indirectLighting.actual, 'ddgi')
  assert.equal(state.lighting.error, null)
  assert.equal(state.lighting.indirectLighting.error, null)
  assert.deepEqual(state.gpuErrors, [])
  if (variant !== 'baseline') {
    assert.equal(state.carStudioQuality, 'studio', 'Studio override must be applied to actual root')
    const rays = state.lighting.signals.reflectionRays
    const expected = variant === 'studio' ? 2 : 1
    assert.equal(rays?.requested, expected)
    assert.equal(rays?.actual, expected, 'A silent reflection fallback is not accepted')
    assert.equal(rays?.error, null)
    assert.ok(rays.frames > 0, 'Actual reflection frames must have committed')
    assert.equal(rays.seeds.length, expected)
    assert.equal(new Set(rays.seeds).size, expected, 'Reflection rays must have independent seeds')
  }
}

export function htmlReport(report) {
  const escape = (value) =>
    String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;')
  const shots = ['whole', 'paint-body', 'door-right', 'cabin', 'wheel-front', 'separated']
  const summary = report.runs
    .map(
      (run) =>
        `<tr><td>${escape(run.variant)}</td><td>${Number.isFinite(run.interactiveObservedMs) ? (run.interactiveObservedMs / 1000).toFixed(3) + 's' : '—'}</td><td>${Number.isFinite(run.enhancedObservedMs) ? (run.enhancedObservedMs / 1000).toFixed(3) + 's' : '—'}</td><td>${run.video ? `<a href="${escape(run.video)}">Recorded real interaction</a>` : '—'}</td></tr>`,
    )
    .join('')
  const cells = shots
    .map(
      (name) =>
        `<section><h2>${name}</h2><div class="row">${report.runs
          .map((run) => {
            const capture = run.captures.find((entry) => entry.name === name)
            return `<figure><figcaption>${escape(run.variant)}</figcaption>${capture ? `<a href="${escape(run.variant + '/' + capture.file)}"><img src="${escape(run.variant + '/' + capture.file)}" alt="${escape(name + ' ' + run.variant)}"></a>` : '<p>Not captured</p>'}</figure>`
          })
          .join('')}</div></section>`,
    )
    .join('')
  return `<!doctype html><meta charset="utf-8"><title>Reventón studio comparison</title><style>body{margin:28px;background:#17191b;color:#eee;font:15px system-ui}h1{font-size:25px}h2{font-size:18px}.row{display:grid;grid-template-columns:repeat(${Math.max(1, report.runs.length)},minmax(0,1fr));gap:12px}figure{margin:0}figcaption{padding:9px;background:#292c30}img{width:100%;display:block}section{margin:30px 0}a{color:#acd3ff}pre{white-space:pre-wrap}table{border-collapse:collapse}th,td{padding:9px 18px;border:1px solid #444;text-align:left}</style><h1>Car studio · fixed input comparison</h1><p>Engineering procedure: ${report.passed ? 'completed' : 'incomplete'}. Human image quality and 30 FPS presentation budget remain unvalidated.</p><p><a href="report.json">Raw report and startup / timing evidence</a></p><table><tr><th>Variant</th><th>Interactive observed</th><th>DDGI observed</th><th>Video</th></tr>${summary}</table>${cells}<h2>Limitations</h2><pre>${escape(report.limitations.join('\n'))}</pre>`
}

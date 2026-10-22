/* global URL */
import assert from 'node:assert/strict'
import {
  htmlReport,
  studioOptions,
  studioUrl,
  verifyStudioState,
} from '../reventon-studio/model.mjs'

export const variants = ['baseline', 'shadow']

export function keyShadowOptions(args = process.argv.slice(2), environment = process.env) {
  const mapped = [...args]
  const variantIndex = mapped.indexOf('--variants')
  const modeIndex = mapped.indexOf('--mode')
  const performance = modeIndex >= 0 && mapped[modeIndex + 1] === 'performance'
  const selected =
    variantIndex >= 0 ? mapped[variantIndex + 1]?.split(',') : performance ? ['shadow'] : variants
  assert.ok(
    selected?.length && selected.every((value) => variants.includes(value)),
    'Invalid key-shadow variant',
  )
  assert.equal(new Set(selected).size, selected.length, 'Unique variants required')
  const mappedVariants = selected.map((value) => (value === 'baseline' ? 'materials' : 'studio'))
  if (variantIndex >= 0) mapped[variantIndex + 1] = mappedVariants.join(',')
  else mapped.push('--variants', mappedVariants.join(','))
  if (!mapped.includes('--output'))
    mapped.push(
      '--output',
      'artifacts/car-key-shadow/' + (modeIndex >= 0 ? mapped[modeIndex + 1] : 'visual'),
    )
  const parsed = studioOptions(mapped, environment)
  return { ...parsed, variants: selected, headless: true }
}

export function keyShadowUrl(base, variant, gpu = false) {
  assert.ok(variants.includes(variant), 'Invalid key-shadow variant')
  const url = new URL(studioUrl(base, 'studio', gpu))
  if (variant === 'shadow') url.searchParams.set('carKeyShadow', '1')
  return url.href
}

export function verifyKeyShadowState(state, variant, sha256) {
  verifyStudioState(state, 'studio', sha256)
  const shadow = state.lighting.keyShadow
  assert.ok(shadow, 'Actual key-shadow lifecycle diagnostics required')
  assert.equal(shadow.requested, variant === 'shadow')
  assert.equal(shadow.error, null)
  if (variant === 'baseline') {
    assert.equal(shadow.phase, 'disabled')
    return
  }
  assert.equal(shadow.phase, 'ready', 'Silent key-shadow fallback is not accepted')
  assert.ok(
    Number.isInteger(shadow.generation) && shadow.generation > 0,
    'Current shadow generation required',
  )
  assert.ok(shadow.frames > 0, 'Actual key-shadow frames must commit')
  assert.ok(shadow.blasBuilds > 0, 'Actual BLAS preparation must be recorded')
  assert.ok(
    Number.isInteger(shadow.transformUpdates) && shadow.transformUpdates >= 0,
    'TLAS updates must be recorded; a fresh stationary pose need not refit',
  )
  assert.ok(Number.isInteger(shadow.historyResets) && shadow.historyResets >= 0)
}

export function verifyShadowMotion(start, end) {
  const before = start.lighting.keyShadow
  const after = end.lighting.keyShadow
  assert.equal(after.generation, before.generation, 'Motion must not replace the shadow generation')
  assert.equal(after.blasBuilds, before.blasBuilds, 'Rigid motion must not rebuild BLAS')
  assert.ok(
    after.transformUpdates > before.transformUpdates,
    'Actual continuous movement must update TLAS',
  )
  assert.ok(after.frames > before.frames, 'Actual movement must commit visibility frames')
}

export function keyShadowHtmlReport(report) {
  const html = htmlReport(report)
    .replaceAll('Reventón studio comparison', 'Reventón key-softbox shadow comparison')
    .replaceAll(
      'Car studio · fixed input comparison',
      'Car key-softbox shadow · fixed input comparison',
    )
    .replace('DDGI observed', 'DDGI observed')
  const escape = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  const diagnostics = report.runs.map((run) => ({
    variant: run.variant,
    keyShadowObservedMs: run.keyShadowObservedMs ?? null,
    initial: run.initial?.lighting?.keyShadow ?? null,
    motion: run.visualMotion?.map((entry) => ({
      kind: entry.kind,
      elapsedMs: entry.elapsedMs,
      frames: entry.frames,
    })),
    historyJump: run.historyJump ?? null,
  }))
  const extraShots = ['open-doors', 'wheel-open']
    .map(
      (name) =>
        `<section><h2>${name}</h2><div class="row">${report.runs
          .map((run) => {
            const capture = run.captures.find((entry) => entry.name === name)
            return `<figure><figcaption>${escape(run.variant)}</figcaption>${capture ? `<a href="${escape(run.variant + '/' + capture.file)}"><img src="${escape(run.variant + '/' + capture.file)}" alt="${name}"></a>` : '<p>Not captured</p>'}</figure>`
          })
          .join('')}</div></section>`,
    )
    .join('')
  return (
    html +
    extraShots +
    `<h2>Actual key-shadow execution</h2><pre>${escape(JSON.stringify(diagnostics, null, 2))}</pre><h2>DOM-free image differences</h2><p>Descriptive image changes only. Stochastic lighting varies; these measurements do not prove quality or isolate shadow contribution.</p><pre>${escape(JSON.stringify(report.canvasDifferences ?? [], null, 2))}</pre>`
  )
}

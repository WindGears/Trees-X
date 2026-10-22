/* global URL */
import assert from 'node:assert/strict'
import { studioOptions, htmlReport } from '../reventon-studio/model.mjs'
import { keyShadowUrl, verifyKeyShadowState } from '../reventon-key-shadow/model.mjs'

export const variants = ['baseline', 'showroom']
export const viewNames = [
  'whole',
  'side',
  'rear',
  'top',
  'paint-body',
  'door-right',
  'wheel-front',
  'open-doors',
  'cabin',
  'separated',
  'outside-room',
]

export function showroomOptions(args = process.argv.slice(2), environment = process.env) {
  const mapped = [...args]
  const variantIndex = mapped.indexOf('--variants')
  const modeIndex = mapped.indexOf('--mode')
  const mode = modeIndex >= 0 ? mapped[modeIndex + 1] : 'visual'
  const selected =
    variantIndex >= 0
      ? mapped[variantIndex + 1]?.split(',')
      : mode === 'performance'
        ? ['showroom']
        : variants
  assert.ok(
    selected?.length && selected.every((value) => variants.includes(value)),
    'Invalid showroom variant',
  )
  assert.equal(new Set(selected).size, selected.length, 'Unique variants required')
  if (variantIndex >= 0) mapped[variantIndex + 1] = 'studio'
  else mapped.push('--variants', 'studio')
  if (!mapped.includes('--output')) mapped.push('--output', 'artifacts/car-showroom/' + mode)
  return { ...studioOptions(mapped, environment), variants: selected, headless: true }
}

export function showroomUrl(base, variant, gpu = false) {
  assert.ok(variants.includes(variant), 'Invalid showroom variant')
  const url = new URL(keyShadowUrl(base, 'shadow', gpu))
  if (variant === 'showroom') url.searchParams.set('carShowroom', 'cold-studio')
  return url.href
}

export function verifyShowroomState(state, variant, sha256) {
  verifyKeyShadowState(state, 'shadow', sha256)
  const room = state.showroom
  if (variant === 'baseline') {
    assert.ok(!room || room.requested !== true, 'Baseline must retain the old showroom')
    return
  }
  assert.equal(room?.requested, true, 'Actual showroom owner must publish its state')
  assert.equal(room.phase, 'ready', 'Silent fallback is not showroom acceptance')
  assert.equal(room.error, null)
  assert.equal(room.probe?.captures, 6, 'Six actual static room captures required')
  assert.equal(room.probe.resolution, 1024, 'No reduced cubemap resolution')
  assert.equal(state.oldGroundVisible, false, 'No duplicate workbench floor')
  const ids = new Set(state.architecture.map((entry) => entry.id))
  for (const id of [
    'floor',
    'ceiling',
    'back wall',
    'front wall',
    'left wall',
    'right wall',
    'key softbox',
    'strip softbox',
  ])
    assert.ok(ids.has(id), 'Real architecture required: ' + id)
  assert.equal(state.architecture.filter((entry) => /floor cove$/.test(entry.id)).length, 4)
}

export function verifyStaticCapture(before, after) {
  assert.equal(
    after.showroom.probe.captures,
    before.showroom.probe.captures,
    'Camera and car motion must not recapture the room',
  )
  assert.equal(
    after.environment,
    before.environment,
    'Movement must preserve the static environment owner',
  )
}

export function showroomHtmlReport(report) {
  const escape = (value) =>
    String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;')
  const html = htmlReport(report)
    .replaceAll('Reventón studio comparison', 'Reventón cold studio comparison')
    .replace('Car studio · fixed input comparison', 'Car cold studio · same camera comparison')
  const extra = viewNames
    .filter(
      (name) =>
        !['whole', 'paint-body', 'door-right', 'cabin', 'wheel-front', 'separated'].includes(name),
    )
    .map(
      (name) =>
        `<section><h2>${escape(name)}</h2><div class="row">${report.runs
          .map((run) => {
            const capture = run.captures.find((entry) => entry.name === name)
            return `<figure><figcaption>${escape(run.variant)}</figcaption>${capture ? `<a href="${escape(run.variant + '/' + capture.file)}"><img src="${escape(run.variant + '/' + capture.file)}" alt="${escape(name)}"></a>` : '<p>Not captured</p>'}</figure>`
          })
          .join('')}</div></section>`,
    )
    .join('')
  return (
    html +
    extra +
    `<h2>Actual showroom and capture state</h2><pre>${escape(
      JSON.stringify(
        report.runs.map((run) => ({
          variant: run.variant,
          startup: {
            interactiveObservedMs: run.interactiveObservedMs,
            enhancedObservedMs: run.enhancedObservedMs,
            showroomObservedMs: run.showroomObservedMs,
          },
          initial: run.initial?.showroom,
          final: run.final?.showroom,
        })),
        null,
        2,
      ),
    )}</pre>`
  )
}

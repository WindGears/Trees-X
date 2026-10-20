import { resolve, sep } from 'node:path'
import { localAuditOrigin } from '../reventon-performance/audit-origin.mjs'

export const candidateIdentity = {
  id: 'reventon-workbench',
  version: 2,
  manifest: '/models/reventon-runtime-v2/workbench-manifest.json',
  sha256: '0bd2a01fb6f1edc1ddd8a2fa906b8b32981b907b0ab0f651d07a94d688b08ed1',
}

export const originalIdentity = {
  id: 'reventon-workbench',
  version: 1,
  manifest: '/models/reventon/workbench-manifest.json',
  sha256: '28031a60c0e0ce12c6f9e6ba5fdb5ba5b9bf0f17ba0cd8890bba3a46d96f739d',
}

export const resourceAccountingMeaning =
  'Three renderer.info.memory bookkeeping, not native GPU allocation or physical VRAM. Three r185 counts each compressed texture as one byte, so total is incomplete. Count bounds and ledger deltas only describe this fixed-scene resource plateau; model texture logical block storage is reported separately from initialized GPUTexture descriptors.'

export const resourceTolerance = {
  renderTargets: 0,
  geometries: 2,
  attributes: 4,
  programs: 2,
  uniformBuffers: 8,
  textures: 2,
  total: 2 * 1024 * 1024,
}

export function options(environment = process.env) {
  const integer = (name, fallback) => {
    const value = Number(environment[name] ?? fallback)
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid ${name}`)
    return value
  }
  const smoke = environment.REVENTON_STRESS_SMOKE === '1',
    reloads = integer('REVENTON_STRESS_RELOADS', 30),
    seconds = integer('REVENTON_STRESS_SECONDS', 1200),
    scope = environment.REVENTON_STRESS_SCOPE || 'all',
    base = localAuditOrigin(environment.CHECK_URL || 'http://127.0.0.1:5181'),
    output = environment.REVENTON_STRESS_OUTPUT || 'artifacts/car-clean-audit/stress'
  if (!['all', 'reload', 'soak', 'visibility'].includes(scope)) throw new Error('Invalid scope')
  if (!smoke && (reloads < 30 || seconds < 1200))
    throw new Error('Short checks require REVENTON_STRESS_SMOKE=1')
  if (!resolve(output).startsWith(resolve('artifacts') + sep))
    throw new Error('Output must remain inside ignored artifacts/')
  return {
    smoke,
    reloads,
    seconds,
    scope,
    base,
    output,
    headless: environment.REVENTON_STRESS_HEADLESS === '1',
    timeout: integer('REVENTON_STRESS_TIMEOUT', 300000),
  }
}

export function resourceAssessment(entries, baseline) {
  if (!baseline || !entries.length) throw new Error('Fixed resource baseline required')
  const latest = entries.at(-1),
    values = {}
  for (const [key, tolerance] of Object.entries(resourceTolerance)) {
    const value = latest.memory[key],
      initial = baseline[key]
    if (!Number.isFinite(value) || !Number.isFinite(initial))
      throw new Error(`Unavailable Three resource ledger counter: ${key}`)
    const previous = entries.slice(-4).map((entry) => entry.memory[key]),
      deltas = previous.slice(1).map((value, index) => value - previous[index])
    values[key] = {
      value,
      baseline: initial,
      delta: value - initial,
      tolerance,
      exceeded: value - initial > tolerance,
      trailingDeltas: deltas,
      sustainedGrowth:
        deltas.length === 3 && deltas.every((delta) => delta > 0) && value - initial > tolerance,
    }
  }
  const sustained = Object.entries(values)
      .filter(([, value]) => value.sustainedGrowth)
      .map(([key]) => key),
    largeTargetIncrease =
      values.total.delta > 64 * 1024 * 1024 &&
      values.renderTargets.exceeded &&
      values.textures.exceeded
  return {
    index: latest.index,
    accounting: 'Three renderer.info.memory ledger; incomplete byte estimates, not physical VRAM',
    values,
    sustained,
    largeTargetIncrease,
    earlyFailure: largeTargetIncrease || sustained.length > 0,
    withinBaseline: Object.values(values).every((value) => !value.exceeded),
  }
}

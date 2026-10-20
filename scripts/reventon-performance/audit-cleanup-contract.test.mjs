import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { URL } from 'node:url'

// Exercise the script's real finalizer with IPC/file stubs. Importing the whole
// CLI would launch Edge, which is inappropriate for a pure tool contract test.
const source = await readFile(new URL('../reventon-performance-check.mjs', import.meta.url), 'utf8')
const beginning = source.lastIndexOf('} finally {')
const ending = source.indexOf('\n}\nconsole.log(', beginning)
assert.ok(beginning !== -1 && ending > beginning, 'Performance finalizer source is required')
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const finalize = new AsyncFunction(
  'report',
  'options',
  'heartbeat',
  'clearInterval',
  'page',
  'context',
  'browser',
  'boundedAuditAttempt',
  'tracing',
  'finishTrace',
  'writeFile',
  'process',
  source.slice(beginning + '} finally {'.length, ending),
)

async function exercise(results = {}) {
  const events = [],
    writes = [],
    report = { passed: true },
    process = {
      exitCode: 0,
      exit(code) {
        events.push(['exit', code])
      },
    }
  await finalize(
    report,
    { output: 'unused-test-output' },
    null,
    () => {},
    {
      isClosed: () => false,
      evaluate: async () => events.push(['hooks']),
    },
    null,
    { close: async () => events.push(['browser']) },
    async (label, perform) => {
      events.push(['attempt', label])
      if (results[label]) return results[label]
      await perform()
      return { status: 'completed' }
    },
    true,
    async () => events.push(['trace']),
    async (_, json) => {
      events.push(['persist'])
      writes.push(JSON.parse(json))
    },
    process,
  )
  return { events, writes, report, process }
}

test('performance results are persisted before stopping hooks, trace or browser', async () => {
  const value = await exercise()
  assert.deepEqual(value.events[0], ['persist'])
  assert.equal(value.writes[0].cleanup.confirmed, false)
  assert.equal(value.writes[0].cleanup.requiresReview, true)
  assert.equal(value.writes.at(-1).cleanup.confirmed, true)
  assert.equal(value.writes.at(-1).passed, true)
  assert.equal(value.events.filter(([kind]) => kind === 'browser').length, 1)
  assert.equal(value.process.exitCode, 0)
})

test('timing-hook timeout still closes the owned browser and invalidates success', async () => {
  const value = await exercise({
    'Stop test-owned timing hooks': { status: 'timeout', error: 'timing stop stalled' },
  })
  assert.ok(value.events.some(([kind]) => kind === 'browser'))
  assert.equal(value.report.passed, false)
  assert.equal(value.report.cleanup.confirmed, false)
  assert.equal(value.report.cleanup.requiresReview, true)
  assert.equal(value.report.cleanup.hooks.status, 'timeout')
  assert.equal(value.process.exitCode, 1)
})

test('unconfirmed browser close is recorded before ending the audit process', async () => {
  const value = await exercise({
    'Test-owned browser close': { status: 'timeout', error: 'owned browser close stalled' },
  })
  assert.equal(value.writes.at(-1).cleanup.browser.status, 'timeout')
  assert.equal(value.writes.at(-1).passed, false)
  assert.equal(value.report.cleanup.requiresReview, true)
  assert.equal(value.process.exitCode, 1)
  assert.deepEqual(value.events.at(-1), ['exit', 1])
})

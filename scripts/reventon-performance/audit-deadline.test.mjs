import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setTimeout } from 'node:timers/promises'
import { boundedAuditAttempt, withAuditDeadline } from './audit-deadline.mjs'

test('audit waits preserve completed values and original operation failures', async () => {
  assert.equal(await withAuditDeadline('read', () => 42), 42)
  const original = new Error('renderer disconnected')
  await assert.rejects(
    withAuditDeadline('read', () => Promise.reject(original)),
    (error) => {
      assert.equal(error, original)
      return true
    },
  )
  assert.deepEqual(await boundedAuditAttempt('read', () => 42), {
    status: 'completed',
    value: 42,
  })
  const failure = await boundedAuditAttempt('close', () => Promise.reject(original))
  assert.equal(failure.status, 'failed')
  assert.match(failure.error, /renderer disconnected/)
})

test('a stalled browser wait times out without claiming cancellation or cleanup', async () => {
  // This reference keeps the test event loop alive while the deadline is unrefed.
  const alive = setTimeout(50)
  const pending = new Promise(() => {})
  const result = await boundedAuditAttempt('owned close', () => pending, 5)
  assert.equal(result.status, 'timeout')
  assert.match(result.error, /owned close exceeded 5ms/)
  assert.equal('confirmed' in result, false)
  await alive
})

test('a late rejected browser operation is consumed after a deadline', async () => {
  let rejectLate
  const pending = new Promise((_, reject) => {
    rejectLate = reject
  })
  const alive = setTimeout(30)
  await assert.rejects(
    withAuditDeadline('read', () => pending, 5),
    {
      name: 'AuditDeadlineError',
    },
  )
  rejectLate(new Error('late IPC failure'))
  await alive
})

test('invalid deadlines are rejected before invoking browser operations', async () => {
  let invoked = false
  for (const value of [0, -1, NaN, Infinity])
    await assert.rejects(
      withAuditDeadline('read', () => (invoked = true), value),
      /positive audit deadline/,
    )
  assert.equal(invoked, false)
})

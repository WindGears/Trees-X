import { setTimeout, clearTimeout } from 'node:timers'

/** Bounds test IPC waits; timing out does not cancel the browser operation.
 * Callers must stop the procedure and close only their own browser afterwards.
 */
export async function withAuditDeadline(label, perform, milliseconds = 30000) {
  if (!Number.isFinite(milliseconds) || milliseconds < 1)
    throw new Error('A positive audit deadline is required')
  let timer
  try {
    return await Promise.race([
      Promise.resolve().then(perform),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error(`${label} exceeded ${milliseconds}ms`)
          error.name = 'AuditDeadlineError'
          reject(error)
        }, milliseconds)
        timer.unref()
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

export async function boundedAuditAttempt(label, perform, milliseconds = 5000) {
  try {
    return { status: 'completed', value: await withAuditDeadline(label, perform, milliseconds) }
  } catch (error) {
    return {
      status: error?.name === 'AuditDeadlineError' ? 'timeout' : 'failed',
      error: String(error),
    }
  }
}

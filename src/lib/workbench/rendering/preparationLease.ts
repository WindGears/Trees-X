interface LeaseState {
  active: number
  closing: boolean
  flushing: boolean
  cleanup: (() => void)[]
  finalizer?: () => void
  waiters: (() => void)[]
}

const states = new WeakMap<object, LeaseState>()
const retired = new Set<Promise<void>>()

function state(renderer: object) {
  let value = states.get(renderer)
  if (!value) {
    value = { active: 0, closing: false, flushing: false, cleanup: [], waiters: [] }
    states.set(renderer, value)
  }
  return value
}

function flush(value: LeaseState) {
  if (value.active || value.flushing) return
  value.flushing = true
  const errors: unknown[] = []
  // A cleanup may enqueue more cleanup; the renderer finalizer always comes last.
  while (value.cleanup.length) {
    try {
      value.cleanup.shift()!()
    } catch (error) {
      errors.push(error)
    }
  }
  const finalize = value.finalizer
  value.finalizer = undefined
  try {
    finalize?.()
  } catch (error) {
    errors.push(error)
  } finally {
    value.flushing = false
    value.waiters.splice(0).forEach((resolve) => resolve())
  }
  if (errors.length) throw new AggregateError(errors, '三维准备结束后的资源清理失败')
}

/** Native compile cannot be cancelled. Keep its scene owners alive until it settles. */
export async function withPreparationLease<T>(
  renderer: object,
  work: () => Promise<T>,
): Promise<T> {
  const value = state(renderer)
  if (value.closing) throw new Error('三维宿主已关闭，不能继续准备资源')
  value.active++
  try {
    return await work()
  } finally {
    value.active--
    flush(value)
  }
}

/** Executes synchronously if no native preparation is pending. */
export function afterPreparation(renderer: object, cleanup: () => void) {
  const value = state(renderer)
  value.cleanup.push(cleanup)
  flush(value)
}

/** Call before acquiring a successor lease, after its old drawing clock stopped. */
export async function waitForPreparations(renderer: object) {
  const value = states.get(renderer)
  if (!value) return
  while (value.active) await new Promise<void>((resolve) => value.waiters.push(resolve))
}

/** Tres still owns disposal; only the invocation of its native finalizer is delayed. */
export function retirePreparedRenderer(renderer: object, finalizer: () => void) {
  const value = state(renderer)
  if (value.closing) return
  value.closing = true
  value.finalizer = finalizer
  if (value.active) {
    const pending = new Promise<void>((resolve) => value.waiters.push(resolve))
    retired.add(pending)
    void pending.then(() => retired.delete(pending))
  }
  flush(value)
}

/** Host replacement waits for inactive, already-unmounted predecessors to release. */
export async function waitForRetiredPreparations() {
  while (retired.size) await Promise.all([...retired])
}

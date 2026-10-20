import type { RealtimeChange } from '../types'

export const carDdgiSchedule = Object.freeze({ maxUpdatesPerSecond: 15, settleSolves: 12 })

/** A bounded settling policy, not a measured radiometric convergence test.
 * Camera movement does not change the world-space field. All scheduling uses
 * the host's existing clock; no timer, scene traversal or pixel readback lives here.
 */
export function createDdgiScheduler(started: number) {
  let remaining: number = carDdgiSchedule.settleSolves
  let revision = 1,
    sceneDirty = true,
    environmentDirty = true,
    lastWorldChange = started,
    lastStarted = -Infinity,
    submitted = 0,
    completed = 0
  const interval = 1000 / carDdgiSchedule.maxUpdatesPerSecond
  return {
    invalidate(kind: RealtimeChange, now: number) {
      if (kind === 'camera' || kind === 'camera-cut' || kind === 'size') return
      revision++
      remaining = carDdgiSchedule.settleSolves
      if (kind !== 'environment') sceneDirty = true
      if (kind === 'environment' || kind === 'all') environmentDirty = true
      lastWorldChange = now
    },
    needsTick(now: number, ready: boolean) {
      return (!ready || remaining > 0) && now - lastStarted >= interval
    },
    begin(now: number) {
      const work = { revision, scene: sceneDirty, environment: environmentDirty }
      sceneDirty = environmentDirty = false
      lastStarted = now
      submitted++
      return work
    },
    complete(token: number, fullSolve: boolean) {
      if (token !== revision || !fullSolve) return
      remaining = Math.max(0, remaining - 1)
      completed++
    },
    idleMs: (now: number) => Math.max(0, now - lastWorldChange),
    snapshot: () => ({
      policy: 'event-driven-fixed-settling' as const,
      ...carDdgiSchedule,
      remainingSolves: remaining,
      cached: remaining === 0,
      revision,
      submitted,
      completed,
      lastStarted,
      sceneDirty,
      environmentDirty,
    }),
  }
}

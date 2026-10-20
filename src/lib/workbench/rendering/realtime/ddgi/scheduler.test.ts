import { describe, expect, it } from 'vitest'
import { carDdgiSchedule, createDdgiScheduler } from './scheduler'
import type { RealtimeChange } from '../types'

describe('car world-space GI scheduling', () => {
  it('caps accepted updates at 15Hz without accumulating overdue work', () => {
    const schedule = createDdgiScheduler(1000)
    expect(schedule.needsTick(1000, false)).toBe(true)
    schedule.begin(1000)
    expect(schedule.needsTick(1066, false)).toBe(false)
    expect(schedule.needsTick(1067, false)).toBe(true)
    schedule.begin(1067)
    expect(schedule.needsTick(1100, false)).toBe(false)
    schedule.begin(5000)
    expect(schedule.needsTick(5001, false)).toBe(false)
  })

  it('continues initialization and queued rebuilds regardless of remaining settling work', () => {
    const schedule = createDdgiScheduler(0)
    for (let index = 0; index < carDdgiSchedule.settleSolves + 3; index++) {
      const now = index * 100
      expect(schedule.needsTick(now, false)).toBe(true)
      const work = schedule.begin(now)
      schedule.complete(work.revision, false)
    }
    expect(schedule.snapshot().remainingSolves).toBe(carDdgiSchedule.settleSolves)
  })

  it('reuses cached GI through camera motion, cuts and output size changes', () => {
    const schedule = createDdgiScheduler(0)
    for (let index = 0; index < carDdgiSchedule.settleSolves; index++) {
      const work = schedule.begin(index * 100)
      schedule.complete(work.revision, true)
    }
    for (const change of ['camera', 'camera-cut', 'size'] as const) {
      schedule.invalidate(change, 2000)
      expect(schedule.needsTick(2100, true)).toBe(false)
    }
    expect(schedule.snapshot()).toMatchObject({
      cached: true,
      sceneDirty: false,
      environmentDirty: false,
    })
    expect(schedule.idleMs(2200)).toBe(2200)
  })

  it.each<RealtimeChange>(['pose', 'pose-jump', 'materials', 'lights', 'environment', 'all'])(
    'wakes and restarts settling for actual %s changes',
    (change) => {
      const schedule = createDdgiScheduler(0)
      for (let index = 0; index < carDdgiSchedule.settleSolves; index++) {
        const work = schedule.begin(index * 100)
        schedule.complete(work.revision, true)
      }
      schedule.invalidate(change, 2000)
      expect(schedule.needsTick(2001, true)).toBe(true)
      const work = schedule.begin(2001)
      expect(work).toMatchObject({
        scene: change !== 'environment',
        environment: change === 'environment' || change === 'all',
      })
      expect(schedule.snapshot().remainingSolves).toBe(carDdgiSchedule.settleSolves)
      expect(schedule.idleMs(2012)).toBe(12)
    },
  )

  it('consumes dirty scene inputs once and leaves settling solves traversal-free', () => {
    const schedule = createDdgiScheduler(0)
    expect(schedule.begin(0)).toMatchObject({ scene: true, environment: true })
    expect(schedule.begin(100)).toMatchObject({ scene: false, environment: false })
    schedule.invalidate('pose', 120)
    expect(schedule.begin(200)).toMatchObject({ scene: true, environment: false })
    expect(schedule.begin(300)).toMatchObject({ scene: false, environment: false })
  })

  it('retains changes arriving during an asynchronous older solve', () => {
    const schedule = createDdgiScheduler(0),
      old = schedule.begin(0)
    schedule.invalidate('environment', 10)
    schedule.complete(old.revision, true)
    expect(schedule.snapshot()).toMatchObject({
      remainingSolves: 12,
      sceneDirty: false,
      environmentDirty: true,
    })
    const next = schedule.begin(100)
    schedule.complete(next.revision, true)
    expect(schedule.snapshot().remainingSolves).toBe(11)
  })
})

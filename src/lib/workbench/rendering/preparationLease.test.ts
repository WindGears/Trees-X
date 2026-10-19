import { describe, expect, it, vi } from 'vitest'
import {
  afterPreparation,
  retirePreparedRenderer,
  waitForPreparations,
  waitForRetiredPreparations,
  withPreparationLease,
} from './preparationLease'

function deferred() {
  let resolve!: () => void, reject!: (error: Error) => void
  const promise = new Promise<void>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

describe('renderer preparation resource lifetime', () => {
  it('waits for a stopped host to become quiescent before a successor may acquire its lease', async () => {
    const renderer = {},
      native = deferred(),
      events: string[] = []
    const old = withPreparationLease(renderer, () => native.promise)
    afterPreparation(renderer, () => events.push('old owners'))
    const successor = waitForPreparations(renderer).then(() =>
      withPreparationLease(renderer, async () => {
        events.push('successor')
      }),
    )
    await Promise.resolve()
    expect(events).toEqual([])
    native.resolve()
    await Promise.all([old, successor])
    expect(events).toEqual(['old owners', 'successor'])
  })
  it('waits for all submitted work, cleans scene owners, then disposes the renderer once', async () => {
    const renderer = {},
      first = deferred(),
      second = deferred(),
      events: string[] = []
    const one = withPreparationLease(renderer, () => first.promise)
    const two = withPreparationLease(renderer, () => second.promise)
    afterPreparation(renderer, () => events.push('runtime'))
    afterPreparation(renderer, () => events.push('source'))
    retirePreparedRenderer(renderer, () => events.push('renderer'))
    retirePreparedRenderer(renderer, () => events.push('duplicate'))
    let retired = false
    const done = waitForRetiredPreparations().then(() => {
      retired = true
    })
    await expect(withPreparationLease(renderer, async () => {})).rejects.toThrow('已关闭')
    first.resolve()
    await one
    expect(events).toEqual([])
    expect(retired).toBe(false)
    second.resolve()
    await two
    await done
    expect(events).toEqual(['runtime', 'source', 'renderer'])
    expect(retired).toBe(true)
  })
  it('also releases deferred owners after rejected native work without hiding the failure', async () => {
    const renderer = {},
      native = deferred(),
      cleanup = vi.fn(),
      finalizer = vi.fn()
    const pending = withPreparationLease(renderer, () => native.promise)
    const failure = new Error('compile failed'),
      rejected = expect(pending).rejects.toBe(failure)
    afterPreparation(renderer, cleanup)
    retirePreparedRenderer(renderer, finalizer)
    native.reject(failure)
    await rejected
    await waitForRetiredPreparations()
    expect(cleanup).toHaveBeenCalledOnce()
    expect(finalizer).toHaveBeenCalledOnce()
  })
  it('keeps the no-preparation disposal path synchronous', () => {
    const renderer = {},
      events: string[] = []
    afterPreparation(renderer, () => events.push('source'))
    retirePreparedRenderer(renderer, () => events.push('renderer'))
    expect(events).toEqual(['source', 'renderer'])
  })
  it('finishes all cleanup and renderer disposal if one owner throws', async () => {
    const renderer = {},
      native = deferred(),
      events: string[] = []
    const pending = withPreparationLease(renderer, () => native.promise)
    afterPreparation(renderer, () => {
      events.push('broken')
      throw new Error('dispose failed')
    })
    afterPreparation(renderer, () => events.push('source'))
    retirePreparedRenderer(renderer, () => events.push('renderer'))
    const rejected = expect(pending).rejects.toThrow('资源清理失败')
    native.resolve()
    await rejected
    await waitForRetiredPreparations()
    expect(events).toEqual(['broken', 'source', 'renderer'])
  })
  it('runs cleanup enqueued by another owner before the renderer finalizer', async () => {
    const renderer = {},
      native = deferred(),
      events: string[] = []
    const pending = withPreparationLease(renderer, () => native.promise)
    afterPreparation(renderer, () => {
      events.push('runtime')
      afterPreparation(renderer, () => events.push('nested'))
    })
    retirePreparedRenderer(renderer, () => events.push('renderer'))
    native.resolve()
    await pending
    expect(events).toEqual(['runtime', 'nested', 'renderer'])
  })
})

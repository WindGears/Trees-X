import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { parseProduct } from './api'
import { LatestRequest } from './latest'
const samples: unknown[] = JSON.parse(
  readFileSync('server/src/main/resources/samples/products.json', 'utf8'),
)
describe('workbench contract', () => {
  it('accepts the three source scripts and rejects bad guides, versions and camera values', () => {
    expect(samples.map((s) => parseProduct(s).slug)).toEqual([
      'form-01',
      'typewriter-study',
      'reventon',
    ])
    const p = parseProduct(samples[0])
    p.presentation.guide[1]!.hotspotId = 'missing'
    expect(() => parseProduct(p)).toThrow('导览')
    expect(() => parseProduct({ ...p, presentation: { ...p.presentation, version: 3 } })).toThrow(
      '版本',
    )
    const camera = { ...p.presentation.camera, position: [Infinity, 0, 1] }
    expect(() => parseProduct({ ...p, presentation: { ...p.presentation, camera } })).toThrow(
      '数值',
    )
  })
  it('ignores an old success and failure after a new selection, including abort-resistant transport', async () => {
    const latest = new LatestRequest(),
      accept = vi.fn(),
      fail = vi.fn()
    let resolve!: (value: string) => void
    const first = latest.run(
      () =>
        new Promise<string>((r) => {
          resolve = r
        }),
      accept,
      fail,
    )
    await latest.run(async () => 'current', accept, fail)
    resolve('old')
    await first
    expect(accept.mock.calls).toEqual([['current']])
    let reject!: (value: Error) => void
    const cancelled = latest.run(
      () =>
        new Promise<string>((_, r) => {
          reject = r
        }),
      accept,
      fail,
    )
    latest.cancel()
    reject(new Error('late'))
    await cancelled
    expect(fail).not.toHaveBeenCalled()
  })
})

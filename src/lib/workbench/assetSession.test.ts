import { afterEach, describe, expect, it, vi } from 'vitest'
import { sha256, type AssetBundle } from './assetBundle'
import { openAssetSession, openLegacyAssetSession, useStreamingAssets } from './assetSession'
import { verifiedByteResidency } from './assetResidency'
import { readFileSync } from 'node:fs'
import type { GlbSource } from './types'

async function fixture() {
  const data = new Map([
    ['model.glb', new TextEncoder().encode('model').buffer],
    ['one.png', new TextEncoder().encode('one').buffer],
    ['two.png', new TextEncoder().encode('two').buffer],
  ])
  const bundle: AssetBundle = {
    schemaVersion: 1,
    id: 'session',
    version: 1,
    entry: 'model.glb',
    files: await Promise.all(
      [...data].map(async ([path, bytes]) => ({
        path,
        bytes: bytes.byteLength,
        sha256: await sha256(bytes),
        role: path.endsWith('glb') ? ('model' as const) : ('texture' as const),
      })),
    ),
    budget: { maxBytes: 100, maxTriangles: 100 },
    provenance: { author: 'test', source: 'test', license: 'test', redistribution: 'test' },
  }
  const manifest = new TextEncoder().encode(JSON.stringify(bundle)).buffer
  const ref = {
    id: bundle.id,
    version: 1,
    manifest: '/models/session/manifest.json',
    sha256: await sha256(manifest),
  }
  const fetcher = vi.fn(async (path: string) => {
    const name = path.split('/').at(-1)!
    return new Response(name === 'manifest.json' ? manifest : data.get(name))
  })
  vi.stubGlobal('fetch', fetcher)
  return { data, ref, fetcher, manifest }
}

afterEach(() => vi.unstubAllGlobals())

describe('cancellable verified file sessions', () => {
  it('gates streaming behind an explicit query and the audited original car bundle', () => {
    const source = (
      JSON.parse(
        readFileSync('server/src/main/resources/presentations/reventon-workbench-v1.json', 'utf8'),
      ) as { presentation: { source: GlbSource } }
    ).presentation.source
    expect(useStreamingAssets(source, '?assetLoading=streaming')).toBe(true)
    expect(useStreamingAssets(source, '')).toBe(false)
    expect(useStreamingAssets({ ...source, adapter: 'piano-v1' }, '?assetLoading=streaming')).toBe(
      false,
    )
    for (const bundle of [
      { ...source.bundle, sha256: '0'.repeat(64) },
      { ...source.bundle, manifest: '/models/custom/manifest.json' },
      { ...source.bundle, version: 2 },
      { ...source.bundle, id: 'custom' },
    ])
      expect(useStreamingAssets({ ...source, bundle }, '?assetLoading=streaming')).toBe(false)
  })
  it('retains the all-package compatibility barrier by default', async () => {
    const f = await fixture()
    const session = await openLegacyAssetSession(f.ref, new AbortController().signal, vi.fn())
    expect(f.fetcher).toHaveBeenCalledTimes(4)
    expect(verifiedByteResidency.bytes).toBe(0)
    expect(new TextDecoder().decode(await session.read('one.png'))).toBe('one')
    session.release('one.png')
    await expect(session.read('one.png')).rejects.toThrow('缺少文件')
    session.dispose()
  })
  it('allows three verified downloads to overlap before decode consumes them', async () => {
    const f = await fixture()
    const session = await openAssetSession(f.ref, new AbortController().signal, vi.fn())
    let active = 0,
      maximum = 0
    const finish: (() => void)[] = []
    f.fetcher.mockImplementation(async (path) => {
      active++
      maximum = Math.max(maximum, active)
      await new Promise<void>((resolve) => finish.push(resolve))
      active--
      return new Response(f.data.get(path.split('/').at(-1)!))
    })
    const reads = Promise.all([...f.data.keys()].map((path) => session.read(path)))
    await vi.waitFor(() => expect(finish).toHaveLength(3))
    expect(maximum).toBe(3)
    finish.forEach((resolve) => resolve())
    await reads
    session.dispose()
    expect(verifiedByteResidency.bytes).toBe(0)
  })
  it('loads only requested dependencies, shares concurrent reads, releases and rereads', async () => {
    const f = await fixture(),
      phase = vi.fn()
    const session = await openAssetSession(f.ref, new AbortController().signal, phase)
    expect(f.fetcher).toHaveBeenCalledTimes(1)
    const first = session.read('model.glb'),
      same = session.read('model.glb')
    expect(first).toBe(same)
    expect(new TextDecoder().decode(await first)).toBe('model')
    expect(f.fetcher).toHaveBeenCalledTimes(2)
    expect(verifiedByteResidency.bytes).toBe(5)
    session.release('model.glb')
    session.release('model.glb')
    expect(verifiedByteResidency.bytes).toBe(0)
    await session.read('model.glb')
    expect(f.fetcher).toHaveBeenCalledTimes(3)
    expect(f.fetcher.mock.calls.every(([path]) => path.startsWith('/models/session/'))).toBe(true)
    expect(phase.mock.calls.flat()).toEqual(['manifest', 'download'])
    session.dispose()
    session.dispose()
    expect(verifiedByteResidency.bytes).toBe(0)
    expect(() => session.read('one.png')).toThrow()
  })
  it('rejects an unregistered path without requesting it', async () => {
    const f = await fixture()
    const session = await openAssetSession(f.ref, new AbortController().signal, vi.fn())
    await expect(session.read('../escape.png')).rejects.toThrow('包外')
    expect(f.fetcher).toHaveBeenCalledTimes(1)
    session.dispose()
  })
  it('rejects corrupted files, cancels siblings and frees completed bytes', async () => {
    const f = await fixture()
    const session = await openAssetSession(f.ref, new AbortController().signal, vi.fn())
    await session.read('model.glb')
    f.fetcher.mockImplementation(async () => new Response('bad'))
    await expect(session.read('one.png')).rejects.toThrow('校验失败')
    expect(session.signal.aborted).toBe(true)
    expect(verifiedByteResidency.bytes).toBe(0)
    session.dispose()
  })
  it('rejects a late response after disposal and holds its reservation until settling', async () => {
    const f = await fixture(),
      abort = new AbortController()
    const session = await openAssetSession(f.ref, abort.signal, vi.fn())
    let finish!: (response: Response) => void
    f.fetcher.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const read = session.read('one.png')
    const rejected = expect(read).rejects.toThrow()
    await vi.waitFor(() => expect(f.fetcher).toHaveBeenCalledTimes(2))
    expect(verifiedByteResidency.bytes).toBe(3)
    abort.abort()
    expect(verifiedByteResidency.bytes).toBe(3)
    finish(new Response(f.data.get('one.png')))
    await rejected
    expect(verifiedByteResidency.bytes).toBe(0)
  })
  it('does not retain a released in-flight read or accept bytes into a disposed session', async () => {
    const f = await fixture()
    const session = await openAssetSession(f.ref, new AbortController().signal, vi.fn())
    let finish!: (response: Response) => void
    f.fetcher.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const pending = session.read('two.png')
    await vi.waitFor(() => expect(f.fetcher).toHaveBeenCalledTimes(2))
    session.release('two.png')
    finish(new Response(f.data.get('two.png')))
    expect(new TextDecoder().decode(await pending)).toBe('two')
    expect(verifiedByteResidency.bytes).toBe(0)
    session.dispose()
  })
})

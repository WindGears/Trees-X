import { readFile } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, ref } from 'vue'
import type { EffectScope } from 'vue'
import { Mesh } from 'three'
import { useModelLoader } from './useModelLoader'
import { demoProduct } from '@/data/products'
import { createModelPresentation } from '@/lib/three/presentation'
import type { Material } from 'three'

const bytes = await readFile(new URL('../../public/models/form-01.glb', import.meta.url))
const response = () => new Response(new Uint8Array(bytes))
let scope: EffectScope

beforeEach(() => {
  scope = effectScope()
  vi.stubGlobal('window', { setTimeout, clearTimeout, location: { href: 'http://localhost/' } })
})
afterEach(() => {
  scope.stop()
  vi.unstubAllGlobals()
})

describe('GLB request lifecycle', () => {
  it('releases presentation before original resources on retry and unmount', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => Promise.resolve(response())),
    )
    const released: string[] = []
    const result = scope.run(() =>
      useModelLoader(ref('/models/form-01.glb'), (root) => {
        const chassis = root.getObjectByName('Chassis') as Mesh
        ;(chassis.material as Material).addEventListener('dispose', () => released.push('original'))
        const presentation = createModelPresentation(root, demoProduct)
        ;(chassis.material as Material).addEventListener('dispose', () => released.push('clone'))
        return () => {
          presentation.dispose()
          released.push('cleanup')
        }
      }),
    )!
    await vi.waitFor(() => expect(result.status.value).toBe('ready'))
    await result.retry()
    expect(released).toEqual(['clone', 'cleanup', 'original'])
    scope.stop()
    expect(released).toEqual(['clone', 'cleanup', 'original', 'clone', 'cleanup', 'original'])
  })
  it('loads the real sample and releases its geometry when the owning scope ends', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response()))
    const result = scope.run(() => useModelLoader(ref('/models/form-01.glb')))!
    await vi.waitFor(() => expect(result.status.value).toBe('ready'))
    const mesh = result.model.value?.getObjectByName('Chassis') as Mesh
    const dispose = vi.spyOn(mesh.geometry, 'dispose')
    scope.stop()
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('exposes an HTTP error and can recover with retry', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(response())
    vi.stubGlobal('fetch', fetch)
    const result = scope.run(() => useModelLoader(ref('/missing.glb')))!
    await vi.waitFor(() => expect(result.status.value).toBe('error'))
    expect(result.error.value).toContain('404')
    await result.retry()
    expect(result.status.value).toBe('ready')
    expect(result.error.value).toBe('')
  })

  it('rejects HTML returned by a static host fallback', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>not a model</html>')))
    const result = scope.run(() => useModelLoader(ref('/wrong.glb')))!
    await vi.waitFor(() => expect(result.status.value).toBe('error'))
    expect(result.error.value).toContain('不是有效的 GLB')
  })

  it('aborts unmounted requests and never publishes a late model', async () => {
    let resolve: (response: Response) => void = () => {}
    let signal: AbortSignal | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, options: RequestInit) => {
        signal = options.signal ?? undefined
        return new Promise<Response>((done) => {
          resolve = done
        })
      }),
    )
    const result = scope.run(() => useModelLoader(ref('/delayed.glb')))!
    scope.stop()
    expect(signal?.aborted).toBe(true)
    resolve(response())
    await new Promise((done) => setTimeout(done, 100))
    expect(result.model.value).toBeNull()
  })
})

import { afterEach, expect, it, vi } from 'vitest'
import { Color, PerspectiveCamera, RenderTarget, Scene } from 'three'
import { vec2 } from 'three/tsl'
import type { WebGPURenderer } from 'three/webgpu'
import { createOwnedRtt } from './ownedRtt'
import { createRealtimeSignals } from './signals'

vi.mock('./ownedRtt', async (importOriginal) => {
  const source = await importOriginal<typeof import('./ownedRtt')>()
  return { ...source, createOwnedRtt: vi.fn(source.createOwnedRtt) }
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('retains the complete reflection, DOF and presentation graph across repeated pose cuts', () => {
  vi.stubGlobal('location', { search: '?loungeSpatial=box&loungeDof=1' })
  vi.stubGlobal('window', { location })
  vi.stubGlobal('Image', class {})
  const renderer = {
    getRenderTarget: () => null,
    getActiveCubeFace: () => 0,
    getActiveMipmapLevel: () => 0,
    getRenderObjectFunction: () => null,
    getPixelRatio: () => 1,
    getMRT: () => null,
    getClearColor: (value: Color) => value.set(0),
    getClearAlpha: () => 0,
    getScissorTest: () => false,
  } as unknown as WebGPURenderer
  const signals = createRealtimeSignals(renderer, new Scene(), new PerspectiveCamera(), vec2(0)),
    allocationCount = vi.mocked(createOwnedRtt).mock.calls.length,
    targetDisposals = vi.spyOn(RenderTarget.prototype, 'dispose')
  try {
    expect(allocationCount).toBeGreaterThan(2)
    for (let iteration = 0; iteration < 50; iteration++) signals.resetHistory()
    expect(vi.mocked(createOwnedRtt).mock.calls).toHaveLength(allocationCount)
    expect(targetDisposals).not.toHaveBeenCalled()
    expect(signals.snapshot()).toEqual({ ssr: true, ssgi: true, denoise: true })
  } finally {
    signals.dispose()
  }
  expect(targetDisposals).toHaveBeenCalled()
})

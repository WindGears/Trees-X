import { afterEach, expect, it, vi } from 'vitest'
import { Color, PerspectiveCamera, RenderTarget, Scene, Texture } from 'three'
import { vec2 } from 'three/tsl'
import type { WebGPURenderer } from 'three/webgpu'
import { createOwnedRtt } from './ownedRtt'
import { createRealtimeSignals } from './signals'
import { reventonRealtimeProfile, typewriterRealtimeProfile } from './productProfile'
import { setShowroomEnvironment } from '../carShowroom/binding'
import { coldStudioConfig } from '../carShowroom/config'

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
    expect(signals.snapshot()).toEqual({
      ssr: true,
      ssgi: true,
      denoise: true,
      showroomBloom: false,
    })
  } finally {
    signals.dispose()
  }
  expect(targetDisposals).toHaveBeenCalled()
})

it('does not apply lounge DOF to cars and changes it only on a registered product handoff', () => {
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
  const scene = new Scene(),
    signals = createRealtimeSignals(
      renderer,
      scene,
      new PerspectiveCamera(),
      vec2(0),
      reventonRealtimeProfile,
    )
  try {
    expect(scene.userData.loungeDof.enabled).toBe(false)
    const allocations = vi.mocked(createOwnedRtt).mock.calls.length
    signals.setProfile(reventonRealtimeProfile)
    expect(vi.mocked(createOwnedRtt).mock.calls).toHaveLength(allocations)
    signals.setProfile(typewriterRealtimeProfile)
    expect(scene.userData.loungeDof.enabled).toBe(true)
    signals.setProfile(reventonRealtimeProfile)
    expect(scene.userData.loungeDof.enabled).toBe(false)
  } finally {
    signals.dispose()
  }
  expect(scene.userData.loungeDof).toBeUndefined()
})

it('owns showroom bloom targets once and preserves them across pose cuts', () => {
  vi.stubGlobal('location', { search: '' })
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
  const scene = new Scene(),
    texture = new Texture(),
    irradiance = new Texture()
  setShowroomEnvironment(scene, { texture, irradiance, config: coldStudioConfig })
  const signals = createRealtimeSignals(renderer, scene, new PerspectiveCamera(), vec2(0)),
    disposal = vi.spyOn(RenderTarget.prototype, 'dispose'),
    sourceDispose = vi.spyOn(texture, 'dispose')
  expect(signals.snapshot().showroomBloom).toBe(true)
  for (let index = 0; index < 50; index++) signals.resetHistory()
  expect(disposal).not.toHaveBeenCalled()
  signals.dispose()
  const released = disposal.mock.calls.length
  expect(released).toBeGreaterThan(11)
  signals.dispose()
  expect(disposal).toHaveBeenCalledTimes(released)
  expect(sourceDispose).not.toHaveBeenCalled()
  setShowroomEnvironment(scene)
  texture.dispose()
  irradiance.dispose()
})

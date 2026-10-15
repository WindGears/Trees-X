import { describe, expect, it, vi } from 'vitest'
import { PerspectiveCamera, Texture } from 'three'
import { texture } from 'three/tsl'
import type { WebGPURenderer } from 'three/webgpu'
import { createReflectionResolve } from './reflectionResolve'
import { createReflectionSampling } from './reflectionSampling'

const factories = vi.hoisted(() => ({ spatial: vi.fn(), history: vi.fn() }))
vi.mock('./signedSpatial', () => ({ createSignedReflectionSpatial: factories.spatial }))
vi.mock('./signedHistory', () => ({ createSignedReflectionHistory: factories.history }))

describe('reflection resolver construction rollback', () => {
  it('releases the completed spatial owner when history initialization rejects', () => {
    const source = new Texture(),
      node = texture(source),
      dispose = vi.fn(),
      sourceDispose = vi.spyOn(source, 'dispose')
    factories.spatial.mockReturnValue({ raw: node, node, dispose })
    factories.history.mockImplementation(() => {
      throw new Error('native depth rejected')
    })
    expect(() =>
      createReflectionResolve(
        {} as WebGPURenderer,
        node,
        node,
        node,
        node,
        node,
        new PerspectiveCamera(),
      ),
    ).toThrow('native depth rejected')
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(sourceDispose).not.toHaveBeenCalled()
    source.dispose()
  })

  it('advances sampling only after all history GPU copies commit, and borrows its inputs', () => {
    const source = new Texture(),
      node = texture(source),
      sampling = createReflectionSampling(),
      sourceDispose = vi.spyOn(source, 'dispose'),
      spatialDispose = vi.fn(sampling.dispose),
      spatialCancel = vi.fn(sampling.cancelFrame),
      historyPrepare = vi.fn(),
      historyCommit = vi.fn(),
      historyCancel = vi.fn(),
      historyDispose = vi.fn()
    factories.spatial.mockReturnValue({
      raw: node,
      node,
      ...sampling,
      cancelFrame: spatialCancel,
      dispose: spatialDispose,
    })
    factories.history.mockReturnValue({
      node,
      prepare: historyPrepare,
      commitFrame: historyCommit,
      cancelFrame: historyCancel,
      dispose: historyDispose,
    })
    const owner = createReflectionResolve(
      {} as WebGPURenderer,
      node,
      node,
      node,
      node,
      node,
      new PerspectiveCamera(),
    )
    historyPrepare.mockImplementationOnce(() => {
      throw new Error('allocation failed')
    })
    expect(() => owner.prepare(1440, 1000)).toThrow('allocation failed')
    expect(owner.snapshot()).toMatchObject({ frames: 0, prepared: false })
    owner.prepare(1440, 1000)
    historyCommit.mockImplementationOnce(() => {
      throw new Error('GPU copy failed')
    })
    expect(() => owner.commitFrame()).toThrow('GPU copy failed')
    expect(owner.snapshot()).toMatchObject({ frames: 0, prepared: false })
    owner.cancelFrame()
    expect(historyCancel).toHaveBeenCalledTimes(1)
    owner.prepare(1440, 1000)
    owner.commitFrame()
    expect(owner.snapshot().frames).toBe(1)
    owner.prepare(1440, 1000)
    const retryPhase = owner.snapshot().phase
    owner.cancelFrame()
    owner.prepare(1440, 1000)
    expect(owner.snapshot().phase).toBe(retryPhase)
    owner.commitFrame()
    expect(owner.snapshot().frames).toBe(2)
    expect(historyPrepare).toHaveBeenLastCalledWith(1440, 1000)
    expect(spatialCancel).toHaveBeenCalledTimes(4)
    owner.dispose()
    owner.dispose()
    expect(spatialDispose).toHaveBeenCalledTimes(1)
    expect(historyDispose).toHaveBeenCalledTimes(1)
    expect(sourceDispose).not.toHaveBeenCalled()
    source.dispose()
  })
})

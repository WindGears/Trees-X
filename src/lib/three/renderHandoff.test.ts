import { expect, it, vi } from 'vitest'
import { PerspectiveCamera, Scene } from 'three'
import { acquireComposerHandoff } from './renderHandoff'

it('returns rendering to the existing renderer after composer disposal', () => {
  const scene = new Scene(),
    camera = new PerspectiveCamera()
  const host = {
    instance: { render: vi.fn(), setRenderTarget: vi.fn(), autoClear: false },
    replaceRenderFunction: vi.fn(),
  }
  const invalidate = vi.fn(),
    notify = vi.fn()
  const release = acquireComposerHandoff(
    host,
    () => scene,
    () => camera,
    invalidate,
  )
  release()
  release()
  expect(host.instance.setRenderTarget).toHaveBeenCalledExactlyOnceWith(null)
  expect(host.instance.autoClear).toBe(true)
  expect(host.replaceRenderFunction).toHaveBeenCalledOnce()
  host.replaceRenderFunction.mock.calls[0]![0](notify)
  expect(host.instance.render).toHaveBeenCalledExactlyOnceWith(scene, camera)
  expect(notify).toHaveBeenCalledOnce()
  expect(invalidate).toHaveBeenCalledOnce()
})

it('does not let a late old unmount override the new composer owner', () => {
  const host = {
    instance: { render: vi.fn(), setRenderTarget: vi.fn(), autoClear: false },
    replaceRenderFunction: vi.fn(),
  }
  const scene = new Scene()
  const old = acquireComposerHandoff(
    host,
    () => scene,
    () => undefined,
    vi.fn(),
  )
  const latest = acquireComposerHandoff(
    host,
    () => scene,
    () => undefined,
    vi.fn(),
  )
  old()
  expect(host.replaceRenderFunction).not.toHaveBeenCalled()
  latest()
  const notify = vi.fn()
  host.replaceRenderFunction.mock.calls[0]![0](notify)
  expect(host.instance.render).not.toHaveBeenCalled()
  expect(notify).not.toHaveBeenCalled()
})

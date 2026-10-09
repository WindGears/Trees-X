// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { supportsWebGL2 } from './renderSupport'
afterEach(() => vi.restoreAllMocks())
it('releases a successful detached probe and never mounts a canvas', () => {
  const loseContext = vi.fn()
  const getExtension = vi.fn(() => ({ loseContext }))
  const probe = vi
    .spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockReturnValue({ getExtension } as unknown as WebGL2RenderingContext)
  expect(supportsWebGL2()).toBe(true)
  expect(probe).toHaveBeenCalledWith('webgl2')
  expect(getExtension).toHaveBeenCalledWith('WEBGL_lose_context')
  expect(loseContext).toHaveBeenCalledOnce()
  expect(document.querySelector('canvas')).toBeNull()
})
it('handles missing and denied contexts without throwing', () => {
  const probe = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  expect(supportsWebGL2()).toBe(false)
  probe.mockImplementation(() => {
    throw new Error('Context blocked')
  })
  expect(supportsWebGL2()).toBe(false)
})

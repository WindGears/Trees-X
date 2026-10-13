import { describe, expect, it } from 'vitest'
import { recoveryBackend, requestedBackend } from './hostPolicy'

describe('workbench render host policy', () => {
  it('keeps the verified entry and explicit rollback on WebGL', () => {
    expect(requestedBackend('', true, true)).toBe('webgl')
    expect(requestedBackend('?renderPipeline=webgl', true, true)).toBe('webgl')
    expect(requestedBackend('?renderPipeline=hybrid', true, true)).toBe('webgpu')
    expect(requestedBackend('?renderPipeline=realtime', true, true)).toBe('webgpu')
  })
  it('does not request GPU resources for mobile or unsupported devices', () => {
    expect(requestedBackend('?renderPipeline=hybrid', false, true)).toBe('webgl')
    expect(requestedBackend('?renderPipeline=hybrid', true, false)).toBe('webgl')
    expect(requestedBackend('?renderPipeline=realtime', false, true)).toBe('webgl')
    expect(requestedBackend('?renderPipeline=realtime', true, false)).toBe('webgl')
  })
  it('rebuilds a GPU host once before falling back, never toggles WebGL', () => {
    expect(recoveryBackend('webgpu', 0)).toBe('webgpu')
    expect(recoveryBackend('webgpu', 1)).toBe('webgl')
    expect(recoveryBackend('webgl', 0)).toBe('webgl')
  })
})

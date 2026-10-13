import { describe, expect, it, vi } from 'vitest'
import { createRealtimeClock } from './clock'

function fixture() {
  const calls: string[] = []
  const nodeFrame = {
    frameId: 7,
    lastTime: 100 as number | undefined,
    update: vi.fn(() => {
      calls.push('update')
      nodeFrame.frameId += 1
      nodeFrame.lastTime = 200
    }),
  }
  const renderer = {
    isWebGPURenderer: true,
    initialized: true,
    _animation: { stop: vi.fn(() => calls.push('stop')) },
    _nodes: { nodeFrame },
    _inspector: {
      begin: vi.fn(() => calls.push('begin')),
      finish: vi.fn(() => calls.push('finish')),
    },
    info: { autoReset: true, frame: 7, reset: vi.fn(() => calls.push('reset')) },
  }
  return { calls, nodeFrame, renderer }
}

describe('realtime clock bridge', () => {
  it('stops the renderer RAF once and wraps every pass in one frame update', () => {
    const { calls, nodeFrame, renderer } = fixture()
    const clock = createRealtimeClock(renderer)
    expect(nodeFrame.lastTime).toBeUndefined()
    const result = clock.frame(() => {
      calls.push('shadow', 'gbuffer', 'filter', 'present')
      return 123
    })
    expect(result).toBe(123)
    expect(calls).toEqual([
      'stop',
      'reset',
      'update',
      'begin',
      'shadow',
      'gbuffer',
      'filter',
      'present',
      'finish',
    ])
    expect(renderer.info.frame).toBe(8)
    clock.frame(() => {})
    expect(renderer._animation.stop).toHaveBeenCalledTimes(1)
    expect(nodeFrame.update).toHaveBeenCalledTimes(2)
    expect(renderer.info.frame).toBe(9)
    clock.dispose()
  })

  it('honors manual info reset and always finishes an entered inspector frame', () => {
    const { renderer } = fixture()
    renderer.info.autoReset = false
    const clock = createRealtimeClock(renderer)
    expect(() =>
      clock.frame(() => {
        throw new Error('presentation failed')
      }),
    ).toThrow('presentation failed')
    expect(renderer.info.reset).not.toHaveBeenCalled()
    expect(renderer._inspector.finish).toHaveBeenCalledTimes(1)
    clock.frame(() => {})
    expect(renderer._inspector.finish).toHaveBeenCalledTimes(2)
    clock.dispose()
  })

  it('pauses without advancing frames and resumes without counting hidden time', () => {
    const { nodeFrame, renderer } = fixture()
    const clock = createRealtimeClock(renderer)
    clock.frame(() => {})
    clock.pause()
    expect(clock.active).toBe(false)
    expect(() => clock.frame(() => {})).toThrow('paused')
    expect(nodeFrame.frameId).toBe(8)
    clock.pause()
    clock.resume()
    expect(clock.active).toBe(true)
    expect(nodeFrame.lastTime).toBeUndefined()
    clock.frame(() => {})
    expect(nodeFrame.frameId).toBe(9)
    clock.resume()
    expect(nodeFrame.lastTime).toBe(200)
    expect(renderer._animation.stop).toHaveBeenCalledTimes(1)
    clock.dispose()
  })

  it('rejects unknown versions and private shapes before stopping animation', () => {
    const { renderer } = fixture()
    expect(() => createRealtimeClock(renderer, '186')).toThrow('r185')
    expect(() => createRealtimeClock({ ...renderer, _nodes: null })).toThrow('internals')
    expect(() => createRealtimeClock({ ...renderer, _inspector: { begin() {} } })).toThrow(
      'internals',
    )
    expect(() => createRealtimeClock({ ...renderer, initialized: false })).toThrow('initialized')
    expect(() => createRealtimeClock(null)).toThrow('initialized')
    expect(renderer._animation.stop).not.toHaveBeenCalled()
  })

  it('rejects duplicate ownership, nested frames and asynchronous submission', () => {
    const { renderer } = fixture()
    const clock = createRealtimeClock(renderer)
    expect(() => createRealtimeClock(renderer)).toThrow('already owns')
    expect(() => clock.frame(() => clock.frame(() => {}))).toThrow('nested frame')
    expect(renderer._nodes.nodeFrame.update).toHaveBeenCalledTimes(1)
    expect(() => clock.frame(() => Promise.resolve())).toThrow('synchronous')
    expect(renderer._inspector.finish).toHaveBeenCalledTimes(2)
    clock.dispose()
    clock.dispose()
    clock.resume()
    expect(clock.active).toBe(false)
    expect(() => clock.frame(() => {})).toThrow('disposed')
    expect(renderer._animation.stop).toHaveBeenCalledTimes(1)
    const replacement = createRealtimeClock(renderer)
    replacement.dispose()
  })

  it('releases frame reentrancy protection even when inspector finish throws', () => {
    const { renderer } = fixture()
    const clock = createRealtimeClock(renderer)
    renderer._inspector.finish.mockImplementationOnce(() => {
      throw new Error('inspector failed')
    })
    expect(() => clock.frame(() => {})).toThrow('inspector failed')
    expect(() => clock.frame(() => {})).not.toThrow()
    clock.dispose()
  })
})

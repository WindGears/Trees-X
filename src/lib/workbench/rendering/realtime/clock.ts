import { REVISION } from 'three'

interface FrameState {
  frameId: number
  lastTime?: number
  update(): void
}

interface ClockInternals {
  _animation: { stop(): void }
  _nodes: { nodeFrame: FrameState }
  _inspector: { begin(): void; finish(): void }
  info: { autoReset: boolean; frame: number; reset(): void }
}

export interface RealtimeClock {
  readonly active: boolean
  /** Submit the entire frame synchronously; asynchronous preparation happens outside this call. */
  frame<T>(draw: () => T): T
  pause(): void
  resume(): void
  dispose(): void
}

const owners = new WeakSet<object>()

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function internals(value: unknown, revision: string): ClockInternals {
  if (revision !== '185') {
    throw new Error(
      `Realtime clock requires the inspected Three r185 bridge (received r${revision})`,
    )
  }
  if (!record(value) || value.isWebGPURenderer !== true || value.initialized !== true) {
    throw new Error('Realtime clock requires an initialized WebGPURenderer')
  }
  const animation = value._animation
  const nodes = value._nodes
  const inspector = value._inspector
  const info = value.info
  const nodeFrame = record(nodes) ? nodes.nodeFrame : undefined
  if (
    !record(animation) ||
    typeof animation.stop !== 'function' ||
    !record(nodeFrame) ||
    typeof nodeFrame.update !== 'function' ||
    typeof nodeFrame.frameId !== 'number' ||
    !Number.isFinite(nodeFrame.frameId) ||
    (nodeFrame.lastTime !== undefined && typeof nodeFrame.lastTime !== 'number') ||
    !record(inspector) ||
    typeof inspector.begin !== 'function' ||
    typeof inspector.finish !== 'function' ||
    !record(info) ||
    typeof info.autoReset !== 'boolean' ||
    typeof info.frame !== 'number' ||
    typeof info.reset !== 'function'
  ) {
    throw new Error('Realtime clock cannot use the changed Three r185 renderer internals')
  }
  // One checked boundary keeps private Three APIs out of the rendering coordinator.
  return value as unknown as ClockInternals
}

/**
 * Three 0.185.1 starts a housekeeping RAF during init(), even without an animation callback.
 * Tres owns our only render RAF. Reproduce the inspected Animation.start frame bookkeeping
 * here, once around all shadow/G-buffer/filter/presentation passes, without another timer.
 * Tres and the renderer retain ownership of their own shutdown; this bridge never restarts RAF.
 */
export function createRealtimeClock(renderer: unknown, revision = REVISION): RealtimeClock {
  const source = internals(renderer, revision)
  const owner = renderer as object
  if (owners.has(owner)) throw new Error('Realtime clock already owns this renderer')
  source._animation.stop()
  owners.add(owner)
  source._nodes.nodeFrame.lastTime = undefined
  let active = true
  let disposed = false
  let drawing = false

  return {
    get active() {
      return active && !disposed
    },
    frame<T>(draw: () => T): T {
      if (disposed) throw new Error('Realtime clock is disposed')
      if (!active) throw new Error('Realtime clock is paused')
      if (drawing) throw new Error('Realtime clock cannot submit a nested frame')
      drawing = true
      let inspected = false
      try {
        if (source.info.autoReset) source.info.reset()
        source._nodes.nodeFrame.update()
        source.info.frame = source._nodes.nodeFrame.frameId
        source._inspector.begin()
        inspected = true
        const result = draw()
        if (record(result) && typeof result.then === 'function') {
          throw new Error('Realtime clock frame submission must be synchronous')
        }
        return result
      } finally {
        try {
          if (inspected) source._inspector.finish()
        } finally {
          drawing = false
        }
      }
    },
    pause() {
      if (!disposed) active = false
    },
    resume() {
      if (disposed || active) return
      source._nodes.nodeFrame.lastTime = undefined
      active = true
    },
    dispose() {
      if (disposed) return
      disposed = true
      active = false
      owners.delete(owner)
    },
  }
}

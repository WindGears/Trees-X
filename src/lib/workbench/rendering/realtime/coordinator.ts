import { Vector2 } from 'three'
import { createRealtimeClock } from './clock'
import { createMotionHistory } from './motion'
import { createRealtimeSignals } from './signals'
import { createRealtimeMaterials } from './materials'
import type { RealtimeChange, RealtimeOptions, RealtimeSnapshot, RealtimeStatus } from './types'

/** Tres owns the renderer. This owner coordinates every auxiliary and final draw. */
export function createRealtimeCoordinator(options: RealtimeOptions) {
  const { renderer, scene, camera } = options,
    clock = createRealtimeClock(renderer),
    motion = createMotionHistory(camera),
    size = new Vector2(),
    materials = createRealtimeMaterials()
  let signals: ReturnType<typeof createRealtimeSignals> | undefined,
    active = true,
    disposed = false,
    loaded = false,
    reset = true,
    frames = 0,
    historyResets = 0,
    firstRasterMs: number | null = null,
    started = performance.now(),
    slug: string | null = null,
    revision = -1,
    generation = 0,
    phase: RealtimeStatus['phase'] = 'loading',
    error: string | null = null,
    lastReport = -Infinity
  const previousError = renderer.onError
  const onError: typeof renderer.onError = (event) => {
    previousError.call(renderer, event)
    if (disposed) return
    // @types r185 declares a string; r185 backend sends a structured event.
    error = typeof event === 'string' ? event : String(Reflect.get(event, 'message'))
    phase = 'error'
    report(true)
  }
  renderer.onError = onError
  const report = (force = false) => {
    const now = performance.now()
    if (force || now - lastReport > 1000) {
      lastReport = now
      options.report({ phase, error, slug, revision, generation })
    }
  }
  function unload() {
    if (disposed) return
    generation++
    loaded = false
    slug = null
    revision = -1
    error = null
    materials.restore()
    reset = true
    phase = 'loading'
    firstRasterMs = null
    motion.reset(scene)
    report(true)
  }
  return {
    ready(value: string, token: number) {
      if (disposed) return
      slug = value
      revision = token
      loaded = true
      phase = error ? 'error' : active ? 'ready' : 'paused'
      report(true)
      if (!error) options.invalidate()
    },
    prepare() {
      if (disposed) return
      materials.install(scene)
      motion.reset(scene)
      const reuse = Boolean(signals)
      signals ??= createRealtimeSignals(renderer, scene, camera, motion.node)
      signals.environment()
      started = performance.now()
      firstRasterMs = null
      reset = reuse
    },
    unload,
    invalidate(kind: RealtimeChange = 'all') {
      if (disposed) return
      // Smooth camera/rigid motion is represented by true vectors, not a reset.
      if (kind !== 'camera' && kind !== 'pose') reset = true
      options.invalidate()
    },
    setInteracting(value: boolean) {
      if (!disposed && !error && value) options.invalidate()
    },
    setActive(value: boolean) {
      if (disposed || active === value) return
      active = value
      if (!value) {
        clock.pause()
        phase = error ? 'error' : 'paused'
      } else {
        clock.resume()
        reset = true
        phase = error ? 'error' : loaded ? 'ready' : 'loading'
        options.invalidate()
      }
      report(true)
    },
    setSignals(ssr: boolean, ssgi: boolean, denoise: boolean) {
      if (disposed || error) return
      signals?.setSignals(ssr, ssgi, denoise)
      options.invalidate()
    },
    render(notify: () => void) {
      if (disposed || !active || error) return
      try {
        clock.frame(() => {
          options.beforeRaster()
          materials.sync()
          renderer.getDrawingBufferSize(size)
          if (reset) {
            signals?.resetHistory()
            signals?.environment()
            motion.reset(scene)
            historyResets++
            reset = false
          }
          motion.beginFrame(scene)
          try {
            if (signals) signals.render()
            else renderer.render(scene, camera)
            if (error) throw new Error(error)
            signals?.commitFrame()
            motion.commitFrame()
          } catch (cause) {
            signals?.cancelFrame()
            motion.cancelFrame()
            throw cause
          }
          frames++
          firstRasterMs ??= performance.now() - started
        })
        notify()
        report()
        if (loaded && !error) options.invalidate()
      } catch (cause) {
        error = cause instanceof Error ? cause.message : '实时光影绘制失败'
        phase = 'error'
        report(true)
      }
    },
    snapshot(): RealtimeSnapshot {
      return {
        phase,
        error,
        slug,
        revision,
        generation,
        frames,
        firstRasterMs,
        active,
        disposed,
        historyResets,
        motion: motion.stats(),
        resolution: { width: size.x, height: size.y },
        signals: signals?.snapshot() ?? { ssr: false, ssgi: false, denoise: false },
        materialBranches: materials.stats(),
      }
    },
    dispose() {
      if (disposed) return
      unload()
      disposed = true
      if (renderer.onError === onError) renderer.onError = previousError
      signals?.dispose()
      signals = undefined
      motion.dispose()
      clock.dispose()
    },
  }
}
export type RealtimeCoordinator = ReturnType<typeof createRealtimeCoordinator>

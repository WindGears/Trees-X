import { Vector2 } from 'three'
import { createRealtimeClock } from './clock'
import { createMotionHistory } from './motion'
import { createRealtimeSignals } from './signals'
import { createRealtimeMaterials } from './materials'
import { realtimeSignalIdentity } from './signalIdentity'
import { withPreparationLease } from '../preparationLease'
import type { RealtimeChange, RealtimeOptions, RealtimeSnapshot, RealtimeStatus } from './types'
import type { RealtimeDdgi } from './ddgi/field'
import {
  realtimeSceneProfile,
  typewriterRealtimeProfile,
  type RealtimeProductProfile,
} from './productProfile'

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
    framesSincePrepare = 0,
    productProfile = options.profile ?? typewriterRealtimeProfile,
    historyResets = 0,
    firstRasterMs: number | null = null,
    started = performance.now(),
    lastActivity = started,
    interacting = false,
    slug: string | null = null,
    revision = -1,
    generation = 0,
    phase: RealtimeStatus['phase'] = 'loading',
    error: string | null = null,
    lastReport = -Infinity,
    ddgi: RealtimeDdgi | undefined,
    ddgiLoading = false,
    ddgiGraphDirty = false,
    ddgiError: string | null = null,
    ddgiFramePending = false,
    preparedPasses = false,
    shadowPreparationPending = false
  let signalIdentity: string | undefined
  const indirectRequested: 'ssgi' | 'ddgi' =
    typeof location !== 'undefined' &&
    new URLSearchParams(location.search).get('indirectLighting') === 'ddgi'
      ? 'ddgi'
      : 'ssgi'
  const legacyCarSchedule =
    typeof location !== 'undefined' &&
    new URLSearchParams(location.search).get('carRenderTuning') === 'legacy'

  function prepareDdgi() {
    if (indirectRequested !== 'ddgi' || ddgi || ddgiLoading) return
    ddgiLoading = true
    const token = generation
    void import('./ddgi/field')
      .then(({ createRealtimeDdgi }) => {
        if (disposed || token !== generation) return
        ddgi = createRealtimeDdgi({
          renderer,
          scene,
          profile: productProfile,
          legacySchedule: legacyCarSchedule,
          onReadyChanged: () => {
            if (!disposed && token === generation) ddgiGraphDirty = true
          },
          onError: (cause) => {
            if (!disposed && token === generation) {
              ddgiError = cause.message
              ddgiGraphDirty = true
            }
          },
        })
      })
      .catch((cause: unknown) => {
        if (!disposed && token === generation)
          ddgiError = cause instanceof Error ? cause.message : String(cause)
      })
      .finally(() => {
        if (!disposed && token === generation) {
          ddgiLoading = false
          options.invalidate()
        }
      })
  }
  const previousError = renderer.onError
  const onError: typeof renderer.onError = (event) => {
    previousError.call(renderer, event)
    if (disposed) return
    // @types r185 declares a string; r185 backend sends a structured event.
    const message = typeof event === 'string' ? event : String(Reflect.get(event, 'message'))
    if (signals?.keyShadowCompiling?.()) {
      signals.keyShadowCompilationFailed(message)
      return
    }
    error = message
    phase = 'error'
    report(true)
  }
  renderer.onError = onError
  const report = (force = false) => {
    const now = performance.now()
    if (force || now - lastReport > 1000) {
      lastReport = now
      options.report({
        phase,
        error,
        slug,
        revision,
        generation,
        indirectLighting: indirectStatus(),
        reflectionRays: signals?.snapshot().reflectionRays,
        keyShadow: signals?.keyShadow?.(),
      })
    }
  }
  function unload() {
    if (disposed) return
    generation++
    loaded = false
    slug = null
    revision = -1
    error = null
    signals?.setWorldGi(null)
    ddgi?.dispose()
    ddgi = undefined
    ddgiLoading = false
    ddgiGraphDirty = false
    ddgiError = null
    interacting = false
    lastActivity = performance.now()
    materials.restore()
    if (signals?.keyShadow?.().requested) {
      signals.dispose()
      signals = undefined
      signalIdentity = undefined
    }
    reset = true
    phase = 'loading'
    firstRasterMs = null
    framesSincePrepare = 0
    preparedPasses = false
    motion.reset(scene)
    report(true)
  }
  function indirectStatus() {
    return {
      requested: indirectRequested,
      actual: ddgi?.snapshot().ready && !ddgiError ? ('ddgi' as const) : ('ssgi' as const),
      preparing: ddgiLoading || Boolean(ddgi && !ddgi.snapshot().ready && !ddgiError),
      error: ddgiError,
    }
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
    prepare(
      profile: RealtimeProductProfile = options.profile ??
        realtimeSceneProfile(scene) ??
        typewriterRealtimeProfile,
    ) {
      if (disposed) return
      const identity = realtimeSignalIdentity(scene, profile)
      if (profile !== productProfile || (signals && identity !== signalIdentity)) {
        // A direct product handoff must not retain the previous volume or a
        // receiver/late module callback belonging to the old profile.
        generation++
        signals?.setWorldGi(null)
        ddgi?.dispose()
        ddgi = undefined
        ddgiLoading = false
        ddgiGraphDirty = false
        ddgiError = null
        // Product-specific source classification/history is captured at graph
        // construction. Rebuild the graph, never the shared renderer, on handoff.
        signals?.dispose()
        signals = undefined
      }
      productProfile = profile
      preparedPasses = false
      framesSincePrepare = 0
      lastActivity = performance.now()
      ddgi?.invalidate('all')
      materials.install(scene)
      motion.reset(scene)
      const reuse = Boolean(signals)
      signals ??= createRealtimeSignals(renderer, scene, camera, motion.node, profile)
      signalIdentity = identity
      signals.setProfile?.(profile)
      signals.environment()
      prepareDdgi()
      started = performance.now()
      firstRasterMs = null
      reset = reuse
    },
    async preparePasses(signal?: AbortSignal) {
      signal?.throwIfAborted()
      if (disposed || !signals) throw new Error('Realtime scene is not prepared')
      const token = generation
      await signals.prepare(signal)
      signal?.throwIfAborted()
      if (disposed || token !== generation) throw new Error('Realtime preparation was superseded')
      // Native async pipeline errors can be reported through renderer.onError
      // even when the compile Promise resolves. A real frame still gates ready.
      if (error) throw new Error(error)
      preparedPasses = true
    },
    unload,
    invalidate(kind: RealtimeChange = 'all') {
      if (disposed) return
      // Only real scene/input changes enter here. Scheduling another completed
      // frame calls options.invalidate directly and must not keep GI busy.
      lastActivity = performance.now()
      ddgi?.invalidate(kind)
      signals?.invalidateKeyShadow?.(kind)
      // Smooth camera/rigid motion is represented by true vectors, not a reset.
      if (kind !== 'camera' && kind !== 'pose') reset = true
      options.invalidate()
    },
    setInteracting(value: boolean) {
      if (disposed || error || interacting === value) return
      interacting = value
      lastActivity = performance.now()
      if (value) options.invalidate()
    },
    setActive(value: boolean) {
      if (disposed || active === value) return
      active = value
      signals?.setKeyShadowActive?.(value)
      // Time spent hidden is not a safe rebuild window on the first resumed frame.
      lastActivity = performance.now()
      if (!value) {
        interacting = false
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
      if (ddgiFramePending || shadowPreparationPending || disposed || !active || error) return
      if (signals?.keyShadowNeedsPreparation?.() && framesSincePrepare > 0) {
        const token = generation,
          owner = signals
        shadowPreparationPending = true
        void withPreparationLease(renderer, () => owner.prepareKeyShadow())
          .catch((cause: unknown) => {
            if (!disposed && token === generation) owner.failKeyShadow(cause)
          })
          .finally(() => {
            shadowPreparationPending = false
            if (!disposed && token === generation) {
              report(true)
              if (active) options.invalidate()
            }
          })
        return
      }
      if (ddgiError && ddgiGraphDirty) {
        signals?.setWorldGi(null)
        ddgiGraphDirty = false
      }
      if (ddgi && !ddgiError && framesSincePrepare > 0 && ddgi.needsUpdate()) {
        // Serialize asynchronous probe compute with every raster/auxiliary draw
        // on the existing renderer. Tres remains the sole scheduling clock.
        const token = generation,
          field = ddgi
        ddgiFramePending = true
        // Probe compute consumes the last completed pose. Scene animation and
        // shadow rendering remain exactly once inside the real frame below.
        void withPreparationLease(renderer, () =>
          field.tick(interacting ? 0 : Math.max(0, performance.now() - lastActivity)),
        )
          .then(() => {
            if (disposed || token !== generation || !active) return
            if (ddgiGraphDirty && signals) {
              signals.setWorldGi(field.createReceiver(signals.ddgiInputs()))
              ddgiGraphDirty = false
            }
            draw(notify)
          })
          .catch((cause: unknown) => {
            if (!disposed && token === generation) {
              ddgiError = cause instanceof Error ? cause.message : String(cause)
              signals?.setWorldGi(null)
            }
          })
          .finally(() => {
            ddgiFramePending = false
            if (!disposed && active) options.invalidate()
          })
      } else draw(notify)
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
        reflectionKernel: signals?.sampling() ?? null,
        reflectionHistory: signals?.history?.() ?? null,
        materialBranches: materials.stats(),
        productProfile: productProfile.adapterId,
        preparation: { sceneInputs: preparedPasses },
        keyShadow: signals?.keyShadow?.(),
        indirectLighting: {
          ...indirectStatus(),
          details: ddgi?.snapshot() ?? null,
        },
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

  function draw(notify: () => void) {
    if (disposed || !active || error) return
    try {
      clock.frame(() => {
        options.beforeRaster()
        materials.sync()
        renderer.getDrawingBufferSize(size)
        if (reset) {
          // Consume before resetting: a synchronous invalidation raised by an
          // owner during cleanup must survive for the next complete frame.
          reset = false
          signals?.resetHistory()
          signals?.environment()
          motion.reset(scene)
          historyResets++
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
        framesSincePrepare++
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
  }
}
export type RealtimeCoordinator = ReturnType<typeof createRealtimeCoordinator>

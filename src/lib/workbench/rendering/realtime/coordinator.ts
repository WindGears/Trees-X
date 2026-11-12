import { Vector2 } from 'three'
import { createRealtimeClock } from './clock'
import { getShowroomEnvironment, getShowroomStatus } from '../carShowroom/binding'
import { createMotionHistory } from './motion'
import { createRealtimeSignals } from './signals'
import { createRealtimeMaterials } from './materials'
import { realtimeSignalIdentity } from './signalIdentity'
import { withPreparationLease } from '../preparationLease'
import { r18PerformanceEnabled } from '../showcase'
import { createCarFrameSchedule } from './carFrameSchedule'
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
    ddgiPreparation: Promise<void> | undefined,
    ddgiGraphDirty = false,
    ddgiError: string | null = null,
    ddgiFramePending = false,
    preparedPasses = false,
    shadowPreparationPending = false,
    native = false
  let signalIdentity: string | undefined
  let indirectRequested: 'ssgi' | 'ddgi' = 'ssgi',
    legacyCarSchedule = false,
    prepareIndirect: (() => Promise<void>) | undefined
  const enhancementIdleMs = 900
  let installSignals: (() => void) | undefined
  let enhancementTimer: ReturnType<typeof setTimeout> | undefined
  const mode = () => (native ? 'pbr' : installSignals ? 'warming' : undefined)
  const frameSchedule = createCarFrameSchedule()

  function needsFrame() {
    return (
      loaded &&
      signals &&
      (frameSchedule.unsettled() ||
        interacting ||
        ddgiPreparation ||
        (!ddgiError && ddgi?.hasPendingUpdates()) ||
        signals.keyShadow?.().phase === 'loading')
    )
  }

  function scheduleEnhancement() {
    clearTimeout(enhancementTimer)
    if (disposed || !loaded || !active || !installSignals || interacting) return
    enhancementTimer = setTimeout(
      options.invalidate,
      Math.max(0, enhancementIdleMs - (performance.now() - lastActivity)),
    )
  }

  function prepareDdgi() {
    if (indirectRequested !== 'ddgi' || ddgi) return
    if (ddgiPreparation) return ddgiPreparation
    const token = generation
    ddgiPreparation = Promise.resolve()
      .then(prepareIndirect)
      .then(() => {
        if (!disposed && token === generation) return import('./ddgi/field')
      })
      .then((field) => {
        if (!field || disposed || token !== generation) return
        ddgi = field.createRealtimeDdgi({
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
          ddgiPreparation = undefined
          options.invalidate()
        }
      })
    return ddgiPreparation
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
        mode: mode(),
        phase,
        error,
        slug,
        revision,
        generation,
        indirectLighting: native ? undefined : indirectStatus(),
        reflectionRays: signals?.snapshot().reflectionRays,
        showroom: getShowroomStatus(scene),
        keyShadow: signals?.keyShadow?.(),
      })
    }
  }
  function unload() {
    if (disposed) return
    generation++
    frameSchedule.configure()
    clearTimeout(enhancementTimer)
    installSignals = undefined
    loaded = false
    slug = null
    revision = -1
    error = null
    signals?.setWorldGi(null)
    ddgi?.dispose()
    ddgi = undefined
    ddgiPreparation = undefined
    ddgiGraphDirty = false
    ddgiError = null
    prepareIndirect = undefined
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
    motion.clear()
    report(true)
  }
  function indirectStatus() {
    return {
      requested: indirectRequested,
      actual: ddgi?.snapshot().ready && !ddgiError ? ('ddgi' as const) : ('ssgi' as const),
      preparing: Boolean(ddgiPreparation || (ddgi && !ddgi.snapshot().ready && !ddgiError)),
      error: ddgiError,
    }
  }
  return {
    ready(value: string, token: number) {
      if (disposed) return
      slug = value
      revision = token
      loaded = true
      frameSchedule.touch()
      phase = error ? 'error' : active ? 'ready' : 'paused'
      if (installSignals) {
        lastActivity = performance.now()
        scheduleEnhancement()
      }
      if (active && prepareIndirect) prepareDdgi()
      report(true)
      if (!error) options.invalidate()
    },
    prepare(
      profile: RealtimeProductProfile | null = options.profile ??
        realtimeSceneProfile(scene) ??
        typewriterRealtimeProfile,
      search = globalThis.location?.search ?? '',
      deferredIndirect?: () => Promise<void>,
      deferSignals = false,
    ) {
      if (disposed) return
      const query = new URLSearchParams(search)
      const optimizeR18 =
        profile?.adapterId === 'reventon-v1' &&
        getShowroomEnvironment(scene)?.config.revision === 18 &&
        query.get('carRenderTuning') !== 'legacy' &&
        r18PerformanceEnabled(search)
      frameSchedule.configure(optimizeR18)
      native = profile === null
      if (!profile) {
        signals?.dispose()
        signals = undefined
        signalIdentity = undefined
        started = performance.now()
        firstRasterMs = null
        return
      }
      const identity = realtimeSignalIdentity(scene, profile) + search
      if (deferSignals || profile !== productProfile || (signals && identity !== signalIdentity)) {
        // A direct product handoff must not retain the previous volume or a
        // receiver/late module callback belonging to the old profile.
        generation++
        signals?.setWorldGi(null)
        ddgi?.dispose()
        ddgi = undefined
        ddgiPreparation = undefined
        ddgiGraphDirty = false
        ddgiError = null
        // Product-specific source classification/history is captured at graph
        // construction. Rebuild the graph, never the shared renderer, on handoff.
        signals?.dispose()
        signals = undefined
      }
      productProfile = profile
      indirectRequested = query.get('indirectLighting') === 'ddgi' ? 'ddgi' : 'ssgi'
      legacyCarSchedule = query.get('carRenderTuning') === 'legacy'
      prepareIndirect = deferredIndirect
      preparedPasses = false
      framesSincePrepare = 0
      lastActivity = performance.now()
      ddgi?.invalidate('all')
      const prepareMaterialsNow = !deferSignals || profile.adapterId === 'reventon-v1'
      const shareShowroomProjection = optimizeR18 && query.get('r18Projection') !== 'reference'
      if (prepareMaterialsNow) materials.install(scene, shareShowroomProjection)
      const install = () => {
        if (!prepareMaterialsNow) materials.install(scene, shareShowroomProjection)
        motion.reset(scene)
        const reuse = Boolean(signals)
        signals ??= createRealtimeSignals(
          renderer,
          scene,
          camera,
          motion.node,
          profile,
          search,
          optimizeR18,
        )
        signalIdentity = identity
        signals.setProfile?.(profile)
        signals.environment()
        if (!prepareIndirect) prepareDdgi()
        reset = reuse
      }
      if (deferSignals) installSignals = install
      else install()
      started = performance.now()
      firstRasterMs = null
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
    async prepareCarStartup(signal: AbortSignal, firstFrameShadows?: () => boolean) {
      const owner = signals
      if (disposed || !owner) return
      signal.throwIfAborted()
      const shadowBuild = owner.startKeyShadow(signal)
      const step = async () => {
        signal.throwIfAborted()
        if (!ddgi || ddgiError || ddgi.snapshot().ready) return
        try {
          await ddgi.tick()
        } catch (cause) {
          ddgiError = cause instanceof Error ? cause.message : String(cause)
        }
      }
      try {
        // Read and build the probe field while the shadow Worker constructs BLAS.
        // Its renderer work ends before visibility shaders use the same device.
        await prepareDdgi()
        await step()
      } finally {
        await shadowBuild
      }
      signal.throwIfAborted()
      // A successful native cache lets the actual first draw initialize the
      // shadow targets without an earlier draw of their surface dependencies.
      await owner.prepareKeyShadow(signal, firstFrameShadows?.() ? 'first-frame' : 'targets')
      // The fixed single-cascade field builds on its first tick and solves on
      // the second. Bind that result before any beauty draw builds the graph.
      await step()
      signal.throwIfAborted()
      const field = ddgi
      if (!field || ddgiError) return
      try {
        if (ddgiGraphDirty) owner.setWorldGi(field.createReceiver(owner.ddgiInputs()))
      } catch (cause) {
        ddgiError = cause instanceof Error ? cause.message : String(cause)
        owner.setWorldGi(null)
      } finally {
        ddgiGraphDirty = false
      }
    },
    unload,
    invalidate(kind: RealtimeChange = 'all') {
      if (disposed) return
      frameSchedule.touch()
      // Only real scene/input changes enter here. Scheduling another completed
      // frame calls options.invalidate directly and must not keep GI busy.
      lastActivity = performance.now()
      scheduleEnhancement()
      ddgi?.invalidate(kind)
      signals?.invalidateKeyShadow?.(kind)
      // Smooth camera/rigid motion is represented by true vectors, not a reset.
      if (kind !== 'camera' && kind !== 'pose') reset = true
      options.invalidate()
    },
    setInteracting(value: boolean) {
      if (disposed || error || interacting === value) return
      interacting = value
      frameSchedule.touch()
      lastActivity = performance.now()
      scheduleEnhancement()
      if (value) options.invalidate()
    },
    setActive(value: boolean) {
      if (disposed || active === value) return
      active = value
      signals?.setKeyShadowActive?.(value)
      // Time spent hidden is not a safe rebuild window on the first resumed frame.
      lastActivity = performance.now()
      if (!value) {
        clearTimeout(enhancementTimer)
        interacting = false
        clock.pause()
        phase = error ? 'error' : 'paused'
      } else {
        clock.resume()
        frameSchedule.touch()
        reset = true
        phase = error ? 'error' : loaded ? 'ready' : 'loading'
        scheduleEnhancement()
        if (loaded && prepareIndirect && !ddgiError) prepareDdgi()
        options.invalidate()
      }
      report(true)
    },
    setSignals(ssr: boolean, ssgi: boolean, denoise: boolean) {
      if (disposed || error) return
      signals?.setSignals(ssr, ssgi, denoise)
      frameSchedule.touch()
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
      if (signals && ddgi && !ddgiError && framesSincePrepare > 0 && ddgi.needsUpdate()) {
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
        mode: mode(),
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
        showroom: getShowroomStatus(scene),
        productProfile: native ? undefined : productProfile.adapterId,
        preparation: { sceneInputs: preparedPasses },
        keyShadow: signals?.keyShadow?.(),
        indirectLighting: native
          ? undefined
          : { ...indirectStatus(), details: ddgi?.snapshot() ?? null },
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
        if (
          installSignals &&
          loaded &&
          !interacting &&
          performance.now() - lastActivity >= enhancementIdleMs
        ) {
          const install = installSignals
          installSignals = undefined
          install()
        }
        materials.sync()
        renderer.getDrawingBufferSize(size)
        if (signals) drawEnhanced()
        else renderer.render(scene, camera)
        if (error) throw new Error(error)
        frames++
        framesSincePrepare++
        firstRasterMs ??= performance.now() - started
      })
      frameSchedule.submitted()
      notify()
      report()
      if (!error && needsFrame()) options.invalidate()
    } catch (cause) {
      error = cause instanceof Error ? cause.message : '实时光影绘制失败'
      phase = 'error'
      report(true)
    }
  }

  function drawEnhanced() {
    if (reset) {
      reset = false
      signals?.resetHistory()
      signals?.environment()
      motion.reset(scene)
      historyResets++
    }
    motion.beginFrame(scene)
    try {
      signals?.render()
      if (error) throw new Error(error)
      signals?.commitFrame()
      motion.commitFrame()
    } catch (cause) {
      signals?.cancelFrame()
      motion.cancelFrame()
      throw cause
    }
  }
}
export type RealtimeCoordinator = ReturnType<typeof createRealtimeCoordinator>

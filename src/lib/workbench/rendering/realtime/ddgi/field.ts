import { createProbeField } from 'speedball-gi'
import speedballPackage from 'speedball-gi/package.json'
import type { Scene, WebGPURenderer } from 'three/webgpu'
import { assertDdgiRevision, createDdgiVolume, ddgiBudget, ddgiSource } from './contract'
import { createDdgiProxyScene } from './proxyScene'
import { createDdgiReceiver, type DdgiReceiverInputs } from './receiver'
import { projectEnvironmentSH, type EnvironmentSHMetadata } from './environmentSH'

export interface DdgiFieldOptions {
  renderer: WebGPURenderer
  scene: Scene
  onReadyChanged?: () => void
  onError?: (error: Error) => void
}

/** Owns one low-level probe field plus a borrowed tracing view. The caller must
 * invoke tick from the existing Tres/coordinator clock; no timer or renderer is
 * installed. Awaiting tick lets the host serialize compute before its draw.
 */
export function createRealtimeDdgi(options: DdgiFieldOptions) {
  assertDdgiRevision()
  if (speedballPackage.version !== ddgiSource.version)
    throw new Error('Speedball package version differs from the reviewed 0.8.0 source')
  const proxy = createDdgiProxyScene(options.scene),
    volume = createDdgiVolume(),
    environmentRotation = options.scene.environmentRotation.clone()
  proxy.sync()
  let structureChanged = false
  const field = createProbeField({
    renderer: options.renderer,
    scene: proxy.scene,
    intensity: 1,
    hysteresis: 0.6,
    jitterMode: 'gated',
    onRebuilt: () => {
      structureChanged = true
    },
    divisions: ddgiBudget.longestAxis,
    autoPadding: 0,
    rays: ddgiBudget.raysPerProbe,
    cascades: 1,
    continuous: true,
    roughReflections: false,
    reflectionQuality: 'off',
    reflectionIntensity: 0,
    reflectionSkyFallback: false,
    clusteredLighting: false,
    autoDetectChanges: false,
  })
  try {
    if (!field.isSupported()) {
      throw new Error('The existing renderer cannot run the fixed DDGI field')
    }
    field.setVolumes([{ box: volume.box, res: volume.res }])
    field.setRayBudget(ddgiBudget.maxRaysPerTick)
    field.setSkyIntensity(1)
    field.setEnabled(true)
  } catch (cause) {
    field.dispose()
    proxy.dispose()
    throw cause
  }
  let disposed = false,
    ready = false,
    generation = 0,
    acceptedTicks = 0,
    lastIdleMs = 0,
    error: Error | null = null,
    pending: Promise<void> | undefined,
    environment = options.scene.environment,
    environmentVersion = -1,
    environmentIntensity = -1,
    environmentMetadata: EnvironmentSHMetadata | null = null

  function publish(next: boolean, structure = false) {
    if (ready === next && !structure) return
    ready = next
    generation++
    options.onReadyChanged?.()
  }

  function fail(cause: unknown) {
    if (disposed) return
    error = cause instanceof Error ? cause : new Error(String(cause))
    publish(false)
    options.onError?.(error)
  }

  function updateEnvironment() {
    const scene = options.scene,
      next = scene.environment
    if (
      next === environment &&
      (next?.version ?? 0) === environmentVersion &&
      scene.environmentIntensity === environmentIntensity &&
      scene.environmentRotation.equals(environmentRotation)
    )
      return
    if (!next) throw new Error('DDGI requires the actual linear HDR environment')
    const projected = projectEnvironmentSH(
      next,
      scene.environmentIntensity,
      scene.environmentRotation,
    )
    field.setSky(projected.sh)
    field.forceLightingRefresh()
    environment = next
    environmentVersion = next.version
    environmentIntensity = scene.environmentIntensity
    environmentRotation.copy(scene.environmentRotation)
    environmentMetadata = projected.metadata
  }

  function validateBudget() {
    const stats = field.getStats()
    if (
      stats.rays !== ddgiBudget.raysPerProbe ||
      stats.cascades !== 1 ||
      stats.reflectionQuality !== 'off' ||
      stats.budgetRays !== ddgiBudget.maxRaysPerTick
    )
      throw new Error('DDGI solve changed the fixed ray, cascade or reflection budget')
    if (field.hasData() && (!stats.res.equals(volume.res) || stats.probes !== volume.probes))
      throw new Error(
        'DDGI device cannot preserve the explicit probe resolution; automatic reduction is not allowed',
      )
  }

  async function advance(idleMs: number) {
    try {
      updateEnvironment()
      const changes = proxy.sync()
      if (changes.topology) {
        field.markTopologyDirty()
        publish(false)
      }
      if (changes.transforms.length) field.markTransformsDirty(changes.transforms)
      if (changes.materials.length) field.markMaterialValuesDirty(changes.materials)
      if (changes.lighting) field.forceLightingRefresh()
      // Audited 0.8.0 seam: resetting before each accepted tick clears lastTickAt
      // and its automatic budget controller. It does not reset probe history or
      // per-cascade solve time. No extra loop or synthetic time is introduced.
      field.resetFramePacing()
      const before = field._debugState()
      lastIdleMs = idleMs
      // Continuous mode keeps fixed-budget solves and explicit transform/value
      // packets live; only heavy rebuilds wait for the real quiet window. All
      // activity, including animation, is merged into idleMs. Passing playing
      // would trigger 0.8.0's post-playback budget reduction even in continuous
      // mode; resetFramePacing does not undo that reduction.
      await field.tick({ idleMs, playing: false })
      if (disposed) return
      const state = field._debugState()
      // In 0.8.0 a material/instance packet may legitimately escalate to a
      // rebuild inside tick (for example the first warm-night map binding).
      // Dirty alone is not an error. Preserve that rebuild lane while still
      // detecting build backoff and unsolicited swallowed solve failures.
      const requestedChange =
        changes.materials.length > 0 || changes.transforms.length > 0 || changes.lighting
      if (
        state.rebuildBackoff > 0 ||
        (!before.dirty && state.dirty && !state.buildDirty && !requestedChange)
      )
        throw new Error(
          'Speedball rejected its build or solve; inspect the upstream warning for details',
        )
      validateBudget()
      acceptedTicks++
      publish(
        field.hasData() &&
          state.buildStage === 2 &&
          !state.dirty &&
          state.updatedCount > 0 &&
          state.cascadeState[0]?.needsClear === false,
        structureChanged,
      )
      structureChanged = false
    } catch (cause) {
      fail(cause)
    }
  }

  return {
    tick(idleMs = 0) {
      if (disposed || error) return Promise.resolve()
      if (pending) return pending
      // Unknown/non-finite input is activity, never an infinite idle permit.
      const quietMs = Number.isFinite(idleMs) ? Math.max(0, idleMs) : 0
      pending = advance(quietMs).finally(() => {
        pending = undefined
      })
      return pending
    },
    createReceiver(inputs: DdgiReceiverInputs) {
      return ready && !disposed && !error ? createDdgiReceiver(field.node, inputs, volume) : null
    },
    snapshot() {
      const stats = field.getStats()
      return {
        source: ddgiSource,
        budget: ddgiBudget,
        ready,
        generation,
        acceptedTicks,
        activity: { idleMs: lastIdleMs, playing: false, mode: 'merged-activity' },
        inFlight: Boolean(pending),
        disposed,
        error: error?.message ?? null,
        bounds: { min: volume.box.min.toArray(), max: volume.box.max.toArray() },
        resolution: stats.res.toArray(),
        probes: stats.probes,
        actualRays: stats.rays,
        actualBudgetRays: stats.budgetRays,
        reflectionQuality: stats.reflectionQuality,
        proxy: proxy.snapshot(),
        environment: environmentMetadata,
        state: field._debugState(),
        limitations: [
          'SH9 is a low frequency projection of the real HDR.',
          'Speedball 0.8.0 traces RectAreaLight as a center point.',
          'Probe convergence is temporal; this is not a path-traced or measured irradiance solution.',
          'The screen receiver uses the G-buffer shading normal for visibility as well as direction.',
        ],
      }
    },
    dispose() {
      if (disposed) return
      disposed = true
      ready = false
      field.dispose()
      proxy.dispose()
    },
  }
}

export type RealtimeDdgi = ReturnType<typeof createRealtimeDdgi>

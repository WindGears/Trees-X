import { nextTick, onMounted, onScopeDispose, ref, shallowRef, watch } from 'vue'
import { useLoop, useTres, useTresContext } from '@tresjs/core'
import { PerspectiveCamera, Color, Fog } from 'three'
import { createBaseEnvironment, type OwnedEnvironment } from '@/lib/workbench/rendering/environment'
import { isWebGpuRenderer, type WorkbenchRenderer } from '@/lib/workbench/rendering/rendererTypes'
import type { HybridCoordinator } from '@/lib/workbench/rendering/coordinator'
import type { RefinementStatus, RefinementChange } from '@/lib/workbench/rendering/refinementTypes'
import type { RealtimeCoordinator } from '@/lib/workbench/rendering/realtime/coordinator'
import type { RealtimeStatus } from '@/lib/workbench/rendering/realtime/types'
import { realtimeProductProfile } from '@/lib/workbench/rendering/realtime/productProfile'
import { getShowroomEnvironment } from '@/lib/workbench/rendering/carShowroom/binding'
import type { ownGeometryAttributes } from '@/lib/workbench/rendering/realtime/geometryOwnership'
import { createStageController } from '@/lib/workbench/controller'
import { hasTypewriterStudio, resolveWorkbenchStage } from '@/lib/workbench/studioPreset'
import { useWorkbenchStore } from '@/stores/workbench'
import { useMotionSession } from '@/lib/workbench/motionSession'
import { useCameraCaptureSession, type CameraSnapshot } from '@/lib/workbench/cameraCapture'
import type { PlaceCallout } from '@/lib/workbench/calloutProjection'
import { createViewportFraming } from '@/lib/workbench/viewportFraming'
import type { StudioMood, StudioEnvironmentStatus } from '@/lib/workbench/studio/mood'
import { setShowroomPanelBrightness } from '@/lib/workbench/rendering/carShowroom/panelBrightness'
import {
  afterPreparation,
  waitForPreparations,
  withPreparationLease,
} from '@/lib/workbench/rendering/preparationLease'

export interface WorkbenchSceneProps {
  active: boolean
  place: PlaceCallout
  commit: () => void
  gallery?: boolean
  inspector?: boolean
  catalog?: boolean
  checkpoint?: CameraSnapshot
  realtimePipeline?: boolean
  studioMood?: StudioMood
}
/** Scene owns all resources except the Tres-owned renderer. */
export function useWorkbenchScene(
  props: WorkbenchSceneProps,
  restore: (snapshot?: CameraSnapshot) => void,
  report: (status: RefinementStatus) => void,
  reportRealtime: (status: RealtimeStatus) => void = () => {},
  reportStudio: (status: StudioEnvironmentStatus) => void = () => {},
) {
  const store = useWorkbenchStore()
  const motionSession = useMotionSession()
  const captureSession = useCameraCaptureSession()
  let unregisterCapture: (() => void) | undefined
  let motionSlug = '',
    motionRevision = -1
  const ownsCurrentSelection = () => motionSlug === store.slug && motionRevision === store.revision
  const { scene, camera, sizes, invalidate } = useTres()
  const context = useTresContext()
  const renderer = context.renderer.instance as WorkbenchRenderer
  const gpu = isWebGpuRenderer(renderer)
  let currentRefinement: RefinementStatus['phase'] = 'raster'
  let hybrid: HybridCoordinator | undefined
  let realLighting: RealtimeCoordinator | undefined
  let preparing = false,
    loadTail: Promise<void> = Promise.resolve(),
    disposed = false,
    generation = 0
  const setupAbort = new AbortController()
  let selectionAbort: AbortController | undefined
  const requestFrame = () => {
    if (
      props.active &&
      !disposed &&
      !preparing &&
      !realLighting?.snapshot().error &&
      context.renderer.isInitialized.value &&
      !isActive.value
    )
      start()
    invalidate()
  }
  const dirty = (kind: RefinementChange = 'all') => {
    if (disposed) return
    hybrid?.invalidate(kind)
    realLighting?.invalidate(kind)
    invalidate()
  }
  const { start, stop, isActive, onBeforeRender } = useLoop()
  const background = new Color('#151c25')
  const fog = new Fog(background, 12, 38)
  scene.value.background = background
  scene.value.fog = fog
  let committedPresentation = store.presentation
  const studio = ref(hasTypewriterStudio(committedPresentation))
  const stage = shallowRef(
    resolveWorkbenchStage(
      committedPresentation,
      Boolean(props.gallery),
      gpu && Boolean(props.realtimePipeline),
      props.studioMood,
    ),
  )
  function updateStage() {
    studio.value = hasTypewriterStudio(committedPresentation)
    stage.value = resolveWorkbenchStage(
      committedPresentation,
      Boolean(props.gallery),
      gpu && Boolean(props.realtimePipeline),
      props.studioMood,
    )
  }
  watch(
    () => [props.gallery, props.studioMood] as const,
    () => {
      if (!preparing) updateStage()
    },
  )
  watch(
    stage,
    (value) => {
      background.set(value.background)
      fog.color.copy(background)
      const showroom = getShowroomEnvironment(scene.value)
      scene.value.environmentIntensity = showroom ? 1 : value.environmentIntensity
      renderer.toneMappingExposure = showroom?.config.exposure ?? value.exposure
      dirty('environment')
    },
    { immediate: true },
  )
  let controller: ReturnType<typeof createStageController> | undefined
  function applyStudioMood(force = false) {
    if (disposed || (preparing && !force) || !gpu || !props.realtimePipeline || !studio.value)
      return
    const token = generation
    controller?.setStudioMood({
      mood: props.studioMood ?? 'dark',
      changed: () => {
        if (!disposed && token === generation) dirty('environment')
      },
      report: (value) => {
        if (!disposed && token === generation) reportStudio(value)
      },
    })
  }
  watch(
    () => props.studioMood,
    () => applyStudioMood(),
  )
  onBeforeRender(() => {
    if (!gpu && !preparing && !disposed) controller?.beforeRender()
  })
  let geometryOwnership: ReturnType<typeof ownGeometryAttributes> | undefined
  let environment: OwnedEnvironment | undefined
  let removeFrame: (() => void) | undefined, removeListeners: (() => void) | undefined
  function load(): Promise<void> {
    const request = ++generation
    selectionAbort?.abort()
    const abort = (selectionAbort = new AbortController())
    removeFrame?.()
    removeFrame = undefined
    // Stop input and the real drawing clock immediately, but never free resources
    // that an already-submitted native compile still references.
    preparing = true
    controller?.cancelLoading()
    framing.finish()
    updateActive()
    const product = store.product,
      revision = store.revision
    const run = async () => {
      // A stopped clock may still own an awaited probe build/dispatch. Wait
      // outside our next lease, or the successor would wait for itself forever.
      await waitForPreparations(renderer)
      if (disposed || request !== generation || !controller || !product) return
      try {
        // Release the previous singleton while the renderer is quiescent. Its
        // disposal uses afterPreparation: placing it inside the successor's
        // lease would defer the real release until after the new field creates.
        hybrid?.unload()
        realLighting?.unload()
        controller.unload()
        await withPreparationLease(renderer, async () => {
          committedPresentation = product.presentation
          updateStage()
          // Commit the explicit lighting graph before attaching and compiling
          // this product. New selection props cannot remove an old pass mid-await.
          await nextTick()
          if (disposed || request !== generation) return
          await loadCurrent(product, revision, request, abort.signal)
        })
      } catch (cause) {
        if (!disposed && request === generation) {
          hybrid?.unload()
          realLighting?.unload()
          controller?.unload()
          store.failed(
            product.slug,
            revision,
            cause instanceof Error ? cause.message : '三维模型加载失败，请重试。',
          )
        }
      } finally {
        if (!disposed && request === generation) {
          preparing = false
          updateStage()
          updateFraming()
          updateActive()
        }
      }
    }
    // Queue callbacks are cheap; superseded selections skip without loading.
    loadTail = loadTail.catch(() => {}).then(run)
    return loadTail
  }
  async function loadCurrent(
    product: NonNullable<typeof store.product>,
    revision: number,
    request: number,
    signal: AbortSignal,
  ) {
    motionSlug = product.slug
    motionRevision = revision
    const current = controller
    if (!current) return
    const loaded = await current.load(product, (phase) => {
      if (!disposed && request === generation) store.loading(product.slug, revision, phase)
    })
    if (!loaded || disposed || request !== generation) return
    applyStudioMood(true)
    current.sync(store.finishId, store.exploded, store.actions, true)
    if (props.checkpoint?.slug === product.slug && props.checkpoint.revision === revision) {
      current.restoreCamera(props.checkpoint)
      current.restoreSelection(store.selectedPart)
    }
    if (!camera.value) return
    store.loading(product.slug, revision, 'first-frame')
    const profile = realtimeProductProfile(
      product.presentation.source.kind === 'glb' ? product.presentation.source.adapter : undefined,
    )
    const car = profile?.adapterId === 'reventon-v1'
    // A captured showroom must exist before material/environment graph binding.
    // The stopped host and preparation lease still own the only renderer here.
    const carPrepare =
      car &&
      realLighting &&
      (new URLSearchParams(location.search).get('carPrewarm') !== 'off' ||
        new URLSearchParams(location.search).get('carShowroom') === 'cold-studio')
    if (carPrepare) await current.prepare(signal)
    if (disposed || request !== generation) return
    realLighting?.prepare(profile)
    if (
      realLighting &&
      (!car || new URLSearchParams(location.search).get('carPrewarm') !== 'off')
    ) {
      // Same renderer, stopped drawing clock and current preparation lease.
      // These tasks warm the actual private shadow and HDR MRT variants, not
      // the unrelated default Canvas PSO. Post effects still gate on a real frame.
      await realLighting.preparePasses(signal)
    } else await renderer.compileAsync(scene.value, camera.value)
    if (disposed || request !== generation) return
    const frame = context.renderer.onRender(() => {
      if (
        realLighting &&
        (realLighting.snapshot().firstRasterMs === null || realLighting.snapshot().error)
      )
        return
      if (hybrid) {
        const status = hybrid.snapshot()
        if (status.firstRasterMs === null || status.phase === 'error') return
      }
      frame.off()
      if (!disposed && request === generation) {
        controller?.enableInteraction()
        store.ready(product.slug, revision)
        hybrid?.ready(product.slug, revision)
        realLighting?.ready(product.slug, revision)
        void nextTick(() => {
          if (!disposed && request === generation) invalidate()
        })
      }
    })
    removeFrame = frame.off
    dirty('all')
  }
  function updateActive() {
    if (disposed) return
    const active = props.active && !preparing && !realLighting?.snapshot().error
    controller?.setActive(active)
    hybrid?.setActive(active)
    realLighting?.setActive(active)
    if (!context.renderer.isInitialized.value) return
    if (active) {
      if (!isActive.value) start()
      invalidate()
    } else if (isActive.value) stop()
  }
  const readyListener = context.renderer.onReady(updateActive)
  let initializing = false
  async function initialize() {
    if (initializing || disposed) return
    initializing = true
    try {
      if (!(camera.value instanceof PerspectiveCamera)) {
        store.failed(store.slug, store.revision, '当前浏览器无法启动三维工作台。请开启图形加速。')
        return
      }
      if (isWebGpuRenderer(renderer)) await renderer.init()
      await withPreparationLease(renderer, async () => {
        environment = await createBaseEnvironment(renderer, setupAbort.signal)
        if (disposed) {
          environment.dispose()
          environment = undefined
        }
      })
      if (disposed || !environment) return
      scene.value.environment = environment.texture
      scene.value.environmentIntensity = stage.value.environmentIntensity
      if (isWebGpuRenderer(renderer)) {
        if (props.realtimePipeline) {
          const { createRealtimeCoordinator } =
            await import('@/lib/workbench/rendering/realtime/coordinator')
          const { ownGeometryAttributes } =
            await import('@/lib/workbench/rendering/realtime/geometryOwnership')
          if (disposed) return
          geometryOwnership ??= ownGeometryAttributes(renderer)
          realLighting = createRealtimeCoordinator({
            renderer,
            scene: scene.value,
            camera: camera.value,
            invalidate: requestFrame,
            beforeRaster: () => controller?.beforeRender(),
            report: (status) => {
              if (disposed || (status.error && !ownsCurrentSelection())) return
              reportRealtime(status)
              if (status.error) {
                store.failed(store.slug, store.revision, status.error)
                updateActive()
              }
            },
          })
          context.renderer.replaceRenderFunction((notify) => {
            if (!disposed && !preparing) realLighting?.render(notify)
          })
          realLighting.setActive(props.active)
        } else {
          const { createHybridCoordinator } = await import('@/lib/workbench/rendering/coordinator')
          if (disposed) return
          hybrid = createHybridCoordinator({
            renderer,
            scene: scene.value,
            camera: camera.value,
            invalidate: requestFrame,
            beforeRaster: () => controller?.beforeRender(),
            report: (status) => {
              if (disposed || (status.error && !ownsCurrentSelection())) return
              currentRefinement = status.phase
              report(status)
              if (status.phase === 'error' && hybrid?.snapshot().firstRasterMs === null)
                store.failed(
                  store.slug,
                  store.revision,
                  status.error ?? '三维首帧绘制失败，请重试。',
                )
            },
            reducedMotion: () => matchMedia('(prefers-reduced-motion: reduce)').matches,
          })
          context.renderer.replaceRenderFunction((notify) => {
            if (!disposed && !preparing) hybrid?.render(notify)
          })
          hybrid.setActive(props.active)
        }
      }
      controller = createStageController(
        renderer,
        scene.value,
        camera.value,
        invalidate,
        store.manual,
        (id) => {
          store.focus(id)
          store.panel = 'details'
        },
        (id, status) => motionSession.report(motionSlug, motionRevision, id, status),
        motionSession.snapshot,
        {
          allowPan: Boolean(captureSession),
          changed: (kind) => {
            hybrid?.invalidate(kind)
            realLighting?.invalidate(kind)
          },
          interaction: (value) => {
            hybrid?.setInteracting(value)
            realLighting?.setInteracting(value)
          },
        },
      )
      unregisterCapture = captureSession?.register(() => {
        const pose = controller?.snapshotCamera()
        return pose ? { ...pose, slug: motionSlug, revision: motionRevision } : undefined
      })
      if (!gpu) {
        let lostCamera: CameraSnapshot | undefined
        const resumed = () => restore(lostCamera)
        const loss = (event: Event) => {
          event.preventDefault()
          const pose = controller?.snapshotCamera(true)
          lostCamera = pose ? { ...pose, slug: motionSlug, revision: motionRevision } : undefined
          generation++
          removeFrame?.()
          controller?.setActive(false)
          controller?.unload()
          stop()
          store.failed(store.slug, store.revision, '图形连接已中断，正在等待恢复。')
        }
        const canvas = renderer.domElement
        canvas.addEventListener('webglcontextlost', loss)
        canvas.addEventListener('webglcontextrestored', resumed)
        removeListeners = () => {
          canvas.removeEventListener('webglcontextlost', loss)
          canvas.removeEventListener('webglcontextrestored', resumed)
        }
      }
      await load()
      updateActive()
    } catch (cause) {
      generation++
      removeFrame?.()
      removeFrame = undefined
      unregisterCapture?.()
      unregisterCapture = undefined
      removeListeners?.()
      removeListeners = undefined
      hybrid?.dispose()
      hybrid = undefined
      realLighting?.dispose()
      realLighting = undefined
      controller?.dispose()
      controller = undefined
      scene.value.environment = null
      environment?.dispose()
      environment = undefined
      geometryOwnership?.dispose()
      geometryOwnership = undefined
      // An error after installing the coordinator must not leave a render
      // closure pointing to a disposed instance. A retry installs a new one.
      if (gpu)
        context.renderer.replaceRenderFunction((notify) => {
          try {
            if (!disposed && context.renderer.isInitialized.value && camera.value)
              renderer.render(scene.value, camera.value)
          } finally {
            notify()
          }
        })
      stop()
      if (!disposed && !setupAbort.signal.aborted)
        store.failed(
          store.slug,
          store.revision,
          cause instanceof Error ? cause.message : '当前浏览器无法启动三维工作台。',
        )
    } finally {
      initializing = false
    }
  }
  onMounted(() => {
    void initialize()
  })
  watch(
    // Preview retry may reuse the exact config object; the selection generation
    // must still trigger a new adapter load after a binding failure.
    () => [store.product, store.revision] as const,
    () => {
      if (controller) void load()
      else void initialize()
    },
    { flush: 'post' },
  )
  watch(
    () => store.command,
    (value) => {
      if (!preparing) controller?.command(value)
    },
    { flush: 'post' },
  )
  watch(
    () => store.manualRequest,
    () => controller?.pauseObservation(),
  )
  watch(
    () => store.motionCommand,
    (value) => {
      if (!preparing) controller?.motionCommand(value)
    },
    { flush: 'post' },
  )
  watch(
    () => store.resetMotionRequest,
    () => {
      if (!preparing) controller?.resetMotion()
    },
  )
  watch(
    () => [store.finishId, store.exploded, store.actions],
    () => {
      if (!preparing) controller?.sync(store.finishId, store.exploded, store.actions)
    },
    { flush: 'post' },
  )
  watch(
    () => store.pulse,
    (value) => {
      if (!preparing) controller?.pulse(value.id)
    },
  )
  watch(() => props.active, updateActive)
  const framing = createViewportFraming(() => dirty('camera'))
  function updateFraming() {
    const current = camera.value,
      width = sizes.width.value,
      height = sizes.height.value
    if (preparing || !(current instanceof PerspectiveCamera) || !width || !height) return
    hybrid?.invalidate('size')
    realLighting?.invalidate('size')
    framing.update(
      current,
      width,
      height,
      Boolean(props.gallery),
      Boolean(props.inspector),
      Boolean(props.catalog),
    )
  }
  watch(
    () => props.active,
    (active) => {
      if (!active) framing.finish()
    },
  )
  watch(
    () =>
      [
        sizes.width.value,
        sizes.height.value,
        camera.value,
        props.gallery,
        props.inspector,
        props.catalog,
      ] as const,
    updateFraming,
    { immediate: true, flush: 'post' },
  )
  const projection = context.renderer.onRender(() => {
    controller?.project(sizes.width.value, sizes.height.value, props.place, store.selectedPart)
    props.commit()
    if (hybrid && !['sampling', 'denoising', 'blending'].includes(currentRefinement)) stop()
  })
  onScopeDispose(() => {
    framing.dispose()
    unregisterCapture?.()
    unregisterCapture = undefined
    disposed = true
    setupAbort.abort()
    selectionAbort?.abort()
    generation++
    removeFrame?.()
    projection.off()
    readyListener.off()
    removeListeners?.()
    controller?.cancelLoading()
    controller?.setActive(false)
    hybrid?.setActive(false)
    realLighting?.setActive(false)
    stop()
    // Tres recursively disposes any raw children left in its scene. Detach our
    // manually-owned model/studio helpers now; release their resources later.
    for (const child of [...scene.value.children])
      if (!('__tres' in child)) child.removeFromParent()
    afterPreparation(renderer, () => {
      try {
        hybrid?.dispose()
      } finally {
        hybrid = undefined
        try {
          realLighting?.dispose()
        } finally {
          realLighting = undefined
          try {
            controller?.dispose()
          } finally {
            if (scene.value.environment === environment?.texture) scene.value.environment = null
            if (scene.value.background === background) scene.value.background = null
            if (scene.value.fog === fog) scene.value.fog = null
            try {
              environment?.dispose()
            } finally {
              geometryOwnership?.dispose()
              geometryOwnership = undefined
            }
          }
        }
      }
    })
  })

  return {
    studio,
    stage,
    hybrid: { snapshot: () => hybrid?.snapshot() },
    realLighting: {
      snapshot: () => realLighting?.snapshot(),
      setSignals: (ssr: boolean, ssgi: boolean, denoise: boolean) =>
        realLighting?.setSignals(ssr, ssgi, denoise),
    },
    refine: () => hybrid?.refine(),
    realtime: (value: boolean) => hybrid?.setRealtime(value),
    retry: () => hybrid?.retry(),
    checkpoint() {
      const pose = controller?.snapshotCamera(true)
      return pose ? { ...pose, slug: motionSlug, revision: motionRevision } : undefined
    },
    retryStudioEnvironment: () => applyStudioMood(),
    setPanelBrightness(value: number) {
      if (disposed || preparing || !ownsCurrentSelection() || !store.available) return
      const applied = setShowroomPanelBrightness(scene.value, value)
      if (applied !== undefined) requestFrame()
      return applied
    },
  }
}

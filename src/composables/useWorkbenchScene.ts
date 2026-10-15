import { computed, nextTick, onMounted, onScopeDispose, watch } from 'vue'
import { useLoop, useTres, useTresContext } from '@tresjs/core'
import { PerspectiveCamera, Color, Fog } from 'three'
import { createBaseEnvironment, type OwnedEnvironment } from '@/lib/workbench/rendering/environment'
import { isWebGpuRenderer, type WorkbenchRenderer } from '@/lib/workbench/rendering/rendererTypes'
import type { HybridCoordinator } from '@/lib/workbench/rendering/coordinator'
import type { RefinementStatus, RefinementChange } from '@/lib/workbench/rendering/refinementTypes'
import type { RealtimeCoordinator } from '@/lib/workbench/rendering/realtime/coordinator'
import type { RealtimeStatus } from '@/lib/workbench/rendering/realtime/types'
import type { ownGeometryAttributes } from '@/lib/workbench/rendering/realtime/geometryOwnership'
import { createStageController } from '@/lib/workbench/controller'
import { hasTypewriterStudio, resolveWorkbenchStage } from '@/lib/workbench/studioPreset'
import { useWorkbenchStore } from '@/stores/workbench'
import { useMotionSession } from '@/lib/workbench/motionSession'
import { useCameraCaptureSession, type CameraSnapshot } from '@/lib/workbench/cameraCapture'
import type { PlaceCallout } from '@/lib/workbench/calloutProjection'
import { createViewportFraming } from '@/lib/workbench/viewportFraming'
import type { StudioMood, StudioEnvironmentStatus } from '@/lib/workbench/studio/mood'

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
  const { scene, camera, sizes, invalidate } = useTres()
  const context = useTresContext()
  const renderer = context.renderer.instance as WorkbenchRenderer
  const gpu = isWebGpuRenderer(renderer)
  let currentRefinement: RefinementStatus['phase'] = 'raster'
  let hybrid: HybridCoordinator | undefined
  let realLighting: RealtimeCoordinator | undefined
  const setupAbort = new AbortController()
  const requestFrame = () => {
    if (
      props.active &&
      !realLighting?.snapshot().error &&
      context.renderer.isInitialized.value &&
      !isActive.value
    )
      start()
    invalidate()
  }
  const dirty = (kind: RefinementChange = 'all') => {
    hybrid?.invalidate(kind)
    realLighting?.invalidate(kind)
    invalidate()
  }
  const { start, stop, isActive, onBeforeRender } = useLoop()
  const background = new Color('#151c25')
  const fog = new Fog(background, 12, 38)
  scene.value.background = background
  scene.value.fog = fog
  const studio = computed(() => hasTypewriterStudio(store.presentation))
  const stage = computed(() =>
    resolveWorkbenchStage(
      store.presentation,
      Boolean(props.gallery),
      gpu && Boolean(props.realtimePipeline),
      props.studioMood,
    ),
  )
  watch(
    stage,
    (value) => {
      background.set(value.background)
      fog.color.copy(background)
      scene.value.environmentIntensity = value.environmentIntensity
      renderer.toneMappingExposure = value.exposure
      dirty('environment')
    },
    { immediate: true },
  )
  let controller: ReturnType<typeof createStageController> | undefined
  function applyStudioMood() {
    if (disposed || !gpu || !props.realtimePipeline || !studio.value) return
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
  watch(() => props.studioMood, applyStudioMood)
  onBeforeRender(() => {
    if (!gpu) controller?.beforeRender()
  })
  let geometryOwnership: ReturnType<typeof ownGeometryAttributes> | undefined
  let environment: OwnedEnvironment | undefined,
    disposed = false,
    generation = 0
  let removeFrame: (() => void) | undefined, removeListeners: (() => void) | undefined
  async function load() {
    const request = ++generation
    removeFrame?.()
    removeFrame = undefined
    hybrid?.unload()
    realLighting?.unload()
    controller?.unload()
    const product = store.product,
      revision = store.revision
    if (!controller || !product) return
    // A failed frame pauses both clocks. Explicit retry clears that error above
    // and must restore current visibility before waiting for its new first frame.
    updateActive()
    motionSlug = product.slug
    motionRevision = revision
    try {
      const loaded = await controller.load(product, (phase) => {
        if (!disposed && request === generation) store.loading(product.slug, revision, phase)
      })
      if (!loaded || disposed || request !== generation) return
      applyStudioMood()
      controller.sync(store.finishId, store.exploded, store.actions, true)
      if (props.checkpoint?.slug === product.slug && props.checkpoint.revision === revision) {
        controller.restoreCamera(props.checkpoint)
        controller.restoreSelection(store.selectedPart)
      }
      if (!camera.value) return
      store.loading(product.slug, revision, 'first-frame')
      realLighting?.prepare()
      await renderer.compileAsync(scene.value, camera.value)
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
    }
  }
  function updateActive() {
    const active = props.active && !realLighting?.snapshot().error
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
      environment = await createBaseEnvironment(renderer, setupAbort.signal)
      if (disposed) {
        environment.dispose()
        return
      }
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
              reportRealtime(status)
              if (status.error) {
                store.failed(store.slug, store.revision, status.error)
                updateActive()
              }
            },
          })
          context.renderer.replaceRenderFunction((notify) => realLighting?.render(notify))
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
          context.renderer.replaceRenderFunction((notify) => hybrid?.render(notify))
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
    (value) => controller?.command(value),
    { flush: 'post' },
  )
  watch(
    () => store.manualRequest,
    () => controller?.pauseObservation(),
  )
  watch(
    () => store.motionCommand,
    (value) => controller?.motionCommand(value),
    { flush: 'post' },
  )
  watch(
    () => store.resetMotionRequest,
    () => controller?.resetMotion(),
  )
  watch(
    () => [store.finishId, store.exploded, store.actions],
    () => controller?.sync(store.finishId, store.exploded, store.actions),
    { flush: 'post' },
  )
  watch(
    () => store.pulse,
    (value) => controller?.pulse(value.id),
  )
  watch(() => props.active, updateActive)
  const framing = createViewportFraming(() => dirty('camera'))
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
    ([width, height, current, gallery, inspector, catalog]) => {
      if (!(current instanceof PerspectiveCamera) || !width || !height) return
      hybrid?.invalidate('size')
      realLighting?.invalidate('size')
      framing.update(current, width, height, Boolean(gallery), Boolean(inspector), Boolean(catalog))
    },
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
    disposed = true
    setupAbort.abort()
    generation++
    removeFrame?.()
    projection.off()
    readyListener.off()
    removeListeners?.()
    hybrid?.dispose()
    hybrid = undefined
    realLighting?.dispose()
    realLighting = undefined
    controller?.dispose()
    stop()
    if (scene.value.environment === environment?.texture) scene.value.environment = null
    if (scene.value.background === background) scene.value.background = null
    if (scene.value.fog === fog) scene.value.fog = null
    environment?.dispose()
    geometryOwnership?.dispose()
    geometryOwnership = undefined
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
    retryStudioEnvironment: applyStudioMood,
  }
}

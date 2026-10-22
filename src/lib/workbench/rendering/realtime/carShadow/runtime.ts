import { Vector2, type Object3D } from 'three'
import type { PerspectiveCamera, Scene, WebGPURenderer } from 'three/webgpu'
import { afterPreparation } from '../../preparationLease'
import type { createRealtimeSceneInputs } from '../sceneInputs'
import type { RealtimeChange } from '../types'
import type { CarShadowBvh } from './bvh'
import { CarKeyAreaLight } from './light'
import { createCarShadowVisibility } from './visibility'

export interface CarKeyShadowSnapshot {
  requested: boolean
  phase: 'disabled' | 'loading' | 'ready' | 'error'
  error: string | null
  generation: number
  frames: number
  blasBuilds: number
  transformUpdates: number
  historyResets: number
  stage: string
  details: unknown
}

/** CPU construction starts after first raster. Native compilation is requested
 * explicitly by the existing coordinator, outside drawing and DDGI submission.
 */
export function createCarKeyShadow(
  renderer: WebGPURenderer,
  scene: Scene,
  camera: PerspectiveCamera,
  inputs: ReturnType<typeof createRealtimeSceneInputs>,
  requested: boolean,
) {
  let root: Object3D | undefined, light: CarKeyAreaLight | undefined
  scene.traverse((object) => {
    if (object.userData.adapter === 'reventon-v1' && object.userData.carStudioQuality === 'studio')
      root = object
    if (object instanceof CarKeyAreaLight) light = object
  })
  const enabled = requested && Boolean(root && light),
    size = new Vector2()
  let phase: CarKeyShadowSnapshot['phase'] = enabled ? 'loading' : 'disabled',
    stage = 'idle',
    error: string | null = null,
    disposed = false,
    active = true,
    generation = 1,
    historyResets = 0,
    frames = 0,
    blasBuilds = 0,
    controller: AbortController | undefined,
    bvh: CarShadowBvh | undefined,
    visibility: ReturnType<typeof createCarShadowVisibility> | undefined,
    compilationError: string | null = null,
    bound = false

  const retire = () => {
    const oldVisibility = visibility,
      oldBvh = bvh,
      oldController = controller
    visibility = undefined
    bvh = undefined
    controller = undefined
    if (bound) {
      inputs.setKeyShadow()
      bound = false
    }
    afterPreparation(renderer, () => {
      oldVisibility?.dispose()
      oldBvh?.dispose()
      oldController?.abort()
    })
  }
  const fail = (cause: unknown) => {
    if (disposed) return
    generation++
    error = cause instanceof Error ? cause.message : String(cause)
    phase = 'error'
    stage = 'failed'
    retire()
  }
  return {
    start() {
      if (!enabled || disposed || !active || stage !== 'idle' || !root) return
      stage = 'building'
      const token = ++generation,
        abort = new AbortController()
      controller = abort
      void import('./bvh')
        .then(({ createCarShadowBvh }) => createCarShadowBvh(root!, abort.signal))
        .then((result) => {
          if (disposed || token !== generation || abort.signal.aborted) {
            result.dispose()
            return
          }
          bvh = result
          blasBuilds++
          stage = 'waiting'
        })
        .catch((cause: unknown) => {
          if (!disposed && token === generation && !abort.signal.aborted) fail(cause)
        })
    },
    needsPreparation: () => !disposed && active && stage === 'waiting',
    isCompiling: () => stage === 'compiling',
    compilationFailed(message: string) {
      compilationError = message
    },
    async prepare(signal?: AbortSignal) {
      if (disposed || stage !== 'waiting' || !bvh || !light) return
      stage = 'compiling'
      compilationError = null
      try {
        signal?.throwIfAborted()
        visibility = createCarShadowVisibility(
          renderer,
          camera,
          {
            depth: inputs.depth,
            normal: inputs.normal,
            velocity: inputs.velocity,
            receiverMask: inputs.diffuseResponse,
          },
          light,
          bvh,
        )
        renderer.getDrawingBufferSize(size)
        visibility.prepare(size.x, size.y)
        inputs.setKeyShadow({ visibility: visibility.node, depth: inputs.depth })
        bound = true
        await inputs.prepare(renderer, signal)
        await visibility.prepareShaders(signal)
        const device: unknown = Reflect.get(renderer.backend, 'device')
        const queue: unknown =
          device && typeof device === 'object' ? Reflect.get(device, 'queue') : undefined
        const wait: unknown =
          queue && typeof queue === 'object' ? Reflect.get(queue, 'onSubmittedWorkDone') : undefined
        if (typeof wait !== 'function')
          throw new Error('Car shadow preparation requires the native WebGPU queue')
        await wait.call(queue)
        signal?.throwIfAborted()
        if (disposed) return
        if (compilationError) throw new Error(compilationError)
        visibility.cancelFrame()
        stage = 'prepared'
      } catch (cause) {
        if (!disposed) fail(cause)
      }
    },
    prepareFrame(width: number, height: number) {
      if (!visibility || !bvh || (stage !== 'prepared' && stage !== 'active')) return
      // A moving off-screen caster can affect a static receiver. Without a
      // reliable influence region invalidate this signal, not just its pixels.
      if (bvh.sync()) {
        visibility.resetHistory()
        historyResets++
      }
      visibility.prepare(width, height)
    },
    commitFrame() {
      if (!visibility || (stage !== 'prepared' && stage !== 'active')) return
      visibility.commitFrame()
      frames++
      stage = 'active'
      phase = 'ready'
    },
    cancelFrame() {
      visibility?.cancelFrame()
    },
    fail,
    invalidate(kind: RealtimeChange) {
      if (kind !== 'camera' && kind !== 'pose') {
        visibility?.resetHistory()
        historyResets++
      }
    },
    setActive(value: boolean) {
      active = value
      if (!value && stage === 'building') {
        generation++
        controller?.abort()
        controller = undefined
        stage = 'idle'
      }
      if (!value) visibility?.resetHistory()
    },
    snapshot: (): CarKeyShadowSnapshot => ({
      requested: enabled,
      phase,
      error,
      generation,
      frames,
      blasBuilds,
      transformUpdates: bvh?.snapshot().transformUpdates ?? 0,
      historyResets,
      stage,
      details: { bvh: bvh?.snapshot() ?? null, history: visibility?.snapshot() ?? null },
    }),
    dispose() {
      if (disposed) return
      disposed = true
      generation++
      if (stage === 'building') controller?.abort()
      retire()
      stage = 'disposed'
    },
  }
}

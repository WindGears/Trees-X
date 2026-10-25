import {
  Box3,
  Color,
  Light,
  MeshBasicMaterial,
  RectAreaLight,
  Scene,
  Vector3,
  type Camera,
  type Group,
  type Object3D,
} from 'three'
import type { WebGPURenderer } from 'three/webgpu'
import { isAuditedReventonSource } from '../../reventonCandidate'
import type { ReventonStage, ReventonStageOptions } from '../../reventonStage'
import { reventonMotionEnvelope } from '../realtime/productProfile'
import { coldStudioConfig } from './config'
import { createColdStudioGeometry } from './geometry'
import { createShowroomCutaway } from './fade'
import { configureShowroomLight, createShowroomAreaLight } from './lights'
import { createColdStudioProbe } from './probe'
import { setShowroomEnvironment, setShowroomStatus } from './binding'
import { ownShowroomNativeMaterials } from './nativeMaterials'
import { loadShowroomAssets } from './assets'
import { ownShowroomPanelBrightness } from './panelBrightness'
import { loadBakedStudioProbe } from './bakedProbe'

export function coldStudioRequested(options: ReventonStageOptions | undefined, search: string) {
  return (
    new URLSearchParams(search).get('carShowroom') === 'cold-studio' &&
    options?.quality === 'studio' &&
    Boolean(options.source && isAuditedReventonSource(options.source))
  )
}

/** Own the room and static capture; borrow the host, current camera and car.
 * Construction never changes product materials or creates a second renderer.
 */
export function createColdShowroomStage(
  renderer: WebGPURenderer,
  scene: Scene,
  model: Group,
  camera: Camera,
  base: ReventonStage,
): ReventonStage {
  const config = coldStudioConfig,
    floorMode = new URLSearchParams(typeof location === 'undefined' ? '' : location.search).get(
      'carFloor',
    ),
    bakedFloor = floorMode === 'baked' || floorMode === 'cycles',
    bakeKind = floorMode === 'cycles' ? 'cycles' : 'raster',
    localFloorLight =
      floorMode === 'cycles' &&
      new URLSearchParams(typeof location === 'undefined' ? '' : location.search).get(
        'carFloorLight',
      ) === 'local',
    room = createColdStudioGeometry(config),
    cutaway = createShowroomCutaway(
      room.fadeMeshes,
      camera,
      new Box3(
        new Vector3(...reventonMotionEnvelope.min),
        new Vector3(...reventonMotionEnvelope.max),
      ),
    ),
    previous = {
      background: scene.background,
      fog: scene.fog,
      rotation: scene.environmentRotation.clone(),
      intensity: scene.environmentIntensity,
      exposure: renderer.toneMappingExposure,
    },
    lights: { light: Light; intensity: number }[] = [],
    additionalLights: RectAreaLight[] = [],
    lifecycle = new AbortController(),
    hidden: { object: Object3D; visible: boolean }[] = [],
    status = {
      requested: true,
      phase: 'preparing',
      error: null as string | null,
      revision: config.revision,
      panelBrightness: 1,
      floorReflection: 'screen-space+room-probe',
      floorLight: localFloorLight ? 'local-area+indirect-probe' : 'full-probe',
      probe: null as unknown,
      fade: [] as ReturnType<typeof cutaway.snapshot>,
    }
  let full: Awaited<ReturnType<typeof createColdStudioProbe>> | undefined,
    assets: Awaited<ReturnType<typeof loadShowroomAssets>> | undefined,
    indirect: Awaited<ReturnType<typeof createColdStudioProbe>> | undefined,
    native: ReturnType<typeof ownShowroomNativeMaterials> | undefined,
    oldEnvironment = scene.environment,
    oldTrace: unknown,
    prepared = false,
    disposed = false,
    cleaned = false,
    preparing = false,
    last = performance.now(),
    lastReport = -Infinity
  let traceDescriptor = Object.getOwnPropertyDescriptor(scene.userData, 'traceBackground')
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')
  model.userData.carShowroom = status
  setShowroomStatus(scene, status)
  const panelBrightness = ownShowroomPanelBrightness(
    scene,
    room.panels,
    () => prepared && !disposed && status.phase === 'ready',
    (value) => {
      status.panelBrightness = value
    },
  )
  scene.add(room.root)
  scene.background = new Color('#15171a')
  scene.fog = null
  scene.environmentRotation.set(0, 0, 0)
  scene.environmentIntensity = 1
  renderer.toneMappingExposure = config.exposure
  const neutralize = () => {
    const root = scene.getObjectByName('workbench-lighting')
    root?.traverse((object) => {
      if (object instanceof Light && !lights.some((entry) => entry.light === object)) {
        lights.push({ light: object, intensity: object.intensity })
      }
      if (object instanceof Light) object.intensity = 0
    })
    const ground = scene.getObjectByName('workbench-ground')
    if (ground && !hidden.some((entry) => entry.object === ground)) {
      hidden.push({ object: ground, visible: ground.visible })
    }
    if (ground) ground.visible = false
  }
  neutralize()
  for (const [name, input] of [
    ['Reventon / key softbox', config.lights.key],
    ['Reventon / reflection strip', config.lights.strip],
  ] as const) {
    const light = scene.getObjectByName(name)
    if (light instanceof RectAreaLight) configureShowroomLight(light, input)
  }
  function cleanup() {
    if (cleaned || preparing) return
    cleaned = true
    setShowroomEnvironment(scene)
    setShowroomStatus(scene)
    panelBrightness.dispose()
    native?.dispose()
    cutaway.dispose()
    room.dispose()
    for (const light of additionalLights) {
      light.removeFromParent()
      light.dispose()
    }
    assets?.dispose()
    for (const entry of lights) entry.light.intensity = entry.intensity
    for (const entry of hidden) entry.object.visible = entry.visible
    scene.background = previous.background
    scene.fog = previous.fog
    scene.environmentRotation.copy(previous.rotation)
    scene.environmentIntensity = previous.intensity
    renderer.toneMappingExposure = previous.exposure
    if (scene.environment === full?.texture) scene.environment = oldEnvironment
    if (scene.userData.traceBackground === indirect?.texture) {
      if (traceDescriptor)
        Object.defineProperty(scene.userData, 'traceBackground', {
          ...traceDescriptor,
          value: oldTrace,
        })
      else delete scene.userData.traceBackground
    }
    full?.dispose()
    indirect?.dispose()
    base.dispose()
    delete model.userData.carShowroom
  }
  return {
    async prepare(signal?: AbortSignal) {
      signal = signal ? AbortSignal.any([signal, lifecycle.signal]) : lifecycle.signal
      signal?.throwIfAborted()
      if (disposed) throw new Error('Cold studio has been disposed')
      if (prepared) return
      preparing = true
      const captureScene = new Scene(),
        captureLights: RectAreaLight[] = []
      let captureRoom: ReturnType<typeof createColdStudioGeometry> | undefined
      try {
        assets = await loadShowroomAssets(signal)
        signal.throwIfAborted()
        if (disposed) throw new Error('Cold studio assets were superseded')
        room.applySurfaces(assets)
        if (!bakedFloor) {
          captureRoom = createColdStudioGeometry(config)
          captureRoom.applySurfaces(assets)
        }
        for (const input of [config.lights.fill, config.lights.rim]) {
          const light = createShowroomAreaLight(renderer, input)
          additionalLights.push(light)
          scene.add(light)
        }
        if (captureRoom) {
          for (const input of Object.values(config.lights))
            captureLights.push(createShowroomAreaLight(renderer, input))
          captureScene.add(captureRoom.root, ...captureLights)
        }
        oldEnvironment = scene.environment
        oldTrace = scene.userData.traceBackground
        traceDescriptor = Object.getOwnPropertyDescriptor(scene.userData, 'traceBackground')
        full = bakedFloor
          ? await loadBakedStudioProbe(renderer, config, 'specular', signal, bakeKind)
          : await createColdStudioProbe(renderer, captureScene, config, signal)
        signal?.throwIfAborted()
        if (disposed) throw new Error('Cold studio capture was superseded')
        for (const panel of captureRoom?.panels ?? [])
          if (panel.material instanceof MeshBasicMaterial) panel.material.color.set(0)
        indirect = bakedFloor
          ? await loadBakedStudioProbe(renderer, config, 'indirect', signal, bakeKind)
          : await createColdStudioProbe(renderer, captureScene, config, signal, {
              role: 'indirect',
            })
        signal?.throwIfAborted()
        if (disposed) throw new Error('Cold studio capture was superseded')
        if (bakedFloor) {
          room.root.traverse((object) => {
            if (object.userData.showroomId === 'floor') {
              object.userData.bakedFloorReflection = true
              object.userData.bakedFloorLocalLight = localFloorLight
            }
          })
          status.floorReflection =
            floorMode === 'cycles'
              ? 'cycles-room-probe; no-car-reflection'
              : 'baked-room-probe; no-car-reflection'
        }
        native = ownShowroomNativeMaterials(model)
        scene.environment = full.texture
        scene.userData.traceBackground = indirect.texture
        setShowroomEnvironment(scene, {
          texture: full.texture,
          irradiance: indirect.texture,
          config,
        })
        status.probe = {
          captures: full.snapshot.faces,
          resolution: full.snapshot.faceResolution,
          ...full.snapshot,
          indirect: indirect.snapshot,
          totalFaceDraws: bakedFloor ? 0 : 12,
          source: bakedFloor
            ? floorMode === 'cycles'
              ? 'cycles-r10'
              : 'baked-r10'
            : 'runtime-capture',
        }
        status.phase = 'ready'
      } catch (cause) {
        for (const light of additionalLights.splice(0)) {
          light.removeFromParent()
          light.dispose()
        }
        full?.dispose()
        full = undefined
        indirect?.dispose()
        indirect = undefined
        status.phase = 'error'
        status.error = cause instanceof Error ? cause.message : String(cause)
        signal?.throwIfAborted()
        if (disposed) throw cause
        // Keep the existing EXR and fully operable raster stage on capture failure.
        console.warn('Trees X / cold studio fallback:', status.error)
      } finally {
        captureScene.clear()
        for (const light of captureLights) light.dispose()
        captureRoom?.dispose()
        if (disposed || signal?.aborted) {
          preparing = false
          if (disposed) cleanup()
        }
      }
      try {
        signal?.throwIfAborted()
        if (disposed) throw new Error('Cold studio has been disposed')
        await base.prepare(signal)
        if (disposed) throw new Error('Cold studio has been disposed')
        prepared = true
      } finally {
        preparing = false
        if (disposed) cleanup()
      }
    },
    markDirty: () => base.markDirty(),
    render() {
      if (disposed) return
      neutralize()
      native?.sync()
      const now = performance.now()
      cutaway.tick((now - last) / 1000, reducedMotion.matches)
      last = now
      if (now - lastReport > 500) {
        lastReport = now
        status.fade = cutaway.snapshot()
      }
      base.render()
    },
    dispose() {
      if (!disposed) {
        disposed = true
        lifecycle.abort(new DOMException('Cold studio disposed', 'AbortError'))
        cleanup()
      }
    },
  }
}

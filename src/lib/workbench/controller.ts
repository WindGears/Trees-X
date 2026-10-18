import { gsap } from 'gsap'
import { Vector2, Vector3, Spherical, Raycaster, type PerspectiveCamera, type Scene } from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import type { SceneAdapter } from './adapter'
import type { WorkbenchRenderer } from './rendering/rendererTypes'
import type { RefinementChange } from './rendering/refinementTypes'
import { loadAdapter } from './loadAdapter'
import { ResourceSlot } from './resourceSlot'
import { parseProduct } from './api'
import type { LoadPhase } from './assetBundle'
import type { SceneCommand, Vec3, WorkbenchProduct } from './types'
import type { MotionCommand, MotionStatus } from './types'
import { progressActions } from './motionConfig'
import { createMotionPlayback, type MotionFeedback } from './motionPlayback'
import { structureReveal, type PlaceCallout } from './calloutProjection'
import type { StudioMoodUpdate } from './studio/mood'

export function createStageController(
  renderer: WorkbenchRenderer,
  scene: Scene,
  camera: PerspectiveCamera,
  invalidate: () => void,
  manual: () => void,
  focus: (id: string) => void,
  feedback: MotionFeedback = () => {},
  checkpoint: () => Record<string, MotionStatus> = () => ({}),
  options: {
    allowPan?: boolean
    changed?: (kind: RefinementChange) => void
    interaction?: (active: boolean) => void
  } = {},
) {
  let disposed = false
  const dirty = (kind: RefinementChange) => {
    if (disposed) return
    options.changed?.(kind)
    invalidate()
  }
  const slot = new ResourceSlot<SceneAdapter>()
  const baseEnvironment = scene.environment
  let interactive = false
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enabled = false
  controls.enablePan = Boolean(options.allowPan)
  controls.enableDamping = false
  controls.maxPolarAngle = Math.PI * 0.49
  let adapter: SceneAdapter | undefined, product: WorkbenchProduct | undefined
  let cameraTween: gsap.core.Tween | undefined
  let progress: ReturnType<typeof createMotionPlayback> | undefined
  let focusedPart: string | undefined
  const motion = new Set<gsap.core.Animation>()
  const destination = new Vector3(),
    point = new Vector3(),
    projected = new Vector3()
  const pointer = new Vector2(),
    raycaster = new Raycaster()
  const orbit = new Spherical()
  let downX = 0,
    downY = 0,
    active = true
  let interacting = false
  const heldPointers = new Map<number, string>()
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches
  function stopCamera() {
    cameraTween?.kill()
    cameraTween = undefined
  }
  function takeover() {
    if (!active || !controls.enabled) return
    interacting = true
    options.interaction?.(true)
    dirty('camera')
    stopCamera()
    progress?.pauseAll()
    manual()
  }
  // OrbitControls sends an event; Tres invalidate accepts a frame count. Forward
  // no arguments so a change at an idle frame cannot poison that count with NaN.
  const changed = () => dirty('camera')
  function endInteraction() {
    if (!interacting) return
    interacting = false
    options.interaction?.(false)
  }
  function cancelInteraction() {
    // Disabling OrbitControls does not clear its captured pointer IDs. Send the
    // normal cancellation event so a new product cannot inherit an old drag.
    for (const [pointerId, pointerType] of heldPointers)
      renderer.domElement.dispatchEvent(
        new PointerEvent('pointercancel', { pointerId, pointerType }),
      )
    heldPointers.clear()
    endInteraction()
  }
  function forgetPointer(event: PointerEvent) {
    heldPointers.delete(event.pointerId)
    if (heldPointers.size === 0) endInteraction()
  }
  controls.addEventListener('start', takeover)
  controls.addEventListener('end', endInteraction)
  controls.addEventListener('change', changed)
  function move(position: Vec3, target: Vec3, instant = false) {
    if (disposed) return
    stopCamera()
    const jump = instant || reduced()
    const state = {
      x: camera.position.x,
      y: camera.position.y,
      z: camera.position.z,
      tx: controls.target.x,
      ty: controls.target.y,
      tz: controls.target.z,
    }
    const update = () => {
      camera.position.set(state.x, state.y, state.z)
      controls.target.set(state.tx, state.ty, state.tz)
      controls.update()
      dirty(jump ? 'camera-cut' : 'camera')
    }
    cameraTween = gsap.to(state, {
      x: position[0],
      y: position[1],
      z: position[2],
      tx: target[0],
      ty: target[1],
      tz: target[2],
      duration: jump ? 0 : 0.65,
      ease: 'power3.out',
      onUpdate: update,
    })
  }
  function animate(values: Record<string, number>, pulse = false) {
    if (!adapter) return
    const current = adapter
    const jump = reduced()
    // Actions blend independently; only the same pose channels replace each other.
    const tween = gsap.to(current.pose, {
      paused: true,
      ...values,
      duration: jump ? 0 : pulse ? 0.18 : 0.55,
      repeat: pulse && !jump ? 1 : 0,
      yoyo: pulse && !jump,
      overwrite: 'auto',
      ease: pulse ? 'power1.inOut' : 'power3.out',
      onUpdate: () => {
        current.apply()
        dirty(jump ? 'pose-jump' : 'pose')
      },
      onComplete: () => {
        motion.delete(tween)
        if (pulse) {
          for (const id of Object.keys(values)) current.pose[id] = 0
          current.apply()
          dirty(jump ? 'pose-jump' : 'pose')
        }
      },
      onInterrupt: () => motion.delete(tween),
    })
    motion.add(tween)
    if (active) tween.play()
  }
  function unload() {
    controls.enabled = false
    cancelInteraction()
    stopCamera()
    progress?.dispose()
    progress = undefined
    motion.forEach((t) => t.kill())
    motion.clear()
    scene.environment = baseEnvironment
    delete scene.userData.traceBackground
    slot.clear()
    interactive = false
    focusedPart = undefined
    adapter = undefined
    product = undefined
    controls.enabled = false
  }
  async function load(value: WorkbenchProduct, phase: (p: LoadPhase) => void) {
    if (disposed) return
    unload()
    const snapshot = parseProduct(value)
    const loaded = await slot.load((signal) => loadAdapter(snapshot, renderer, signal, phase))
    if (!loaded) return
    product = snapshot
    adapter = loaded
    scene.add(loaded.root)
    loaded.attach?.(scene, renderer)
    progress = createMotionPlayback(
      loaded,
      progressActions(snapshot.presentation),
      dirty,
      feedback,
      reduced,
      checkpoint(),
    )
    scene.environment = loaded.environment ?? baseEnvironment
    scene.userData.traceBackground = loaded.traceBackground
    dirty('all')
    controls.minDistance = snapshot.presentation.camera.minDistance
    controls.maxDistance = snapshot.presentation.camera.maxDistance
    move(snapshot.presentation.camera.position, snapshot.presentation.camera.target, true)
    return loaded
  }
  function command(value: SceneCommand) {
    if (!adapter || !product) return
    if (value.kind === 'view') {
      focusedPart = undefined
      adapter.select?.()
      dirty('materials')
      const view = product.presentation.views.find((v) => v.id === value.id)
      if (view) move(view.position, view.target)
    } else if (value.kind === 'focus') {
      const hotspot = product.presentation.hotspots.find((h) => h.id === value.id)
      if (hotspot && adapter.point(hotspot.node, point, hotspot.anchor)) {
        focusedPart = hotspot.id
        adapter.select?.(hotspot.node)
        dirty('materials')
        destination.copy(point).add(new Vector3(...hotspot.cameraOffset))
        move(destination.toArray() as Vec3, point.toArray() as Vec3)
      }
    } else if (value.kind === 'orbit') {
      stopCamera()
      destination.copy(camera.position).sub(controls.target)
      orbit.setFromVector3(destination)
      if (value.axis === 'horizontal') orbit.theta += (value.direction ?? 1) * 0.12
      else
        orbit.phi = Math.min(
          controls.maxPolarAngle,
          Math.max(0.05, orbit.phi + (value.direction ?? 1) * 0.1),
        )
      destination.setFromSpherical(orbit)
      camera.position.copy(controls.target).add(destination)
      controls.update()
      dirty('camera-cut')
    } else if (value.kind === 'zoom') {
      stopCamera()
      destination.copy(camera.position).sub(controls.target)
      destination.setLength(
        Math.min(
          controls.maxDistance,
          Math.max(
            controls.minDistance,
            destination.length() * (value.direction === 1 ? 0.82 : 1.22),
          ),
        ),
      )
      camera.position.copy(controls.target).add(destination)
      controls.update()
      dirty('camera-cut')
    }
  }
  function down(event: PointerEvent) {
    if (controls.enabled) heldPointers.set(event.pointerId, event.pointerType)
    if (interactive) dirty('camera')
    downX = event.clientX
    downY = event.clientY
  }
  function up(event: PointerEvent) {
    if (
      event.button !== 0 ||
      !adapter ||
      !product ||
      !controls.enabled ||
      Math.hypot(event.clientX - downX, event.clientY - downY) > 5
    )
      return
    const rect = renderer.domElement.getBoundingClientRect()
    pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      (-(event.clientY - rect.top) / rect.height) * 2 + 1,
    )
    raycaster.setFromCamera(pointer, camera)
    const hit = raycaster.intersectObject(adapter.root, true)[0]
    let object = hit && (adapter.nodeForHit?.(hit.object, hit.instanceId) ?? hit.object)
    while (object && object !== adapter.root) {
      const hotspot = product.presentation.hotspots.find((h) => h.node === object!.name)
      if (hotspot) {
        focus(hotspot.id)
        return
      }
      object = object.parent ?? undefined
    }
  }
  renderer.domElement.addEventListener('pointerdown', down)
  renderer.domElement.addEventListener('pointerup', up)
  renderer.domElement.ownerDocument.addEventListener('pointerup', forgetPointer)
  renderer.domElement.addEventListener('pointercancel', forgetPointer)
  return {
    load,
    unload,
    command,
    beforeRender: () => adapter?.beforeRender?.(),
    setStudioMood: (update: StudioMoodUpdate) => adapter?.setStudioMood?.(update),
    enableInteraction() {
      if (disposed) return
      interactive = true
      controls.enabled = active && Boolean(adapter)
    },
    stopCamera,
    restoreCamera: (pose: { position: Vec3; target: Vec3 }) =>
      move(pose.position, pose.target, true),
    snapshotCamera(allowInactive = false) {
      if ((!active && !allowInactive) || !interactive || !adapter || !product) return
      stopCamera()
      progress?.pauseAll()
      manual()
      motion.forEach((t) => t.pause())
      return {
        position: camera.position.toArray() as Vec3,
        target: controls.target.toArray() as Vec3,
      }
    },
    restoreSelection(id?: string) {
      if (!adapter || !product) return
      const hotspot = product.presentation.hotspots.find((item) => item.id === id)
      focusedPart = hotspot?.id
      adapter.select?.(hotspot?.node)
      dirty('materials')
    },
    pauseObservation() {
      stopCamera()
      progress?.pauseAll()
    },
    motionCommand(command: MotionCommand) {
      if (active && interactive) progress?.command(command)
    },
    resetMotion() {
      motion.forEach((t) => t.kill())
      motion.clear()
      progress?.reset()
      if (adapter && product) {
        for (const action of product.presentation.actions) adapter.pose[action.id] = 0
        adapter.apply()
        dirty('pose-jump')
      }
    },
    sync(finishId: string, exploded: boolean, actions: Record<string, number>, instant = false) {
      if (!adapter || !product) return
      const color = product.presentation.finishes.find((f) => f.id === finishId)?.color
      if (color) {
        adapter.setFinish(color)
        dirty('materials')
      }
      const values: Record<string, number> = {
        explosion: product.presentation.structureActionId ? 0 : exploded ? 1 : 0,
      }
      for (const action of product.presentation.actions)
        if (action.kind === 'toggle') values[action.id] = actions[action.id] ?? 0
      if (instant) {
        Object.assign(adapter.pose, values)
        adapter.apply()
        dirty('pose-jump')
      } else animate(values)
    },
    pulse(id: string) {
      if (adapter && product?.presentation.actions.some((a) => a.id === id && a.kind === 'pulse'))
        animate({ [id]: 1 }, true)
    },
    project(width: number, height: number, place: PlaceCallout, selectedPart?: string) {
      if (!adapter || !product) return
      const reveal = structureReveal(product.presentation, adapter.pose)
      for (const hotspot of product.presentation.hotspots) {
        if (hotspot.marker === false && hotspot.id !== (selectedPart ?? focusedPart)) continue
        if (!adapter.point(hotspot.node, point, hotspot.anchor)) {
          place(hotspot.id, 0, 0, false, reveal)
          continue
        }
        projected.copy(point).project(camera)
        const x = (projected.x * 0.5 + 0.5) * width,
          y = (-projected.y * 0.5 + 0.5) * height
        place(
          hotspot.id,
          x,
          y,
          projected.z > -1 &&
            projected.z < 1 &&
            x >= 16 &&
            x <= width - 16 &&
            y >= 16 &&
            y <= height - 16,
          reveal,
        )
      }
    },
    setActive(value: boolean) {
      if (disposed) return
      if (!value) {
        controls.enabled = false
        cancelInteraction()
      }
      active = value
      controls.enabled = value && interactive && Boolean(adapter)
      if (!value) {
        stopCamera()
        motion.forEach((t) => t.pause())
        progress?.pauseAll()
      }
      if (value) invalidate()
    },
    dispose() {
      if (disposed) return
      disposed = true
      unload()
      controls.removeEventListener('start', takeover)
      controls.removeEventListener('end', endInteraction)
      controls.removeEventListener('change', changed)
      controls.dispose()
      renderer.domElement.removeEventListener('pointerdown', down)
      renderer.domElement.removeEventListener('pointerup', up)
      renderer.domElement.ownerDocument.removeEventListener('pointerup', forgetPointer)
      renderer.domElement.removeEventListener('pointercancel', forgetPointer)
    },
  }
}

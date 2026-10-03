import { gsap } from 'gsap'
import {
  Vector2,
  Vector3,
  Raycaster,
  type PerspectiveCamera,
  type WebGLRenderer,
  type Scene,
} from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import type { SceneAdapter } from './adapter'
import { loadAdapter } from './loadAdapter'
import { ResourceSlot } from './resourceSlot'
import { parseProduct } from './api'
import type { LoadPhase } from './assetBundle'
import type { SceneCommand, Vec3, WorkbenchProduct } from './types'

export function createStageController(
  renderer: WebGLRenderer,
  scene: Scene,
  camera: PerspectiveCamera,
  invalidate: () => void,
  manual: () => void,
  focus: (id: string) => void,
) {
  const slot = new ResourceSlot<SceneAdapter>()
  const baseEnvironment = scene.environment
  let interactive = false
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enabled = false
  controls.enablePan = false
  controls.enableDamping = false
  controls.maxPolarAngle = Math.PI * 0.49
  let adapter: SceneAdapter | undefined, product: WorkbenchProduct | undefined
  let cameraTween: gsap.core.Tween | undefined
  const motion = new Set<gsap.core.Animation>()
  const destination = new Vector3(),
    point = new Vector3(),
    projected = new Vector3()
  const pointer = new Vector2(),
    raycaster = new Raycaster()
  let downX = 0,
    downY = 0,
    active = true
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches
  function stopCamera() {
    cameraTween?.kill()
    cameraTween = undefined
  }
  function takeover() {
    stopCamera()
    manual()
  }
  controls.addEventListener('start', takeover)
  controls.addEventListener('change', invalidate)
  function move(position: Vec3, target: Vec3, instant = false) {
    stopCamera()
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
      invalidate()
    }
    cameraTween = gsap.to(state, {
      x: position[0],
      y: position[1],
      z: position[2],
      tx: target[0],
      ty: target[1],
      tz: target[2],
      duration: instant || reduced() ? 0 : 0.65,
      ease: 'power3.out',
      onUpdate: update,
    })
  }
  function animate(values: Record<string, number>, pulse = false) {
    if (!adapter) return
    const current = adapter
    // Actions blend independently; only the same pose channels replace each other.
    const tween = gsap.to(current.pose, {
      paused: true,
      ...values,
      duration: reduced() ? 0 : pulse ? 0.18 : 0.55,
      repeat: pulse && !reduced() ? 1 : 0,
      yoyo: pulse && !reduced(),
      overwrite: 'auto',
      ease: pulse ? 'power1.inOut' : 'power3.out',
      onUpdate: () => {
        current.apply()
        invalidate()
      },
      onComplete: () => {
        motion.delete(tween)
        if (pulse) {
          for (const id of Object.keys(values)) current.pose[id] = 0
          current.apply()
          invalidate()
        }
      },
      onInterrupt: () => motion.delete(tween),
    })
    motion.add(tween)
    if (active) tween.play()
  }
  function unload() {
    stopCamera()
    motion.forEach((t) => t.kill())
    motion.clear()
    scene.environment = baseEnvironment
    slot.clear()
    interactive = false
    adapter = undefined
    product = undefined
    controls.enabled = false
  }
  async function load(value: WorkbenchProduct, phase: (p: LoadPhase) => void) {
    unload()
    const snapshot = parseProduct(value)
    const loaded = await slot.load((signal) => loadAdapter(snapshot, renderer, signal, phase))
    if (!loaded) return
    product = snapshot
    adapter = loaded
    scene.add(loaded.root)
    scene.environment = loaded.environment ?? baseEnvironment
    controls.minDistance = snapshot.presentation.camera.minDistance
    controls.maxDistance = snapshot.presentation.camera.maxDistance
    move(snapshot.presentation.camera.position, snapshot.presentation.camera.target, true)
    return loaded
  }
  function command(value: SceneCommand) {
    if (!adapter || !product) return
    if (value.kind === 'view') {
      const view = product.presentation.views.find((v) => v.id === value.id)
      if (view) move(view.position, view.target)
    } else if (value.kind === 'focus') {
      const hotspot = product.presentation.hotspots.find((h) => h.id === value.id)
      if (hotspot && adapter.point(hotspot.node, point)) {
        destination.copy(point).add(new Vector3(...hotspot.cameraOffset))
        move(destination.toArray() as Vec3, point.toArray() as Vec3)
      }
    } else {
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
      invalidate()
    }
  }
  function down(event: PointerEvent) {
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
    let object = hit?.object
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
  return {
    load,
    unload,
    command,
    enableInteraction() {
      interactive = true
      controls.enabled = active && Boolean(adapter)
    },
    stopCamera,
    resetMotion() {
      motion.forEach((t) => t.kill())
      motion.clear()
      if (adapter && product) {
        for (const action of product.presentation.actions) adapter.pose[action.id] = 0
        adapter.apply()
        invalidate()
      }
    },
    sync(finishId: string, exploded: boolean, actions: Record<string, number>, instant = false) {
      if (!adapter || !product) return
      const color = product.presentation.finishes.find((f) => f.id === finishId)?.color
      if (color) adapter.setFinish(color)
      const values: Record<string, number> = { explosion: exploded ? 1 : 0 }
      for (const action of product.presentation.actions)
        if (action.kind === 'toggle') values[action.id] = actions[action.id] ?? 0
      if (instant) {
        Object.assign(adapter.pose, values)
        adapter.apply()
        invalidate()
      } else animate(values)
    },
    pulse(id: string) {
      if (adapter && product?.presentation.actions.some((a) => a.id === id && a.kind === 'pulse'))
        animate({ [id]: 1 }, true)
    },
    project(
      width: number,
      height: number,
      place: (id: string, x: number, y: number, visible: boolean) => void,
    ) {
      if (!adapter || !product) return
      for (const hotspot of product.presentation.hotspots) {
        if (!adapter.point(hotspot.node, point)) continue
        projected.copy(point).project(camera)
        const x = (projected.x * 0.5 + 0.5) * width,
          y = (-projected.y * 0.5 + 0.5) * height
        place(
          hotspot.id,
          x,
          y,
          projected.z > -1 &&
            projected.z < 1 &&
            x > 20 &&
            x < width - 110 &&
            y > 90 &&
            y < height - 145,
        )
      }
    },
    setActive(value: boolean) {
      active = value
      controls.enabled = value && interactive && Boolean(adapter)
      cameraTween?.paused(!value)
      motion.forEach((t) => t.paused(!value))
      if (value) invalidate()
    },
    dispose() {
      unload()
      controls.removeEventListener('start', takeover)
      controls.removeEventListener('change', invalidate)
      controls.dispose()
      renderer.domElement.removeEventListener('pointerdown', down)
      renderer.domElement.removeEventListener('pointerup', up)
    },
  }
}

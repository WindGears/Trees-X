/* global window, document, performance, requestAnimationFrame, WheelEvent */
import { bridge } from '../demo/browser-check.mjs'
import { withAuditDeadline } from '../reventon-performance/audit-deadline.mjs'

export const timeout = 240000

/** Disposable browser instrumentation. Does not raise tabs or create a drawing loop. */
export async function attachShowroomBridge(page) {
  await withAuditDeadline('Attach actual scene bridge', () => bridge(page, true), 30000)
  await page.evaluate(() => {
    const seen = new Set()
    const find = (vnode) => {
      if (!vnode || typeof vnode !== 'object' || seen.has(vnode)) return
      seen.add(vnode)
      const component = vnode.component
      const exposed = component?.exposed?.realLighting
      const value = exposed?.value ?? exposed
      if (value?.snapshot && value?.setSignals) return value
      const child = find(component?.subTree)
      if (child) return child
      for (const entry of Array.isArray(vnode.children) ? vnode.children : []) {
        const found = find(entry)
        if (found) return found
      }
      return find(vnode.suspense?.activeBranch)
    }
    window.__carLighting = find(document.querySelector('#app')?._vnode)
    if (!window.__carLighting) throw new Error('Real lighting facade is required')
    window.__carShowroomErrors = []
    window.__demo.scene.renderer.instance.backend.device.addEventListener(
      'uncapturederror',
      (event) => window.__carShowroomErrors.push(event.error?.message ?? 'Unknown GPU error'),
    )
  })
}

export function showroomState() {
  const scene = window.__demo.scene
  const renderer = scene.renderer.instance
  const root = scene.scene.value.children.find((node) => node.userData.workbenchProduct)
  const camera = scene.camera.activeCamera.value
  const direction = camera.getWorldDirection(camera.position.clone())
  const architecture = [],
    lights = []
  let oldGroundVisible = false
  const visible = (node) => {
    for (let current = node; current; current = current.parent) if (!current.visible) return false
    return true
  }
  scene.scene.value.traverse((node) => {
    if (node.name === 'workbench-ground') oldGroundVisible ||= visible(node)
    if (node.userData.carShowroom && node.isMesh)
      architecture.push({
        id: node.userData.showroomId,
        name: node.name,
        visible: visible(node),
        opacity: (Array.isArray(node.material) ? node.material : [node.material]).map(
          (value) => value.opacity,
        ),
        traceSupport: node.userData.traceSupport ?? false,
        traceExclude: node.userData.traceExclude ?? false,
      })
    if (node.isLight)
      lights.push({
        name: node.name,
        type: node.type,
        color: node.color.toArray(),
        intensity: node.intensity,
        width: node.width,
        height: node.height,
        position: node.position.toArray(),
        quaternion: node.quaternion.toArray(),
      })
  })
  return {
    atMs: performance.now(),
    product: root?.userData.workbenchProduct,
    sha256: root?.userData.bundleSha256,
    carStudioQuality: root?.userData.carStudioQuality ?? null,
    showroom: root?.userData.carShowroom ?? null,
    backend: renderer.backend.isWebGPUBackend ? 'webgpu' : 'other',
    canvases: document.querySelectorAll('canvas').length,
    sameCanvas: renderer.domElement === window.__demo.canvas,
    sameRenderer: renderer === window.__demo.renderer,
    output: [renderer.domElement.width, renderer.domElement.height],
    camera: {
      position: camera.position.toArray(),
      direction: direction.toArray(),
      projection: camera.projectionMatrix.toArray(),
    },
    exposure: renderer.toneMappingExposure,
    environmentIntensity: scene.scene.value.environmentIntensity,
    environment: scene.scene.value.environment?.uuid ?? null,
    oldGroundVisible,
    architecture,
    lights,
    lighting: window.__carLighting.snapshot(),
    motion: { ...window.__demo.motion.states.value },
    visibility: document.visibilityState,
    focus: document.hasFocus(),
    memory: { ...renderer.info.memory },
    gpuErrors: [...window.__carShowroomErrors],
  }
}

export function cameraError(actual, expected) {
  const direction = expected.target.map((value, index) => value - expected.position[index])
  const length = Math.hypot(...direction)
  return Math.max(
    ...actual.position.map((value, index) => Math.abs(value - expected.position[index])),
    ...actual.direction.map((value, index) => Math.abs(value - direction[index] / length)),
  )
}

export async function selectShowroomView(page, id, custom) {
  if (custom) {
    // The controller owns an immutable configuration snapshot. Do not mutate
    // Pinia presets and pretend that it changed that snapshot. Additional
    // camera-range shots set the existing real camera after its tween ends.
    const expected = await selectShowroomView(page, 'perspective')
    // Consume the Vue intent watcher before checking a pose that might already
    // equal perspective; otherwise the newly queued tween starts after the shot.
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    )
    // GSAP may lag wall time during background shader preparation. Wait for
    // the actual endpoint so its remaining tween cannot overwrite the shot.
    await page.waitForFunction(
      ({ position, target }) => {
        const camera = window.__demo.scene.camera.activeCamera.value,
          direction = camera.getWorldDirection(camera.position.clone()),
          expectedDirection = camera.position
            .clone()
            .fromArray(target)
            .sub(camera.position)
            .normalize()
        return (
          camera.position.distanceTo(camera.position.clone().fromArray(position)) < 1e-9 &&
          direction.distanceTo(expectedDirection) < 1e-9
        )
      },
      expected,
      { timeout },
    )
    return page.evaluate(({ position, target }) => {
      // A repeated view can have the right pose throughout a live zero-distance
      // tween. The existing controls' wheel-start path relinquishes its writer;
      // zero delta does not alter zoom or bypass the production takeover logic.
      window.__demo.canvas.dispatchEvent(
        new WheelEvent('wheel', { deltaY: 0, bubbles: true, cancelable: true }),
      )
      const camera = window.__demo.scene.camera.activeCamera.value
      camera.position.fromArray(position)
      camera.lookAt(camera.position.clone().fromArray(target))
      camera.updateMatrixWorld(true)
      return { position, target }
    }, custom)
  }
  return page.evaluate((id) => {
    const store = window.__demo.store
    const view = store.presentation.views.find((item) => item.id === id)
    if (!view) throw new Error('Required named view: ' + id)
    store.view(id)
    return { position: [...view.position], target: [...view.target] }
  }, id)
}

export async function focusShowroomPart(page, id) {
  return page.evaluate((id) => {
    const { store, scene } = window.__demo
    const hotspot = store.presentation.hotspots.find((item) => item.id === id)
    const root = scene.scene.value.children.find((node) => node.userData.workbenchProduct)
    const node = root.getObjectByName(hotspot?.node)
    if (!hotspot || !node) throw new Error('Required actual hotspot: ' + id)
    const target = node
      .localToWorld(
        scene.camera.activeCamera.value.position.clone().fromArray(hotspot.anchor ?? [0, 0, 0]),
      )
      .toArray()
    store.focus(id)
    return { position: target.map((value, index) => value + hotspot.cameraOffset[index]), target }
  }, id)
}

export async function seekShowroomMotion(page, id, progress) {
  await page.evaluate(({ id, progress }) => window.__demo.store.motion('seek', id, progress), {
    id,
    progress,
  })
  await page.waitForFunction(
    ({ id, progress }) =>
      Math.abs(window.__demo.motion.states.value[id].progress - progress) < 1e-7,
    { id, progress },
  )
}

export async function flushShowroomGpu(page) {
  await page.evaluate(async () => {
    await window.__demo.scene.renderer.instance.backend.device.queue.onSubmittedWorkDone()
    await new Promise(requestAnimationFrame)
    await new Promise(requestAnimationFrame)
  })
}

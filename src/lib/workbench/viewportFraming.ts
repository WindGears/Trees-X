import { gsap } from 'gsap'
import type { PerspectiveCamera } from 'three'
import { inspectorTiming } from './interfaceMotion'

/** Moves the projection's composition, never the observation pose or controls target. */
export function createViewportFraming(invalidate: () => void) {
  const state = { x: 0, y: 28, zoom: 1 }
  let tween: gsap.core.Tween | undefined
  let camera: PerspectiveCamera | undefined
  let width = 0,
    height = 0
  const apply = () => {
    if (!camera) return
    camera.zoom = state.zoom
    camera.setViewOffset(width, height, state.x, state.y, width, height)
    camera.updateProjectionMatrix()
    invalidate()
  }
  return {
    update(
      next: PerspectiveCamera,
      w: number,
      h: number,
      gallery: boolean,
      inspector: boolean,
      catalog: boolean,
      exhibition = false,
    ) {
      if (!w || !h) return
      const resize = w !== width || h !== height || next !== camera
      camera = next
      width = w
      height = h
      const desktop = w > 760
      const left = gallery && desktop ? (exhibition ? 32 : catalog ? 476 : 148) : 0
      const right = gallery && desktop ? (inspector ? 364 : 32) : 0
      const inspectorZoom =
        exhibition && gallery && desktop && inspector ? (w - left - right) / (w * 0.79) : 1
      const target = {
        x: (right - left) / 2,
        y: gallery ? (desktop ? 16 : -38) : 28,
        zoom: Math.max(0.15, Math.min(1, ((h - 250) / h) * 1.25, w / h / 1.4, inspectorZoom)),
      }
      tween?.kill()
      if (resize || matchMedia('(prefers-reduced-motion: reduce)').matches) {
        Object.assign(state, target)
        apply()
      } else
        tween = gsap.to(state, {
          ...target,
          duration: inspector ? inspectorTiming.enter : inspectorTiming.leave,
          ease: inspectorTiming.ease,
          onUpdate: apply,
        })
    },
    finish() {
      tween?.progress(1)
      tween?.kill()
    },
    dispose() {
      tween?.kill()
      camera = undefined
    },
  }
}

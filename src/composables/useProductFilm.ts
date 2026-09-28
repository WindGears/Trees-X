import { onScopeDispose, watch } from 'vue'
import type { Ref } from 'vue'
import type { Camera, Vector3 } from 'three'
import { gsap } from 'gsap'
import { filmFor } from '@/data/productFilms'
import type { GestureBridge } from '@/lib/gesture/bridge'
import { useProductStore } from '@/stores/product'

interface FilmControls {
  minDistance: number
  target: Vector3
  update: () => void
}
interface FilmRig {
  camera: () => Camera | undefined
  controls: () => FilmControls | undefined
  target: Vector3
  invalidate: () => void
  stopCamera: () => void
}

/** One authored timeline; frame state stays local and can be interrupted at its current pose. */
export function useProductFilm(
  bridge: GestureBridge,
  rig: FilmRig,
  active: Ref<boolean>,
  reduced: Ref<boolean>,
) {
  const store = useProductStore()
  let timeline: gsap.core.Timeline | undefined
  let minDistance = 0
  function stop() {
    if (!timeline) return
    timeline.kill()
    timeline = undefined
    const controls = rig.controls()
    const camera = rig.camera()
    if (controls && camera)
      controls.minDistance = Math.min(minDistance, camera.position.distanceTo(rig.target) * 0.85)
    bridge.filmPlaying.value = false
    bridge.filmPhase.value = 'idle'
    if (bridge.owner.value === 'animation') bridge.owner.value = 'mouse'
    rig.invalidate()
  }
  function play() {
    const shots = filmFor(store.product.id)
    const camera = rig.camera()
    const controls = rig.controls()
    if (!shots || !camera || !controls || !active.value || store.status !== 'ready') return
    stop()
    rig.stopCamera()
    bridge.takeMouse()
    store.panel = null
    store.guideStep = null
    bridge.selected.value = false
    if (reduced.value) {
      const hero = shots[1]!
      camera.position.set(...hero.position)
      rig.target.set(...hero.target)
      controls.target.copy(rig.target)
      controls.update()
      bridge.setModelExpansion(0)
      store.viewPreset = 'perspective'
      bridge.filmPhase.value = 'complete'
      rig.invalidate()
      return
    }
    minDistance = controls.minDistance
    controls.minDistance = 0.15
    bridge.owner.value = 'animation'
    bridge.filmPlaying.value = true
    bridge.filmPhase.value = 'detail'
    const state = {
      x: camera.position.x,
      y: camera.position.y,
      z: camera.position.z,
      tx: rig.target.x,
      ty: rig.target.y,
      tz: rig.target.z,
      expansion: bridge.getModelExpansion(),
      sweep: bridge.filmLighting.sweep,
    }
    function apply() {
      camera!.position.set(state.x, state.y, state.z)
      rig.target.set(state.tx, state.ty, state.tz)
      controls!.target.copy(rig.target)
      controls!.update()
      bridge.setModelExpansion(state.expansion)
      bridge.filmLighting.sweep = state.sweep
      rig.invalidate()
    }
    function move(index: number, at: number, duration: number) {
      const shot = shots![index]!
      timeline!.call(
        () => {
          bridge.filmPhase.value = shot.chapter
        },
        [],
        at,
      )
      timeline!.to(
        state,
        {
          x: shot.position[0],
          y: shot.position[1],
          z: shot.position[2],
          tx: shot.target[0],
          ty: shot.target[1],
          tz: shot.target[2],
          duration,
          ease: 'power2.inOut',
        },
        at,
      )
    }
    timeline = gsap.timeline({
      onUpdate: apply,
      onComplete: () => {
        stop()
        store.viewPreset = 'perspective'
        bridge.filmPhase.value = 'complete'
      },
    })
    move(0, 0, 1.05)
    timeline.to(state, { expansion: 0, sweep: -0.8, duration: 1.05, ease: 'power2.inOut' }, 0)
    timeline.to(state, { x: 0.72, z: 0.86, sweep: 0.9, duration: 1.25, ease: 'sine.inOut' }, 1.05)
    move(1, 2.3, 1.4)
    timeline.to(state, { sweep: 0.2, duration: 1.4 }, 2.3)
    move(2, 4.05, 1.3)
    timeline.to(state, { expansion: 1, sweep: -0.3, duration: 1.4, ease: 'power2.inOut' }, 4.15)
    move(1, 6.25, 1.55)
    timeline.to(state, { expansion: 0, sweep: 0, duration: 1.55, ease: 'power2.inOut' }, 6.25)
  }
  bridge.playFilm = play
  bridge.stopFilm = stop
  watch([active, reduced], () => {
    if (!active.value || reduced.value) stop()
  })
  watch(
    bridge.owner,
    (owner) => {
      if (owner !== 'animation') stop()
    },
    { flush: 'sync' },
  )
  function escape(event: KeyboardEvent) {
    if (event.key === 'Escape') stop()
  }
  window.addEventListener('keydown', escape)
  onScopeDispose(() => {
    stop()
    window.removeEventListener('keydown', escape)
    if (bridge.playFilm === play) bridge.playFilm = () => {}
    if (bridge.stopFilm === stop) bridge.stopFilm = () => {}
  })
}

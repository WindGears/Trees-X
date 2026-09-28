import { markRaw, ref } from 'vue'
import type { InjectionKey } from 'vue'
import type { GestureMode } from './detector'
import type { SelectionPhase } from './selection'
import type { RotationSample } from './rotationSignal'
import type { MotionPhase } from './rotationMotion'
import { GestureTargets } from './targets'
export interface ProjectedPart {
  id: string
  partId: string
  label: string
  x: number
  y: number
  visible: boolean
}

export function createGestureBridge() {
  const owner = ref<'mouse' | 'gesture' | 'animation'>('mouse')
  const mode = ref<GestureMode>('rotate')
  const selected = ref(false)
  const hovered = ref(false)
  const hotspot = ref({ x: 0.5, y: 0.5, visible: false })
  const pointer = ref<{ x: number; y: number } | null>(null)
  const visualPhase = ref<'stable' | 'playing'>('stable')
  const visualSettlers = new Set<() => void>()
  const visualReplays = new Set<() => void>()
  const motion = markRaw({ velocity: 0, angle: 0 })
  const filmPlaying = ref(false)
  const motionObservers = new Set<(velocity: number, angle: number) => void>()
  let visualTimer: ReturnType<typeof setTimeout> | undefined
  function settleVisual() {
    if (visualTimer) clearTimeout(visualTimer)
    visualTimer = undefined
    for (const settle of visualSettlers) settle()
    visualPhase.value = 'stable'
  }
  function replayVisual() {
    settleVisual()
    visualPhase.value = 'playing'
    for (const replay of visualReplays) replay()
    visualTimer = setTimeout(() => {
      visualTimer = undefined
      visualPhase.value = 'stable'
    }, 2400)
  }
  return {
    owner,
    mode,
    selected,
    hovered,
    hotspot,
    pointer,
    visualPhase,
    filmPlaying,
    filmPhase: ref<'idle' | 'detail' | 'hero' | 'layers' | 'complete'>('idle'),
    filmLighting: markRaw({ sweep: 0 }),
    playFilm: () => {},
    stopFilm: () => {},
    getModelExpansion: () => 0,
    setModelExpansion: (progress: number) => {
      void progress
    },
    phase: ref<SelectionPhase>('idle'),
    pinchProgress: ref(0),
    motionPhase: ref<MotionPhase>('idle'),
    motion,
    sessionRunning: ref(false),
    sceneActive: ref(true),
    confirmation: ref<'dwell' | 'pinch'>('dwell'),
    candidateId: ref<string | null>(null),
    candidateLabel: ref(''),
    targets: markRaw(new GestureTargets()),
    projectedParts: ref<ProjectedPart[]>([]),
    inputRevision: 0,
    publishMotion(velocity: number, angle: number) {
      motion.velocity = velocity
      motion.angle = angle
      for (const observer of motionObservers) observer(velocity, angle)
    },
    observeMotion(observer: (velocity: number, angle: number) => void) {
      motionObservers.add(observer)
      return () => motionObservers.delete(observer)
    },
    submitRotation: (sample: RotationSample, receivedAt: number) => {
      void sample
      void receivedAt
    },
    stopMotion: () => {},
    getOrbitAngle: () => 0,
    rotate: (delta: number) => {
      void delta
    },
    reset: (preserveSelectionBlock = false) => {
      void preserveSelectionBlock
    },
    focus: () => {},
    leaveFocus: () => {},
    settleModel: () => {},
    getFocusPoint: (): { x: number; y: number; z: number } | null => null,
    registerVisual(settle: () => void, replay: () => void) {
      visualSettlers.add(settle)
      visualReplays.add(replay)
      return () => {
        visualSettlers.delete(settle)
        visualReplays.delete(replay)
      }
    },
    settleVisual,
    replayVisual,
    disposeVisual() {
      this.stopFilm()
      settleVisual()
      visualSettlers.clear()
      visualReplays.clear()
      motionObservers.clear()
    },
    showPart() {
      selected.value = true
      this.focus()
    },
    hidePart() {
      selected.value = false
      this.leaveFocus()
    },
    takeMouse() {
      this.stopFilm()
      settleVisual()
      owner.value = 'mouse'
      pointer.value = null
      hovered.value = false
      this.reset()
      this.stopMotion()
    },
  }
}
export type GestureBridge = ReturnType<typeof createGestureBridge>
export const gestureKey: InjectionKey<GestureBridge> = Symbol('gesture')

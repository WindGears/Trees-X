import { gsap } from 'gsap'
import type { ReventonMotion } from './motion'

export interface DirectorState {
  seconds: number
  playing: boolean
}

export function createReventonDirector(
  data: ReventonMotion,
  sample: (seconds: number) => void,
  invalidate: () => void,
  notify: (state: DirectorState) => void,
) {
  const clock = { seconds: 0 }
  let playing = false
  let previousNotification = -Infinity
  let disposed = false
  const update = (force = false) => {
    if (disposed) return
    sample(clock.seconds)
    invalidate()
    if (force || performance.now() - previousNotification > 100) {
      previousNotification = performance.now()
      notify({ seconds: clock.seconds, playing })
    }
  }
  const timeline = gsap.timeline({
    paused: true,
    onUpdate: () => update(),
    onComplete: () => {
      playing = false
      update(true)
    },
  })
  timeline.to(clock, { seconds: data.duration, duration: data.duration, ease: 'none' })
  const pause = () => {
    timeline.pause()
    playing = false
    update(true)
  }
  update(true)
  return {
    seek(seconds: number) {
      pause()
      timeline.time(Math.max(0, Math.min(data.duration, seconds)), true)
      update(true)
    },
    toggle() {
      if (playing) {
        pause()
        return
      }
      if (clock.seconds >= data.duration - 0.01) timeline.time(0, true)
      playing = true
      timeline.play()
      update(true)
    },
    pause,
    refresh: () => update(true),
    dispose() {
      disposed = true
      timeline.kill()
    },
  }
}

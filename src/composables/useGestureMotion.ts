import { onScopeDispose, watch } from 'vue'
import type { Ref } from 'vue'
import { gsap } from 'gsap'
import { RotationMotion, ROTATION_TUNING } from '@/lib/gesture/rotationMotion'
import type { GestureBridge } from '@/lib/gesture/bridge'
import type { RotationSample } from '@/lib/gesture/rotationSignal'

export function useGestureMotion(
  active: Ref<boolean>,
  reduced: Ref<boolean>,
  bridge: GestureBridge,
) {
  const motion = new RotationMotion()
  let ticking = false
  let directSampleAt = -Infinity
  let staleTimer: ReturnType<typeof setTimeout> | undefined
  const enabled = () =>
    active.value && bridge.owner.value === 'gesture' && bridge.mode.value === 'rotate'
  function publish() {
    bridge.publishMotion(motion.velocity, bridge.getOrbitAngle())
    bridge.motionPhase.value = motion.phase
  }
  function apply(delta: number) {
    if (delta) bridge.rotate(delta)
    publish()
  }
  function sleep() {
    if (ticking) gsap.ticker.remove(tick)
    ticking = false
  }
  function stop() {
    clearTimeout(staleTimer)
    sleep()
    motion.reset()
    directSampleAt = -Infinity
    publish()
  }
  function tick() {
    if (!enabled() || reduced.value) {
      stop()
      return
    }
    apply(motion.step(performance.now()))
    if (!motion.running) sleep()
  }
  function submit(sample: RotationSample, receivedAt: number) {
    if (!enabled()) {
      stop()
      return
    }
    clearTimeout(staleTimer)
    staleTimer = setTimeout(() => {
      if (!enabled()) return
      if (reduced.value) bridge.motionPhase.value = 'missing'
      else {
        apply(motion.step(performance.now()))
        if (!motion.running) sleep()
      }
    }, 160)
    if (reduced.value) {
      if (sample.time <= directSampleAt || receivedAt - sample.time > ROTATION_TUNING.maxAgeMs)
        return
      directSampleAt = sample.time
      if (sample.kind === 'moving') bridge.rotate(sample.delta)
      bridge.motionPhase.value =
        sample.kind === 'missing'
          ? 'missing'
          : sample.kind === 'arming' || sample.kind === 'discontinuous'
            ? 'arming'
            : 'tracking'
      bridge.publishMotion(0, bridge.getOrbitAngle())
      return
    }
    apply(motion.submit(sample, receivedAt))
    if (motion.running && !ticking) {
      ticking = true
      gsap.ticker.add(tick)
    } else if (!motion.running) sleep()
  }
  bridge.submitRotation = submit
  bridge.stopMotion = stop
  watch([active, reduced, bridge.owner, bridge.mode], stop, { flush: 'sync' })
  onScopeDispose(() => {
    stop()
    bridge.submitRotation = () => {}
    bridge.stopMotion = () => {}
  })
  return { stop }
}
